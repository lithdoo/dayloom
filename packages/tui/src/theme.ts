import type { TuiMessageRole } from './message-history.js';
import type { TuiSessionStatus, TuiWorldState } from './types.js';

export function phaseLabel(phase: TuiWorldState['phase']): string {
  return ({ idle: '空闲', planned: '已计划', 'awaiting-settle': '待结算' })[phase];
}

export function sessionKindLabel(): string { return '行动'; }

export function sessionStatusLabel(status: TuiSessionStatus): string {
  return ({ ready: '等待输入', running: 'AI 回复中', submitting: '提交中' })[status];
}

export function roleLabel(role: TuiMessageRole): string {
  return ({ user: 'YOU ', assistant: 'AI  ', system: 'SYS ', error: 'ERR ', warn: 'WARN' })[role];
}

export function roleColor(role: TuiMessageRole): string {
  return ({ user: 'green', assistant: 'white', system: 'cyan', error: 'red', warn: 'yellow' })[role];
}
