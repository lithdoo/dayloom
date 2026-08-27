export type CoreErrorCode =
  | 'NOT_AVAILABLE' | 'BUSY' | 'INVALID_INPUT' | 'CONVERSATION_FAILED'
  | 'AGENT_FAILED' | 'DRAFT_INVALID' | 'CONVERSION_FAILED' | 'CANDIDATE_INVALID' | 'WORLD_BUSY' | 'WORLD_CONFLICT' | 'WORLD_INVALID'
  | 'TURN_POLICY_REJECTED' | 'TURN_REVIEW_FAILED' | 'DRAFT_SYNC_FAILED' | 'DRAFT_CONFLICT'
  | 'CANCELLED' | 'DISPOSED' | 'INTERNAL_ERROR';
import type { ValidationIssueV1 } from './session/diagnostics';
export interface CoreError { code: CoreErrorCode; message: string; diagnostics?: readonly ValidationIssueV1[] }
export type CoreResult = { ok: true } | { ok: false; error: CoreError };
export type CoreInitializationErrorCode = 'INVALID_OPTIONS' | 'WORLD_BUSY' | 'DRAFT_MIGRATION_FAILED' | 'INTERNAL_ERROR';

export class CoreInitializationError extends Error {
  constructor(readonly code: CoreInitializationErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'CoreInitializationError';
  }
}

export class CoreOperationError extends Error {
  constructor(readonly code: CoreErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'CoreOperationError';
  }
}
export type ArchiveRetrievalStage = 'projection' | 'startup' | 'tools' | 'hook' | 'artifacts' | 'runtime';
export class ArchiveRetrievalError extends Error {
  constructor(readonly stage: ArchiveRetrievalStage, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'ArchiveRetrievalError';
  }
}
export type SessionFileRuntimeStage = 'startup' | 'tools' | 'hook' | 'artifacts' | 'runtime';
export class SessionFileRuntimeError extends Error {
  constructor(readonly stage: SessionFileRuntimeStage, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'SessionFileRuntimeError';
  }
}
export const success = (): CoreResult => ({ ok: true });
export const failure = (code: CoreErrorCode, message: string, diagnostics?: readonly ValidationIssueV1[]): CoreResult => ({ ok: false, error: { code, message, ...(diagnostics && diagnostics.length > 0 ? { diagnostics } : {}) } });
