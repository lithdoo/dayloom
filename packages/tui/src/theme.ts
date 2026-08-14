import type { CoreSessionKind, PublishedWorldPhase } from '@dayloom/core2';
import type { TuiBusinessActionId, TuiMessage, TuiSessionPresentationStatus } from './types.js';

export function phaseLabel(phase: PublishedWorldPhase | 'uninitialized' | 'invalid'): string {
  return ({ uninitialized: '未初始化', invalid: '异常', idle: '空闲', planned: '已计划', 'awaiting-settle': '待结算' })[phase];
}

export function sessionKindLabel(kind: CoreSessionKind): string {
  return ({ init: '初始化', planning: '计划', play: '行动', revise: '修订' })[kind];
}

export function sessionStatusLabel(status: TuiSessionPresentationStatus): string {
  return ({ ready: '等待输入', running: 'AI 回复中', cancelling: '取消中', submitting: '提交中', failed: '会话失败' })[status];
}

export function commandLabel(command: TuiBusinessActionId): string {
  return ({ init: '初始化 World', daily: '制定当日计划', revise: '修订 World', play: '进入行动', settle: '结算当日', 'abandon-day': '放弃当日' })[command];
}

export function commandSummary(command: TuiBusinessActionId): string {
  return ({
    init: '创建基础设定', daily: '和 AI 讨论并提交今天计划', revise: '维护或修正已有设定',
    play: '推进今天的事件和行动', settle: '结算当前 day', 'abandon-day': '放弃当前 day 并回到空闲状态',
  })[command];
}

export function roleLabel(role: TuiMessage['role']): string {
  return ({ user: 'YOU ', assistant: 'AI  ', system: 'SYS ', error: 'ERR ', warn: 'WARN' })[role];
}

export function roleColor(role: TuiMessage['role']): string {
  return ({ user: 'green', assistant: 'white', system: 'cyan', error: 'red', warn: 'yellow' })[role];
}
