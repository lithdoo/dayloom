import type { SessionKind, WorldPhase } from './types';

/** 具有 active Session 的 phase 与 Session kind 的唯一映射。 */
export const SESSION_PHASE_KIND = {
  initializing: 'init',
  planning: 'planning',
  playing: 'play',
  revising: 'revise',
} as const satisfies Partial<Record<WorldPhase, SessionKind>>;

/** 根据 phase 返回必须存在的 Session kind。 */
export function sessionKindForPhase(phase: WorldPhase): SessionKind | null {
  return phase in SESSION_PHASE_KIND
    ? SESSION_PHASE_KIND[phase as keyof typeof SESSION_PHASE_KIND]
    : null;
}

/** 返回取消 Session 后的稳定 phase。 */
export function cancelTargetForPhase(phase: WorldPhase): WorldPhase | null {
  switch (phase) {
    case 'initializing': return 'uninitialized';
    case 'planning': return 'idle';
    case 'playing': return 'planned';
    case 'revising': return 'idle';
    default: return null;
  }
}

/** 返回提交 Session 后的稳定 phase。 */
export function submitTargetForPhase(phase: WorldPhase): WorldPhase | null {
  switch (phase) {
    case 'initializing': return 'idle';
    case 'planning': return 'planned';
    case 'playing': return 'awaiting-settle';
    case 'revising': return 'idle';
    default: return null;
  }
}
