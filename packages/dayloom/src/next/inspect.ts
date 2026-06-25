import fs from 'fs';
import path from 'path';
import { createTranslator, type Translator } from '../i18n';

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

export function formatNextStatus(state: NextWorldState, t: Translator = createTranslator('en')): string {
  const lines = [t('next.world', { worldRoot: state.worldRoot })];
  if (state.kind === 'uninitialized') {
    lines.push(t('next.currentUninitialized'));
    lines.push(t('next.nextAction', { action: 'init' }));
    lines.push(t('next.recommendedCommand'));
    lines.push(`  dayloom init -d ${state.worldRoot}`);
    return lines.join('\n');
  }

  lines.push(t('next.currentPhase', { day: state.day, phase: state.phase }));
  if (state.lastCommittedDay) lines.push(t('next.lastCommittedDay', { lastCommittedDay: state.lastCommittedDay }));
  lines.push(t('next.nextAction', { action: state.action }));
  lines.push(t('next.recommendedCommand'));
  lines.push(`  dayloom ${state.action} -d ${state.worldRoot}`);
  return lines.join('\n');
}

export function describeNextAction(state: NextWorldState, t: Translator = createTranslator('en')): string {
  switch (state.action) {
    case 'init':
      return t('next.actionInit');
    case 'daily':
      return t('next.actionDaily');
    case 'play':
      return state.kind === 'initialized' && state.phase === 'playing'
        ? t('next.actionPlayContinue')
        : t('next.actionPlayStart');
    case 'settle':
      return t('next.actionSettle');
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
