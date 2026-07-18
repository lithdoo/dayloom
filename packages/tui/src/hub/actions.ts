import {
  describeNextAction,
  inspectNextState,
  type Translator,
} from '@dayloom/core';
import type { HubAction, HubBusyState } from './types.js';

type NextWorldState = ReturnType<typeof inspectNextState>;
type NextAction = NextWorldState['action'];

export interface ResolveHubActionsOptions {
  worldDir: string;
  t: Translator;
}

export interface ResolvedHubActions {
  actions: HubAction[];
  state?: NextWorldState;
  error?: string;
}

export function resolveHubActions(options: ResolveHubActionsOptions): ResolvedHubActions {
  const { worldDir, t } = options;
  try {
    const state = inspectNextState(worldDir);
    const actions: HubAction[] = [
      createNextAction(state, t),
      createModeAction('status', t),
    ];

    if (canRevise(state)) {
      actions.push({
        id: 'revise',
        label: t('shell.revise.hint'),
        summary: t('shell.revise.summary'),
        shortcut: 'r',
        target: { kind: 'revise-session' },
      });
    }

    actions.push(createModeAction('help', t), createQuitAction(t));

    return { actions, state };
  } catch (err) {
    return {
      error: err instanceof Error ? err.message : String(err),
      actions: [
        createModeAction('status', t),
        createModeAction('help', t),
        createQuitAction(t),
      ],
    };
  }
}

function createNextAction(state: NextWorldState, t: Translator): HubAction {
  const action = state.action;
  const summary = describeNextAction(state, t);
  if (action === 'settle') {
    return {
      id: 'next',
      label: `${t('shell.next.hint')} - ${nextActionLabel(action, state, t)}`,
      summary,
      recommended: true,
      shortcut: 'n',
      target: {
        kind: 'settle-loading',
        busy: createSettleBusyState(t),
      },
    };
  }

  return {
    id: 'next',
    label: `${t('shell.next.hint')} - ${nextActionLabel(action, state, t)}`,
    summary,
    recommended: true,
    shortcut: 'n',
    target: {
      kind: 'next-session',
      expectedCommand: action,
    },
  };
}

function createModeAction(mode: 'status' | 'help', t: Translator): HubAction {
  const label = mode === 'status' ? t('shell.status.hint') : t('shell.help.hint');
  const summary = mode === 'status' ? t('shell.status.summary') : t('shell.help.summary');
  return {
    id: mode,
    label,
    summary,
    shortcut: mode === 'status' ? 's' : '?',
    target: { kind: 'hub-mode', mode },
  };
}

function createQuitAction(t: Translator): HubAction {
  return {
    id: 'quit',
    label: t('shell.quit.hint'),
    summary: t('shell.quit.summary'),
    shortcut: 'q',
    target: { kind: 'app-exit' },
  };
}

function createSettleBusyState(t: Translator): HubBusyState {
  return {
    kind: 'settling',
    label: t('next.actionSettle'),
  };
}

function canRevise(state: NextWorldState): boolean {
  return state.kind === 'initialized' && (state.phase === 'idle' || state.phase === 'planned');
}

function nextActionLabel(action: NextAction, state: NextWorldState, t: Translator): string {
  switch (action) {
    case 'init':
      return state.kind === 'uninitialized' ? t('next.nextAction', { action }) : action;
    case 'daily':
    case 'settle':
      return t('next.nextAction', { action });
    case 'play':
      return state.kind === 'initialized' && state.phase === 'playing'
        ? t('next.actionPlayContinue')
        : t('next.actionPlayStart');
  }
  return action;
}
