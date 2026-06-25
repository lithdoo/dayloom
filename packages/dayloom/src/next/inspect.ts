import fs from 'fs';
import path from 'path';

export type WorldPhase = 'idle' | 'planned' | 'playing' | 'settling';
export type NextAction = 'init' | 'daily' | 'play' | 'settle';

export type NextWorldState =
  | {
      kind: 'uninitialized';
      worldRoot: string;
      action: 'init';
    }
  | {
      kind: 'initialized';
      worldRoot: string;
      day: string;
      phase: WorldPhase;
      lastCommittedDay?: string;
      action: Exclude<NextAction, 'init'>;
    };

export function inspectNextState(dir: string): NextWorldState {
  const worldRoot = path.resolve(dir);
  const manifestPath = path.join(worldRoot, 'manifest.yaml');
  if (!fs.existsSync(manifestPath)) {
    return { kind: 'uninitialized', worldRoot, action: 'init' };
  }

  const currentPath = path.join(worldRoot, 'current.yaml');
  if (!fs.existsSync(currentPath)) throw new Error('World save missing current.yaml');
  const current = fs.readFileSync(currentPath, 'utf8');
  const day = readYamlScalar(current, 'day', 'current.yaml');
  const phase = readPhase(readYamlScalar(current, 'phase', 'current.yaml'));
  const lastCommittedDay = readOptionalYamlScalar(current, 'last_committed_day');

  return {
    kind: 'initialized',
    worldRoot,
    day,
    phase,
    lastCommittedDay,
    action: actionForPhase(phase),
  };
}

export function formatNextStatus(state: NextWorldState): string {
  const lines = [`World: ${state.worldRoot}`];
  if (state.kind === 'uninitialized') {
    lines.push('Current: uninitialized');
    lines.push('Next action: init');
    lines.push('Recommended command:');
    lines.push(`  dayloom init -d ${state.worldRoot}`);
    return lines.join('\n');
  }

  lines.push(`Current: ${state.day} / phase=${state.phase}`);
  if (state.lastCommittedDay) lines.push(`Last committed day: ${state.lastCommittedDay}`);
  lines.push(`Next action: ${state.action}`);
  lines.push('Recommended command:');
  lines.push(`  dayloom ${state.action} -d ${state.worldRoot}`);
  return lines.join('\n');
}

export function describeNextAction(state: NextWorldState): string {
  switch (state.action) {
    case 'init':
      return 'This will create a new World save.';
    case 'daily':
      return "This will start today's planning session.";
    case 'play':
      return state.kind === 'initialized' && state.phase === 'playing'
        ? 'This will continue the current play session.'
        : "This will start today's play session.";
    case 'settle':
      return 'This will settle the completed day and advance to the next idle day.';
  }
}

function actionForPhase(phase: WorldPhase): Exclude<NextAction, 'init'> {
  switch (phase) {
    case 'idle':
      return 'daily';
    case 'planned':
    case 'playing':
      return 'play';
    case 'settling':
      return 'settle';
  }
}

function readPhase(value: string): WorldPhase {
  if (value === 'idle' || value === 'planned' || value === 'playing' || value === 'settling') return value;
  throw new Error(`Unsupported current phase for next: ${value}`);
}

function readYamlScalar(text: string, key: string, label: string): string {
  const match = text.match(new RegExp(`^${key}:\\s*(\\S+)\\s*$`, 'm'));
  if (!match) throw new Error(`${label} missing ${key}`);
  return match[1];
}

function readOptionalYamlScalar(text: string, key: string): string | undefined {
  const match = text.match(new RegExp(`^${key}:\\s*(\\S+)\\s*$`, 'm'));
  return match?.[1];
}
