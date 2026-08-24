import type { SessionKind, SessionStatus } from '../domain/types';
import type { JsonValue, RuntimeError } from '../schemas/common';
import type { SessionSubmission, TranscriptEntry } from '../schemas/submissions';
import type {
  InputRequestSnapshot,
  LoadingSnapshot,
  RuntimeInput,
  RuntimeMessage,
  WorldSnapshot,
} from '../types';

/** active Session 的最小可展示状态。 */
export interface SessionSnapshot {
  active: boolean;
  id: string | null;
  kind: SessionKind | null;
  status: SessionStatus;
  input: InputRequestSnapshot | null;
  loading: LoadingSnapshot | null;
  error: RuntimeError | null;
}

/** Session 内部可发出的权限受限事件。 */
export type SessionEvent =
  | { type: 'status-changed'; status: SessionStatus }
  | { type: 'message-added'; message: Omit<RuntimeMessage, 'sessionId'> }
  | { type: 'assistant-message-start'; messageId: string }
  | { type: 'assistant-message-delta'; messageId: string; sequence: number; delta: string }
  | { type: 'assistant-message-end'; messageId: string }
  | { type: 'assistant-message-error'; messageId: string; error: RuntimeError }
  | { type: 'input-requested'; request: InputRequestSnapshot }
  | { type: 'input-closed'; requestId: string }
  | { type: 'loading-started'; loading: LoadingSnapshot }
  | { type: 'loading-updated'; loading: LoadingSnapshot }
  | { type: 'loading-ended'; loadingId: string };

/** Session 可访问的隔离工作区。 */
export interface SessionWorkspace {
  appendTranscript(entry: TranscriptEntry): Promise<void>;
  writeCheckpoint(value: JsonValue): Promise<void>;
  readCheckpoint(): Promise<JsonValue | null>;
}

/** Session 可使用的上下文。 */
export interface SessionContext {
  readonly sessionId: string;
  readonly world: Readonly<WorldSnapshot>;
  readonly workspace: SessionWorkspace;
  emit(event: SessionEvent): void;
}

/** Session 提交给 Runtime 的强类型业务产物。 */
export type SessionSubmitResult = SessionSubmission;

/** 一次业务会话对象。 */
export interface RuntimeSession<TResult extends SessionSubmitResult = SessionSubmitResult> {
  readonly id: string;
  readonly kind: TResult['kind'];
  getSnapshot(): SessionSnapshot;
  start(): Promise<void>;
  sendInput(input: RuntimeInput, signal: AbortSignal): Promise<void>;
  prepareSubmit(): Promise<TResult>;
  completeSubmit(): Promise<void>;
  failSubmit(error: RuntimeError): Promise<void>;
  cancel(): Promise<void>;
  dispose(): Promise<void>;
}

/** 没有 active Session 时使用的空快照。 */
export const emptySessionSnapshot: SessionSnapshot = {
  active: false,
  id: null,
  kind: null,
  status: 'none',
  input: null,
  loading: null,
  error: null,
};
