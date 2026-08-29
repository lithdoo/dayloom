export type DraftErrorCodeV1 =
  | 'INVALID_ARGUMENT'
  | 'AMBIGUOUS_COMMAND'
  | 'NOT_AVAILABLE'
  | 'WORLD_INVALID'
  | 'AUTHORITY_INVALID'
  | 'LLM_CONFIG_INVALID'
  | 'CONVERSATION_FAILED'
  | 'MCP_FAILED'
  | 'INTERNAL_ERROR';

export class DraftErrorV1 extends Error {
  constructor(
    readonly code: DraftErrorCodeV1,
    message: string,
    readonly details?: Readonly<Record<string, unknown>>,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'DraftErrorV1';
  }
}

export function draftErrorV1(
  code: DraftErrorCodeV1,
  message: string,
  details?: Readonly<Record<string, unknown>>,
): DraftErrorV1 {
  return new DraftErrorV1(code, message, details);
}

export function exitCodeForV1(code: DraftErrorCodeV1): number {
  if (code === 'INTERNAL_ERROR') return 1;
  if (code === 'INVALID_ARGUMENT') return 2;
  if (code === 'AMBIGUOUS_COMMAND' || code === 'NOT_AVAILABLE') return 3;
  if (
    code === 'WORLD_INVALID' ||
    code === 'AUTHORITY_INVALID' ||
    code === 'LLM_CONFIG_INVALID' ||
    code === 'CONVERSATION_FAILED'
  ) return 4;
  return 5;
}

export function normalizeDraftErrorV1(error: unknown): DraftErrorV1 {
  if (error instanceof DraftErrorV1) return error;
  if (error instanceof Error) return new DraftErrorV1('INTERNAL_ERROR', error.message, undefined, { cause: error });
  return new DraftErrorV1('INTERNAL_ERROR', 'Unknown internal error.');
}
