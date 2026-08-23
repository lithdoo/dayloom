import type { CoreState } from './state';
export type CoreEventV1 =
  | { type: 'state.changed'; state: CoreState }
  | { type: 'output.delta'; sessionId: string; text: string };

export type ReactWorkPhase = 'thought' | 'observe' | 'check';
export type CoreEventV2 =
  | { type: 'state.changed'; state: CoreState }
  | { type: 'work.started'; sessionId: string; operationId: string; workPath: string }
  | { type: 'work.delta'; sessionId: string; operationId: string; phase: ReactWorkPhase; stepIndex: number; text: string }
  | { type: 'work.completed'; sessionId: string; operationId: string; workPath: string }
  | { type: 'work.failed'; sessionId: string; operationId: string; status: 'failed' | 'cancelled'; message: string; workPath: string | null }
  | { type: 'output.started'; sessionId: string; operationId: string; messageId: string }
  | { type: 'output.delta'; sessionId: string; operationId: string; messageId: string; text: string }
  | { type: 'output.completed'; sessionId: string; operationId: string; messageId: string }
  | { type: 'output.failed'; sessionId: string; operationId: string; messageId: string; message: string };

export type CoreEvent = CoreEventV1 | CoreEventV2;
export type CoreEventProtocol = 'core-event-v1' | 'core-event-v2';
export type CoreEventFor<P extends CoreEventProtocol> = P extends 'core-event-v2' ? CoreEventV2 : CoreEventV1;
