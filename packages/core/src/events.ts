import type { CoreState } from './state';
export type ReactWorkPhase = 'thought' | 'observe' | 'check';
export type CoreEvent =
  | { type: 'state.changed'; state: CoreState }
  | { type: 'work.started'; sessionId: string; operationId: string; workPath: string }
  | { type: 'work.delta'; sessionId: string; operationId: string; phase: ReactWorkPhase; stepIndex: number; text: string }
  | { type: 'work.completed'; sessionId: string; operationId: string; workPath: string }
  | { type: 'work.failed'; sessionId: string; operationId: string; status: 'failed' | 'cancelled'; message: string; workPath: string | null }
  | { type: 'output.started'; sessionId: string; operationId: string; messageId: string }
  | { type: 'output.delta'; sessionId: string; operationId: string; messageId: string; text: string }
  | { type: 'output.completed'; sessionId: string; operationId: string; messageId: string }
  | { type: 'output.failed'; sessionId: string; operationId: string; messageId: string; message: string };
