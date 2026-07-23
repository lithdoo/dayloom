import type {
  CommandAvailability,
  RuntimeMessage,
  RuntimeSnapshot,
  SessionKind,
  SessionStatus,
  WorldCommand,
} from '@dayloom/core';

export type HubMode = 'status' | 'help';

export type TuiPage =
  | { kind: 'hub'; mode: HubMode; busy: TuiBusyState | null }
  | { kind: 'session'; sessionId: string; sessionKind: SessionKind };

export interface TuiBusyState {
  operation: string;
  label: string;
}

export type TuiHubAction = TuiLocalHubAction | TuiCoreHubAction;

export interface TuiLocalHubAction {
  id: 'status' | 'help' | 'quit';
  kind: 'local';
  label: string;
  summary: string;
  shortcut: string | null;
  recommended: boolean;
}

export interface TuiCoreHubAction {
  id: WorldCommand;
  kind: 'core-command';
  command: WorldCommand;
  label: string;
  summary: string;
  shortcut: string | null;
  recommended: boolean;
}

export interface TuiRecentResult {
  kind: 'completed' | 'cancelled' | 'failed';
  label: string;
  detail: string | null;
}

export interface TuiDriverState {
  page: TuiPage;
  snapshot: RuntimeSnapshot;
  commands: CommandAvailability[];
  hubActions: TuiHubAction[];
  selectedHubActionId: string | null;
  recent: TuiRecentResult | null;
  loading: TuiBusyState | null;
  messages: RuntimeMessage[];
}

export interface TuiSessionView {
  sessionId: string;
  sessionKind: SessionKind;
  status: SessionStatus;
  inputEnabled: boolean;
  inputPrompt: string;
  loading: TuiBusyState | null;
  messages: RuntimeMessage[];
}

export type TuiInputMode = 'hidden' | 'text';

