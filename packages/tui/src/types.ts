export type TuiBusinessActionId =
  | 'init' | 'daily' | 'revise' | 'play' | 'settle' | 'abandon-day';

export type TuiLocalActionId = 'status' | 'help' | 'quit';
export type HubMode = 'status' | 'help';

interface TuiActionBase {
  label: string;
  summary: string;
  shortcut: string | null;
  recommended: boolean;
}

export type TuiHubAction =
  | (TuiActionBase & { id: TuiBusinessActionId; kind: 'business' })
  | (TuiActionBase & { id: TuiLocalActionId; kind: 'local' });

export interface TuiBusyState {
  actionId: TuiBusinessActionId;
  label: string;
}

export type TuiWorldView =
  | { status: 'uninitialized'; worldRoot: string }
  | { status: 'invalid'; worldRoot: string; error: string }
  | {
      status: 'published';
      worldRoot: string;
      worldId: string;
      title: string;
      revision: number;
      commitId: string;
      phase: 'idle' | 'planned' | 'awaiting-settle';
      day: string | null;
      lastSettledDay: string | null;
    };

export type TuiSessionPresentationStatus =
  | 'ready' | 'running' | 'submitting' | 'cancelling' | 'failed';

export interface TuiSessionPresentation {
  id: string;
  kind: 'init' | 'planning' | 'play' | 'revise';
  status: TuiSessionPresentationStatus;
  error: { code: string; message: string } | null;
}

export type TuiPage =
  | { kind: 'hub'; mode: HubMode; busy: TuiBusyState | null }
  | { kind: 'session'; sessionId: string; sessionKind: 'init' | 'planning' | 'play' | 'revise' };

export interface TuiSessionControls {
  input: boolean;
  submit: boolean;
  cancel: boolean;
  dismiss: boolean;
}

export interface TuiMessage {
  id: string;
  role: 'user' | 'assistant' | 'system' | 'error' | 'warn';
  text: string;
  status: 'streaming' | 'complete' | 'error';
}

export interface TuiRecentResult {
  kind: 'completed' | 'cancelled' | 'failed';
  label: string;
  detail: string | null;
}

export interface TuiDriverState {
  page: TuiPage;
  world: TuiWorldView;
  session: TuiSessionPresentation | null;
  sessionControls: TuiSessionControls;
  hubActions: readonly TuiHubAction[];
  selectedHubActionId: string | null;
  recent: TuiRecentResult | null;
  messages: readonly TuiMessage[];
}

export type TuiInputMode = 'hidden' | 'text';
