export const ARCHIVE_PROTOCOL_ERROR_CODES = [
  'ARCHIVE_PROTOCOL_VERSION_UNSUPPORTED', 'ARCHIVE_PROTOCOL_SHAPE_INVALID',
  'ARCHIVE_PROTOCOL_PATH_INVALID', 'ARCHIVE_PROTOCOL_PATH_COLLISION',
  'ARCHIVE_PROTOCOL_MEDIA_INVALID', 'ARCHIVE_PROTOCOL_HASH_INVALID',
  'ARCHIVE_PROTOCOL_TREE_INVALID', 'ARCHIVE_PROTOCOL_COMMIT_INVALID',
  'ARCHIVE_PROTOCOL_OPERATION_INVALID', 'ARCHIVE_PROTOCOL_REFERENCE_INVALID',
] as const;

export type ArchiveProtocolErrorCode = typeof ARCHIVE_PROTOCOL_ERROR_CODES[number];
export type ArchiveProtocolErrorDetails = Readonly<Record<string, string | number | boolean | null>>;
export interface ArchiveProtocolErrorData {
  code: ArchiveProtocolErrorCode;
  message: string;
  details?: ArchiveProtocolErrorDetails;
}

export class ArchiveProtocolError extends Error {
  readonly code: ArchiveProtocolErrorCode;
  readonly details?: ArchiveProtocolErrorDetails;
  constructor(code: ArchiveProtocolErrorCode, message: string, details?: ArchiveProtocolErrorDetails) {
    super(message); this.name = 'ArchiveProtocolError'; this.code = code;
    this.details = details === undefined ? undefined : Object.freeze({ ...details });
  }
  toJSON(): ArchiveProtocolErrorData {
    return this.details === undefined
      ? { code: this.code, message: this.message }
      : { code: this.code, message: this.message, details: this.details };
  }
}

export function protocolError(code: ArchiveProtocolErrorCode, message: string, details?: ArchiveProtocolErrorDetails): never {
  throw new ArchiveProtocolError(code, message, details);
}
