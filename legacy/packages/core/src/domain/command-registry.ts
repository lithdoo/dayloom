import type { RuntimeCommand, SessionCommand, WorldCommand } from './commands';
import type { SessionKind, WorldPhase } from './types';

export interface CommandRule {
  readonly name: RuntimeCommand;
  readonly type: 'world' | 'session';
  readonly phases: readonly WorldPhase[];
  readonly session: 'none' | 'active';
  readonly currentDayRequired: boolean;
  readonly targetPhase?: WorldPhase;
  readonly createSession?: SessionKind;
}

/** Availability 与 transition 共用的完整 command 规则表。 */
export const COMMAND_REGISTRY: Readonly<Record<RuntimeCommand, CommandRule>> = {
  init: worldRule('init', ['uninitialized'], 'initializing', 'init'),
  daily: worldRule('daily', ['idle'], 'planning', 'planning'),
  play: worldRule('play', ['planned'], 'playing', 'play'),
  settle: worldRule('settle', ['awaiting-settle'], 'idle', undefined, true),
  revise: worldRule('revise', ['idle'], 'revising', 'revise'),
  'abandon-day': worldRule('abandon-day', ['planned', 'awaiting-settle'], 'idle', undefined, true),
  submit: sessionRule('submit'),
  cancel: sessionRule('cancel'),
};

/** 保持稳定展示顺序的全部 Runtime command。 */
export const RUNTIME_COMMANDS = Object.freeze([
  'init',
  'daily',
  'play',
  'settle',
  'revise',
  'abandon-day',
  'submit',
  'cancel',
] as const satisfies readonly RuntimeCommand[]);

function worldRule(
  name: WorldCommand,
  phases: readonly WorldPhase[],
  targetPhase: WorldPhase,
  createSession?: SessionKind,
  currentDayRequired = false,
): CommandRule {
  return { name, type: 'world', phases, session: 'none', currentDayRequired, targetPhase, createSession };
}

function sessionRule(name: SessionCommand): CommandRule {
  return {
    name,
    type: 'session',
    phases: ['initializing', 'planning', 'playing', 'revising'],
    session: 'active',
    currentDayRequired: false,
  };
}
