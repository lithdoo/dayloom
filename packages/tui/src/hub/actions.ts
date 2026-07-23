import type { CommandAvailability, WorldCommand, WorldPhase } from '@dayloom/core';
import { commandLabel, commandSummary } from '../theme.js';
import type { HubMode, TuiHubAction } from '../types.js';

const worldCommandOrder: WorldCommand[] = [
  'init',
  'daily',
  'revise',
  'play',
  'settle',
  'abandon-day',
];

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
  phase: WorldPhase,
  commands: readonly CommandAvailability[],
  selectedId: string | null,
  mode: HubMode,
): { actions: TuiHubAction[]; selectedId: string | null } {
  const byName = new Map(commands.map((command) => [command.name, command]));
  const coreActions = worldCommandOrder
    .filter((command) => byName.get(command)?.enabled)
    .map<TuiHubAction>((command) => ({
      id: command,
      kind: 'core-command',
      command,
      label: commandLabel(command),
      summary: commandSummary(command),
      shortcut: shortcutForCommand(command),
      recommended: command === recommendedCommandForPhase(phase),
    }));

  const actions = [...coreActions, ...localActions.map((action) => ({
    ...action,
    recommended: coreActions.length === 0 && action.id === 'status' && mode === 'status',
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

export function isWorldCommand(command: string): command is WorldCommand {
  return (worldCommandOrder as string[]).includes(command);
}

function recommendedCommandForPhase(phase: WorldPhase): WorldCommand | null {
  switch (phase) {
    case 'uninitialized':
      return 'init';
    case 'idle':
      return 'daily';
    case 'planned':
      return 'play';
    case 'awaiting-settle':
      return 'settle';
    default:
      return null;
  }
}

function shortcutForCommand(command: WorldCommand): string | null {
  const shortcuts: Partial<Record<WorldCommand, string>> = {
    init: 'i',
    daily: 'd',
    revise: 'r',
    play: 'p',
    settle: 't',
  };
  return shortcuts[command] ?? null;
}

