export type SessionCommand = 'init' | 'daily' | 'play' | 'revise';

export type SessionState =
  | { kind: 'starting' }
  | { kind: 'streaming' }
  | { kind: 'waiting-input' }
  | { kind: 'waiting-confirm' }
  | { kind: 'loading'; label: string }
  | { kind: 'completed'; summary?: string }
  | { kind: 'cancelled'; summary?: string }
  | { kind: 'failed'; error: string };

export interface SessionCapability {
  canExit: boolean;
  canCancel: boolean;
  canSave: boolean;
  canQuit: boolean;
  blockedHubCommands: Array<'status' | 'help' | 'next' | 'revise'>;
}
