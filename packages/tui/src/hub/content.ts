import type { CommandAvailability, RuntimeSnapshot } from '@dayloom/core';
import { isWorldCommand } from './actions.js';
import { phaseLabel, runtimeCommandLabel } from '../theme.js';
import type { TuiHubAction, TuiRecentResult } from '../types.js';

export function formatHubStatus(input: {
  snapshot: RuntimeSnapshot;
  actions: readonly TuiHubAction[];
  commands: readonly CommandAvailability[];
  recent: TuiRecentResult | null;
}): string {
  const { snapshot, actions, recent } = input;
  const lines = [
    `World: ${snapshot.world.worldRoot}`,
    `Phase: ${phaseLabel(snapshot.world.phase)} (${snapshot.world.phase})`,
    `Day: ${snapshot.world.day ?? '-'}`,
    `Initialized: ${snapshot.world.initialized ? 'yes' : 'no'}`,
  ];
  if (snapshot.world.invalidReason) {
    lines.push(`Error: ${snapshot.world.invalidReason}`);
  }
  if (recent) {
    lines.push('', `最近结果: ${recent.label}${recent.detail ? ` - ${recent.detail}` : ''}`);
  }
  lines.push('', '当前可选动作:');
  for (const action of actions.filter((action) => action.kind === 'core-command')) {
    lines.push(`- ${action.label}: ${action.summary}`);
  }
  if (!actions.some((action) => action.kind === 'core-command')) {
    lines.push('- 无业务动作');
  }
  const unavailable = input.commands.filter(
    (command) => isWorldCommand(command.name) && !command.enabled,
  );
  if (unavailable.length > 0) {
    lines.push('', '当前不可用动作:');
    for (const command of unavailable) {
      lines.push(`- ${runtimeCommandLabel(command.name)}: ${command.reason ?? '不可用'}`);
    }
  }
  return lines.join('\n');
}

export function formatHubHelp(input: {
  commands: readonly CommandAvailability[];
  actions: readonly TuiHubAction[];
}): string {
  const disabled = input.commands.filter(
    (command) => isWorldCommand(command.name) && !command.enabled,
  );
  const lines = [
    'Hub 操作',
    '',
    '- Enter: 执行当前选择',
    '- ↑/↓: 切换选择',
    ...input.actions
      .filter((action) => action.shortcut)
      .map((action) => `- ${action.shortcut}: ${action.label}`),
    '',
    'Session 输入',
    '',
    '- 普通文本: 发送给当前会话',
    '- /submit: 提交当前会话产物',
    '- /cancel 或 /exit: 取消当前会话并回到 Hub',
    '- /status、/help、/next、/revise: Session 中会提示回 Hub',
  ];
  if (disabled.length > 0) {
    lines.push('', '当前不可用指令:');
    for (const command of disabled) {
      lines.push(`- ${runtimeCommandLabel(command.name)}: ${command.reason ?? '不可用'}`);
    }
  }
  return lines.join('\n');
}
