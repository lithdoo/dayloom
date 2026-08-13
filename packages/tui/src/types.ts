export type HubMode = 'status' | 'help';

export type TuiPage =
  | { kind: 'hub'; mode: HubMode }
  | { kind: 'session'; sessionId: string; sessionKind: 'play' };

export interface TuiWorldState {
  worldRoot: string;
  worldId: string;
  title: string;
  revision: number;
  commitId: string;
  phase: 'idle' | 'planned' | 'awaiting-settle';
  day: string | null;
  lastSettledDay: string | null;
}

export type TuiSessionStatus = 'ready' | 'running' | 'submitting';

export interface TuiSessionState {
  id: string;
  kind: 'play';
  status: TuiSessionStatus;
}

export interface TuiSessionControls {
  input: boolean;
  submit: boolean;
  cancel: boolean;
}

export interface TuiMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  text: string;
  status?: 'streaming' | 'complete' | 'error';
}

export type TuiHubAction = TuiLocalHubAction | TuiSessionHubAction;

export interface TuiLocalHubAction {
  id: 'status' | 'help' | 'quit';
  kind: 'local';
  label: string;
  summary: string;
  shortcut: string | null;
  recommended: boolean;
}

export interface TuiSessionHubAction {
  id: 'play';
  kind: 'session';
  sessionKind: 'play';
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
  world: TuiWorldState;
  session: TuiSessionState | null;
  sessionControls: TuiSessionControls;
  hubActions: TuiHubAction[];
  selectedHubActionId: string | null;
  recent: TuiRecentResult | null;
  messages: TuiMessage[];
}

export type TuiInputMode = 'hidden' | 'text';

