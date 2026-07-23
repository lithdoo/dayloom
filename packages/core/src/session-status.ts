import type { SessionStatus } from './types';

/** 判断 active Session 当前是否处于可执行 submit 的稳定状态。 */
export function isSessionSubmittable(status: SessionStatus): boolean {
  return status === 'waiting-input' || status === 'ready-to-submit';
}
