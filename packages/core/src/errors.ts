import type { JsonValue, RuntimeError, RuntimeErrorCode } from './types';

/** 创建稳定、可序列化的 RuntimeError。 */
export function createRuntimeError(
  code: RuntimeErrorCode,
  message: string,
  details?: JsonValue,
): RuntimeError {
  return details === undefined ? { code, message } : { code, message, details };
}

/** 判断 unknown 是否是 AbortError。 */
export function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}

/** 把未知异常转成稳定 RuntimeError。 */
export function toRuntimeError(
  error: unknown,
  fallbackCode: RuntimeErrorCode = 'SESSION_FAILED',
): RuntimeError {
  if (isRuntimeError(error)) {
    return error;
  }

  if (error instanceof Error) {
    return createRuntimeError(fallbackCode, error.message);
  }

  return createRuntimeError(fallbackCode, String(error));
}

/** 判断一个值是否已经是 RuntimeError。 */
export function isRuntimeError(error: unknown): error is RuntimeError {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    'message' in error &&
    isRuntimeErrorCode((error as { code: unknown }).code) &&
    typeof (error as { message: unknown }).message === 'string'
  );
}

const runtimeErrorCodes: readonly RuntimeErrorCode[] = [
  'RUNTIME_BUSY',
  'RUNTIME_CLOSED',
  'COMMAND_NOT_AVAILABLE',
  'PHASE_MISMATCH',
  'SESSION_NOT_ACTIVE',
  'SESSION_ALREADY_ACTIVE',
  'SESSION_KIND_MISMATCH',
  'SESSION_STATUS_MISMATCH',
  'SESSION_FAILED',
  'INPUT_NOT_EXPECTED',
  'AI_CALL_FAILED',
  'TASK_FAILED',
  'ARCHIVE_MANIFEST_INVALID',
  'ARCHIVE_POINTER_INVALID',
  'ARCHIVE_COMMIT_MISSING',
  'ARCHIVE_COMMIT_INVALID',
  'ARCHIVE_REFERENCE_MISSING',
  'ARCHIVE_REFERENCE_INVALID',
  'ARCHIVE_SESSION_RECOVERY_FAILED',
  'ARCHIVE_CONFLICT',
  'SUBMISSION_INVALID',
  'OPERATION_FAILED',
  'WORLD_INVALID',
];

/** 判断一个值是否是公开错误码。 */
export function isRuntimeErrorCode(value: unknown): value is RuntimeErrorCode {
  return typeof value === 'string' && runtimeErrorCodes.includes(value as RuntimeErrorCode);
}
