import fs from 'fs';
import path from 'path';

export function resolveWorldRoot(dir: string): string { return path.resolve(dir); }

export function assertInitializedWorld(worldRoot: string): void {
  if (!fs.existsSync(path.join(worldRoot, 'manifest.yaml'))) throw new Error(`World save is not initialized: ${worldRoot}`);
}

export function readCurrentDay(worldRoot: string): string {
  const current = readCurrentYaml(worldRoot);
  const match = current.match(/^day:\s*(\S+)\s*$/m);
  if (!match) throw new Error('current.yaml missing day');
  return match[1];
}

export function readLastCommittedDay(worldRoot: string): string {
  const current = readCurrentYaml(worldRoot);
  const match = current.match(/^last_committed_day:\s*(\S+)\s*$/m);
  if (!match) throw new Error('current.yaml missing last_committed_day');
  return match[1];
}

export function readCurrentPhase(worldRoot: string): string {
  const current = readCurrentYaml(worldRoot);
  const match = current.match(/^phase:\s*(\S+)\s*$/m);
  if (!match) throw new Error('current.yaml missing phase');
  return match[1];
}

export function assertDailyCanStart(worldRoot: string): void {
  const phase = readCurrentPhase(worldRoot);
  if (phase !== 'idle') throw new Error(`Daily planning requires current phase idle, got: ${phase}`);
  const day = readCurrentDay(worldRoot);
  const dayRoot = path.join(worldRoot, 'days', day);
  if (fs.existsSync(dayRoot) && fs.readdirSync(dayRoot).length > 0) throw new Error(`Daily directory already exists and is not empty: days/${day}`);
}

function readCurrentYaml(worldRoot: string): string {
  const filePath = path.join(worldRoot, 'current.yaml');
  if (!fs.existsSync(filePath)) throw new Error('World save missing current.yaml');
  return fs.readFileSync(filePath, 'utf8');
}
