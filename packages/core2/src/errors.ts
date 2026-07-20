import type { JsonValue, RuntimeError } from './types';

/** 创建稳定、可序列化的 RuntimeError。 */
export function createRuntimeError(
  code: string,
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
export function toRuntimeError(error: unknown, fallbackCode = 'SESSION_FAILED'): RuntimeError {
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
    typeof (error as { code: unknown }).code === 'string' &&
    typeof (error as { message: unknown }).message === 'string'
  );
}
