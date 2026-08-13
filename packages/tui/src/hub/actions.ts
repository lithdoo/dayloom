import type { TuiHubAction } from '../types.js';

const localActions: TuiHubAction[] = [
  {
    id: 'status',
    kind: 'local',
    label: '状态',
    summary: '查看当前 World 状态',
    shortcut: 's',
    recommended: false,
  },
  {
    id: 'help',
    kind: 'local',
    label: '帮助',
    summary: '查看可用操作说明',
    shortcut: '?',
    recommended: false,
  },
  {
    id: 'quit',
    kind: 'local',
    label: '退出',
    summary: '关闭 TUI',
    shortcut: 'q',
    recommended: false,
  },
];

export function projectHubActions(
  startSessions: readonly 'play'[],
  selectedId: string | null,
): { actions: TuiHubAction[]; selectedId: string | null } {
  const playAvailable = startSessions.includes('play');
  const sessionActions: TuiHubAction[] = playAvailable ? [{
    id: 'play',
    kind: 'session',
    sessionKind: 'play',
    label: '进入行动',
    summary: '推进今天的事件和行动',
    shortcut: 'p',
    recommended: true,
  }] : [];
  const actions = [...sessionActions, ...localActions.map((action) => ({
    ...action,
    recommended: !playAvailable && action.id === 'status',
  }))];

  if (actions.length === 0) {
    return { actions, selectedId: null };
  }
  if (selectedId && actions.some((action) => action.id === selectedId)) {
    return { actions, selectedId };
  }
  return {
    actions,
    selectedId: actions.find((action) => action.recommended)?.id ?? actions[0]!.id,
  };
}

