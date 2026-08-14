import type { SessionCommand } from '../session/types.js';

export type HubMode = 'status' | 'help';

export interface HubBusyState {
  kind: 'settling';
  label: string;
}

export type TuiPage =
  | {
      kind: 'hub';
      mode: HubMode;
      busy?: HubBusyState;
    }
  | {
      kind: 'session';
      command: SessionCommand;
      state: import('../session/types.js').SessionState;
    };

export type HubActionId = 'next' | 'status' | 'help' | 'revise' | 'quit';

export type HubActionTarget =
  | { kind: 'hub-mode'; mode: HubMode }
  | { kind: 'next-session'; expectedCommand: Extract<SessionCommand, 'init' | 'daily' | 'play'> }
  | { kind: 'revise-session' }
  | { kind: 'settle-loading'; busy: HubBusyState }
  | { kind: 'app-exit' };

export interface HubAction {
  id: HubActionId;
  label: string;
  summary: string;
  recommended?: boolean;
  shortcut?: string;
  target: HubActionTarget;
}

export interface HubRecentSummary {
  kind: 'completed' | 'saved' | 'cancelled' | 'failed';
  label: string;
  detail?: string;
}

export interface HubStatusContent {
  worldRoot: string;
  initialized: boolean;
  day?: string;
  phase?: string;
  nextLabel: string;
  nextSummary: string;
  actions: Array<{
    id: HubActionId;
    label: string;
  }>;
  recent?: HubRecentSummary;
  error?: string;
}

export interface HubHelpContent {
  hubCommands: Array<{
    label: string;
    summary: string;
    shortcut?: string;
  }>;
  sessionCommands: Array<{
    command: string;
    summary: string;
    availability?: string;
  }>;
}
