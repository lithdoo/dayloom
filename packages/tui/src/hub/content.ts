import { phaseLabel } from '../theme.js';
import type { TuiHubAction, TuiRecentResult, TuiWorldState } from '../types.js';

export function formatHubStatus(input: {
  world: TuiWorldState;
  actions: readonly TuiHubAction[];
  recent: TuiRecentResult | null;
}): string {
  const { world, actions, recent } = input;
  const lines = [
    `World: ${world.title} (${world.worldId})`,
    `Root: ${world.worldRoot}`,
    `Revision: ${world.revision} (${world.commitId})`,
    `Phase: ${phaseLabel(world.phase)} (${world.phase})`,
    `Day: ${world.day ?? '-'}`,
    `Last settled: ${world.lastSettledDay ?? '-'}`,
  ];
  if (recent) lines.push('', `最近结果: ${recent.label}${recent.detail ? ` - ${recent.detail}` : ''}`);
  lines.push('', '当前可选动作:');
  const sessionActions = actions.filter((action) => action.kind === 'session');
  if (sessionActions.length === 0) lines.push('- 当前没有可启动的业务会话');
  for (const action of sessionActions) lines.push(`- ${action.label}: ${action.summary}`);
  return lines.join('\n');
}

export function formatHubHelp(input: { actions: readonly TuiHubAction[] }): string {
  return [
    'Hub 操作',
    '',
    '- Enter: 执行当前选择',
    '- Up/Down: 切换选择',
    ...input.actions.filter((action) => action.shortcut).map((action) => `- ${action.shortcut}: ${action.label}`),
    '',
    'Session 输入',
    '',
    '- 普通文本: 发送给当前 Play 会话',
    '- /submit: 提交当前会话产物',
    '- /cancel 或 /exit: 取消当前会话并回到 Hub',
    '- /status、/help、/next、/revise: 仅显示本地提示',
  ].join('\n');
}
