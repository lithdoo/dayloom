/** 可序列化 JSON 值。 */
export type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue };

/** Core 对外提供的稳定错误码。 */
export type RuntimeErrorCode =
  | 'RUNTIME_BUSY'
  | 'RUNTIME_CLOSED'
  | 'COMMAND_NOT_AVAILABLE'
  | 'PHASE_MISMATCH'
  | 'SESSION_NOT_ACTIVE'
  | 'SESSION_ALREADY_ACTIVE'
  | 'SESSION_KIND_MISMATCH'
  | 'SESSION_STATUS_MISMATCH'
  | 'SESSION_FAILED'
  | 'INPUT_NOT_EXPECTED'
  | 'AI_CALL_FAILED'
  | 'TASK_FAILED'
  | 'ARCHIVE_MANIFEST_INVALID'
  | 'ARCHIVE_POINTER_INVALID'
  | 'ARCHIVE_COMMIT_MISSING'
  | 'ARCHIVE_COMMIT_INVALID'
  | 'ARCHIVE_REFERENCE_MISSING'
  | 'ARCHIVE_REFERENCE_INVALID'
  | 'ARCHIVE_SESSION_RECOVERY_FAILED'
  | 'ARCHIVE_CONFLICT'
  | 'SUBMISSION_INVALID'
  | 'OPERATION_FAILED'
  | 'WORLD_INVALID';

/** Runtime/Session 对外暴露的稳定错误。 */
export interface RuntimeError {
  /** 稳定错误码，供调用方进行机器分支。 */
  code: RuntimeErrorCode;

  /** 人类可读诊断。 */
  message: string;

  /** 可序列化结构化详情。 */
  details?: JsonValue;
}

/** world 的稳定标识。 */
export type WorldId = string;

/** `day_` 加至少四位十进制序号。 */
export type DayId = string;

/** 不可变 archive commit 标识。 */
export type CommitId = string;

/** 不可变 canon revision 标识。 */
export type CanonRevisionId = string;

/** 不可变 day revision 标识。 */
export type DayRevisionId = string;

/** 一次 mutation 或 archive operation 的关联标识。 */
export type OperationId = string;

/** day 内稳定 event 标识。 */
export type EventId = string;

/** UTC ISO-8601 时间字符串。 */
export type IsoTimestamp = string;
