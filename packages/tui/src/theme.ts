import type {
  RuntimeCommand,
  SessionKind,
  SessionStatus,
  WorldCommand,
  WorldPhase,
} from '@dayloom/core';
import type { TuiMessageRole } from './message-history.js';

export function phaseLabel(phase: WorldPhase): string {
  const labels: Record<WorldPhase, string> = {
    uninitialized: '未初始化',
    initializing: '初始化中',
    idle: '空闲',
    planning: '计划中',
    planned: '已计划',
    playing: '行动中',
    'awaiting-settle': '待结算',
    revising: '修订中',
    invalid: '异常',
  };
  return labels[phase];
}

export function sessionKindLabel(kind: SessionKind): string {
  const labels: Record<SessionKind, string> = {
    init: '初始化',
    planning: '计划',
    play: '行动',
    revise: '修订',
  };
  return labels[kind];
}

export function sessionStatusLabel(status: SessionStatus): string {
  const labels: Record<SessionStatus, string> = {
    none: '无会话',
    created: '正在启动',
    'waiting-input': '等待输入',
    streaming: 'AI 回复中',
    loading: '处理中',
    'ready-to-submit': '可提交',
    submitting: '提交中',
    completed: '已完成',
    cancelled: '已取消',
    failed: '会话失败',
  };
  return labels[status];
}

export function commandLabel(command: WorldCommand): string {
  const labels: Record<WorldCommand, string> = {
    init: '初始化 World',
    daily: '制定当日计划',
    play: '进入行动',
    settle: '结算当日',
    revise: '修订 World',
    'abandon-day': '放弃当日',
  };
  return labels[command];
}

export function commandSummary(command: WorldCommand): string {
  const summaries: Record<WorldCommand, string> = {
    init: '创建基础设定并进入第一天',
    daily: '和 AI 讨论并提交今天计划',
    play: '推进今天的事件和行动',
    settle: '生成结算并进入下一天',
    revise: '维护或修正已有设定',
    'abandon-day': '取消当前 day，回到前一天',
  };
  return summaries[command];
}

export function runtimeCommandLabel(command: RuntimeCommand): string {
  if (command === 'submit') return '提交会话';
  if (command === 'cancel') return '取消会话';
  return commandLabel(command);
}

export function roleLabel(role: TuiMessageRole): string {
  const labels: Record<TuiMessageRole, string> = {
    user: 'YOU ',
    assistant: 'AI  ',
    system: 'SYS ',
    error: 'ERR ',
    warn: 'WARN',
  };
  return labels[role];
}

export function roleColor(role: TuiMessageRole): string {
  const colors: Record<TuiMessageRole, string> = {
    user: 'green',
    assistant: 'white',
    system: 'cyan',
    error: 'red',
    warn: 'yellow',
  };
  return colors[role];
}
