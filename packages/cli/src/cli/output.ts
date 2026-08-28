import type { CliCommandV1 } from './argv.js';
import type { CliErrorV1 } from './errors.js';

export interface CliSuccessEnvelopeV1 {
  ok: true;
  command: CliCommandV1;
  result: unknown;
}

export interface CliErrorEnvelopeV1 {
  ok: false;
  command: string;
  error: {
    code: CliErrorV1['code'];
    message: string;
    details?: Readonly<Record<string, unknown>>;
  };
}

export function successEnvelopeV1(command: CliCommandV1, result: unknown): CliSuccessEnvelopeV1 {
  return { ok: true, command, result };
}

export function errorEnvelopeV1(command: string, error: CliErrorV1): CliErrorEnvelopeV1 {
  return {
    ok: false,
    command,
    error: {
      code: error.code,
      message: error.message,
      ...(error.details === undefined ? {} : { details: error.details }),
    },
  };
}

export function renderHumanSuccessV1(command: CliCommandV1, result: any): string {
  if (command === 'status') {
    if (result.status === 'uninitialized') return 'World is uninitialized.';
    if (result.status === 'invalid') return 'World is invalid.';
    return `World revision ${result.revision} (${result.phase}${result.day ? `, ${result.day}` : ''}).`;
  }
  if (command === 'verify') return `World is valid at revision ${result.revision}; verified ${result.commitsVerified} commit(s).`;
  if (result?.mode === 'checked') return `${command}: check passed.`;
  if (result?.mode === 'dry-run') return `${command}: dry-run produced Patch ${result.patchHash}.`;
  if (result?.mode === 'published') return `${command}: published revision ${result.revision}.`;
  return `${command}: success.`;
}
