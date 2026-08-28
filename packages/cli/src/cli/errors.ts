import { ArchiveProtocolErrorV1 } from '@dayloom/archive-protocol';

export type CliErrorCodeV1 =
  | 'INVALID_ARGUMENT'
  | 'DRAFT_INVALID'
  | 'LLM_CONFIG_REQUIRED'
  | 'NOT_AVAILABLE'
  | 'WORLD_INVALID'
  | 'WORLD_CONFLICT'
  | 'AI_FAILED'
  | 'VALIDATION_FAILED'
  | 'PATCH_INVALID'
  | 'INTERNAL_ERROR';

export class CliErrorV1 extends Error {
  constructor(
    readonly code: CliErrorCodeV1,
    message: string,
    readonly details?: Readonly<Record<string, unknown>>,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'CliErrorV1';
  }
}

export function cliErrorV1(code: CliErrorCodeV1, message: string, details?: Readonly<Record<string, unknown>>): CliErrorV1 {
  return new CliErrorV1(code, message, details);
}

export function exitCodeForV1(code: CliErrorCodeV1): number {
  if (code === 'INTERNAL_ERROR') return 1;
  if (code === 'INVALID_ARGUMENT' || code === 'DRAFT_INVALID' || code === 'LLM_CONFIG_REQUIRED') return 2;
  if (code === 'NOT_AVAILABLE' || code === 'WORLD_CONFLICT') return 3;
  if (code === 'WORLD_INVALID' || code === 'VALIDATION_FAILED' || code === 'PATCH_INVALID') return 4;
  return 5;
}

export function normalizeCliErrorV1(error: unknown): CliErrorV1 {
  if (error instanceof CliErrorV1) return error;
  if (error instanceof ArchiveProtocolErrorV1) {
    return new CliErrorV1('WORLD_INVALID', error.message, { protocolCode: error.code }, { cause: error });
  }
  if (error instanceof Error) return new CliErrorV1('INTERNAL_ERROR', error.message, undefined, { cause: error });
  return new CliErrorV1('INTERNAL_ERROR', 'Unknown internal error.');
}
