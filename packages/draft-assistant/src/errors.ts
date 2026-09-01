export type AssistantErrorCodeV1 =
  | 'INVALID_ARGUMENT' | 'AMBIGUOUS_COMMAND' | 'NOT_AVAILABLE' | 'WORLD_INVALID'
  | 'AUTHORITY_INVALID' | 'LLM_CONFIG_INVALID' | 'CONVERSATION_FAILED'
  | 'MCP_FAILED' | 'INTERNAL_ERROR';

export class AssistantErrorV1 extends Error {
  constructor(
    readonly code: AssistantErrorCodeV1,
    message: string,
    readonly details?: Readonly<Record<string, unknown>>,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'AssistantErrorV1';
  }
}

export function assistantErrorV1(code: AssistantErrorCodeV1, message: string, details?: Readonly<Record<string, unknown>>): AssistantErrorV1 {
  return new AssistantErrorV1(code, message, details);
}

export function exitCodeForAssistantV1(code: AssistantErrorCodeV1): number {
  if (code === 'INTERNAL_ERROR') return 1;
  if (code === 'INVALID_ARGUMENT') return 2;
  if (code === 'AMBIGUOUS_COMMAND' || code === 'NOT_AVAILABLE') return 3;
  if (['WORLD_INVALID', 'AUTHORITY_INVALID', 'LLM_CONFIG_INVALID', 'CONVERSATION_FAILED'].includes(code)) return 4;
  return 5;
}

export function normalizeAssistantErrorV1(error: unknown): AssistantErrorV1 {
  if (error instanceof AssistantErrorV1) return error;
  if (error instanceof Error) return new AssistantErrorV1('INTERNAL_ERROR', error.message, undefined, { cause: error });
  return new AssistantErrorV1('INTERNAL_ERROR', 'Unknown internal error.');
}
