import { phaseLabel } from '../theme.js';
import type { TuiDriverState, TuiHubAction, TuiRecentResult, TuiWorldView } from '../types.js';

export function formatHubStatus(input: {
  world: TuiWorldView;
  actions: readonly TuiHubAction[];
  recent: TuiRecentResult | null;
}): string {
  const lines = [`World: ${input.world.worldRoot}`, `Status: ${phaseLabel(input.world.status === 'published' ? input.world.phase : input.world.status)} (${input.world.status})`];
  if (input.world.status === 'published') {
    lines.push(
      `Title: ${input.world.title}`,
      `Revision: ${input.world.revision}`,
      `Phase: ${phaseLabel(input.world.phase)} (${input.world.phase})`,
      `Day: ${input.world.day ?? '-'}`,
      `Last settled day: ${input.world.lastSettledDay ?? '-'}`,
    );
  } else if (input.world.status === 'invalid') {
    lines.push(`Error: ${input.world.error}`);
  }
  if (input.recent) lines.push('', `最近结果: ${input.recent.label}${input.recent.detail ? ` - ${input.recent.detail}` : ''}`);
  lines.push('', '当前可选动作:');
  const business = input.actions.filter((action) => action.kind === 'business');
  if (business.length === 0) lines.push('- 无业务动作');
  else for (const action of business) lines.push(`- ${action.label}: ${action.summary}`);
  return lines.join('\n');
}

export function formatHubHelp(input: { actions: readonly TuiHubAction[] }): string {
  return [
    'Hub 操作', '', '- Enter: 执行当前选择', '- Up/Down: 切换选择',
    ...input.actions.filter((action) => action.shortcut).map((action) => `- ${action.shortcut}: ${action.label}`),
    '', 'Session 输入', '', '- 普通文本: 发送给当前会话', '- /submit: 提交当前会话产物',
    '- /cancel 或 /exit: 取消当前会话并回到 Hub', '- /status、/help、/next、/revise: Session 中本地提示',
    '- AI 回复中仍可用 /cancel 或 /exit 中断', '- 提交中输入禁用',
  ].join('\n');
}

export function hubMessageFor(state: TuiDriverState): string {
  return state.page.kind === 'hub' && state.page.mode === 'help'
    ? formatHubHelp({ actions: state.hubActions })
    : formatHubStatus({ world: state.world, actions: state.hubActions, recent: state.recent });
}
