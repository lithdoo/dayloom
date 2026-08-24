import type { CoreState } from '@dayloom/core';
import { commandLabel, commandSummary } from '../theme.js';
import type { TuiBusinessActionId, TuiHubAction } from '../types.js';

const businessOrder: readonly TuiBusinessActionId[] = [
  'init', 'daily', 'revise', 'play', 'settle', 'abandon-day',
];

const localActions: readonly TuiHubAction[] = [
  { id: 'status', kind: 'local', label: '状态', summary: '查看当前 World 状态', shortcut: 's', recommended: false },
  { id: 'help', kind: 'local', label: '帮助', summary: '查看可用操作说明', shortcut: '?', recommended: false },
  { id: 'quit', kind: 'local', label: '退出', summary: '关闭 TUI', shortcut: 'q', recommended: false },
];

export function projectHubActions(
  capabilities: CoreState['capabilities'],
  selectedId: string | null,
): { actions: TuiHubAction[]; selectedId: string | null } {
  const available = new Set<TuiBusinessActionId>();
  for (const kind of capabilities.startSessions) {
    if (kind === 'planning') available.add('daily');
    else available.add(kind);
  }
  if (capabilities.settle) available.add('settle');
  if (capabilities.abandonDay) available.add('abandon-day');

  const recommendedId = recommendedAction(available);
  const businessActions = businessOrder
    .filter((id) => available.has(id))
    .map<TuiHubAction>((id) => ({
      id,
      kind: 'business',
      label: commandLabel(id),
      summary: commandSummary(id),
      shortcut: shortcutFor(id),
      recommended: id === recommendedId,
    }));
  const actions = [
    ...businessActions,
    ...localActions.map((action) => ({
      ...action,
      recommended: recommendedId === null && action.id === 'status',
    })),
  ];
  const nextSelected = selectedId && actions.some((action) => action.id === selectedId)
    ? selectedId
    : actions.find((action) => action.recommended)?.id ?? actions[0]?.id ?? null;
  return { actions, selectedId: nextSelected };
}

export function isBusinessActionId(value: string): value is TuiBusinessActionId {
  return (businessOrder as readonly string[]).includes(value);
}

function recommendedAction(available: ReadonlySet<TuiBusinessActionId>): TuiBusinessActionId | null {
  for (const id of ['init', 'daily', 'play', 'settle'] as const) if (available.has(id)) return id;
  return null;
}

function shortcutFor(id: TuiBusinessActionId): string | null {
  return ({ init: 'i', daily: 'd', revise: 'r', play: 'p', settle: 't' } as Partial<Record<TuiBusinessActionId, string>>)[id] ?? null;
}
