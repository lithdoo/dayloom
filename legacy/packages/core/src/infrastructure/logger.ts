import type { JsonValue, RuntimeError } from '../schemas/common';

/** Core 内部诊断字段；必须保持可序列化。 */
export type CoreLogFields = Record<string, JsonValue>;

/** Core 内部日志接口，原始 cause 只能进入这里。 */
export interface CoreLogger {
  debug(message: string, fields?: CoreLogFields): void;
  info(message: string, fields?: CoreLogFields): void;
  warn(message: string, fields?: CoreLogFields): void;
  error(message: string, error?: unknown, fields?: CoreLogFields): void;
}

/** 默认静默 logger。 */
export const noopCoreLogger: CoreLogger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};

/** 适合记录公共 RuntimeError 的稳定字段。 */
export function runtimeErrorFields(error: RuntimeError): CoreLogFields {
  return error.details === undefined
    ? { code: error.code, message: error.message }
    : { code: error.code, message: error.message, details: error.details };
}
