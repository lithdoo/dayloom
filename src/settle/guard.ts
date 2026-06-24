import fs from 'fs';
import path from 'path';
import type { CurrentPlan, PlayState } from '../play/types';

export interface SettlementWorldState {
  day: string;
  dayRoot: string;
  plan: CurrentPlan;
  playState: PlayState;
}

export function resolveWorldRoot(dir: string): string {
  return path.resolve(dir);
}

export function assertSettlementCanStart(worldRoot: string): SettlementWorldState {
  if (!fs.existsSync(path.join(worldRoot, 'manifest.yaml'))) throw new Error(`World save is not initialized: ${worldRoot}`);

  const currentPath = path.join(worldRoot, 'current.yaml');
  if (!fs.existsSync(currentPath)) throw new Error('World save missing current.yaml');
  const current = fs.readFileSync(currentPath, 'utf8');
  const day = readYamlScalar(current, 'day', 'current.yaml');
  const phase = readYamlScalar(current, 'phase', 'current.yaml');
  if (phase !== 'settling') throw new Error(`Settlement requires current phase settling, got: ${phase}`);

  const dayRoot = path.join(worldRoot, 'days', day);
  const metaPath = path.join(dayRoot, 'meta.yaml');
  if (!fs.existsSync(metaPath)) throw new Error(`Missing day metadata: days/${day}/meta.yaml`);
  const metaPhase = readYamlScalar(fs.readFileSync(metaPath, 'utf8'), 'phase', `days/${day}/meta.yaml`);
  if (metaPhase !== 'settling') throw new Error(`Settlement requires day phase settling, got: ${metaPhase}`);

  const plan = readJson<CurrentPlan>(path.join(dayRoot, 'plan.current.json'), 'current plan');
  const playState = readJson<PlayState>(path.join(dayRoot, 'play.state.json'), 'play state');
  if (plan.day !== day) throw new Error(`Current plan day mismatch: expected ${day}, got ${plan.day}`);
  if (playState.day !== day) throw new Error(`Play state day mismatch: expected ${day}, got ${playState.day}`);
  if (playState.phase !== 'settling' || playState.step !== 'complete') throw new Error('Settlement requires completed play state in settling phase');
  if (playState.active_event !== null || playState.active_beat !== null) throw new Error('Settlement cannot start while an event or beat is active');

  const unfinished = plan.beats.filter(beat => beat.status !== 'completed' && beat.status !== 'cancelled');
  if (unfinished.length > 0) throw new Error(`Settlement requires all beats closed: ${unfinished.map(beat => beat.id).join(', ')}`);
  for (const eventId of playState.completed_events) {
    if (!fs.existsSync(path.join(dayRoot, 'events', eventId, 'result.json'))) throw new Error(`Completed event is missing result.json: ${eventId}`);
  }
  return { day, dayRoot, plan, playState };
}

export function assertNextDayAvailable(worldRoot: string, nextDay: string): void {
  const nextRoot = path.join(worldRoot, 'days', nextDay);
  if (fs.existsSync(nextRoot) && fs.readdirSync(nextRoot).length > 0) throw new Error(`Next day directory already exists and is not empty: days/${nextDay}`);
}

function readYamlScalar(text: string, key: string, label: string): string {
  const match = text.match(new RegExp(`^${key}:\\s*(\\S+)\\s*$`, 'm'));
  if (!match) throw new Error(`${label} missing ${key}`);
  return match[1];
}

function readJson<T>(filePath: string, label: string): T {
  if (!fs.existsSync(filePath)) throw new Error(`Missing ${label}: ${filePath}`);
  try { return JSON.parse(fs.readFileSync(filePath, 'utf8')) as T; }
  catch { throw new Error(`Invalid JSON in ${label}: ${filePath}`); }
}
