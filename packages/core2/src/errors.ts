export type CoreErrorCode =
  | 'NOT_AVAILABLE' | 'BUSY' | 'INVALID_INPUT' | 'CONVERSATION_FAILED'
  | 'AGENT_FAILED' | 'SUBMISSION_INVALID' | 'WORLD_CONFLICT' | 'DISPOSED' | 'INTERNAL_ERROR';
export interface CoreError { code: CoreErrorCode; message: string }
export type CoreResult = { ok: true } | { ok: false; error: CoreError };
export type CoreInitializationErrorCode = 'INVALID_OPTIONS' | 'WORLD_INVALID' | 'INTERNAL_ERROR';

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
export const success = (): CoreResult => ({ ok: true });
export const failure = (code: CoreErrorCode, message: string): CoreResult => ({ ok: false, error: { code, message } });
