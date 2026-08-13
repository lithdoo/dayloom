import { protocolError, type ArchiveProtocolErrorCode } from './errors';

export function record(value: unknown, schema: string, code: ArchiveProtocolErrorCode = 'ARCHIVE_PROTOCOL_SHAPE_INVALID'): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) protocolError(code, `${schema} must be an object.`);
  return value as Record<string, unknown>;
}
export function exactKeys(value: Record<string, unknown>, keys: readonly string[], schema: string, code: ArchiveProtocolErrorCode = 'ARCHIVE_PROTOCOL_SHAPE_INVALID'): void {
  const allowed = new Set(keys);
  for (const key of Object.keys(value)) if (!allowed.has(key)) protocolError(code, `${schema}.${key} is not allowed.`, { field: key });
  for (const key of keys) if (!(key in value)) protocolError(code, `${schema}.${key} is required.`, { field: key });
}
export function string(value: unknown, schema: string, field: string, allowEmpty = false, code: ArchiveProtocolErrorCode = 'ARCHIVE_PROTOCOL_SHAPE_INVALID'): string {
  if (typeof value !== 'string' || (!allowEmpty && value.length === 0)) protocolError(code, `${schema}.${field} must be ${allowEmpty ? 'a string' : 'a non-empty string'}.`, { field });
  return value;
}
export function integer(value: unknown, schema: string, field: string, minimum: number, code: ArchiveProtocolErrorCode = 'ARCHIVE_PROTOCOL_SHAPE_INVALID'): number {
  if (!Number.isSafeInteger(value) || (value as number) < minimum) protocolError(code, `${schema}.${field} must be an integer >= ${minimum}.`, { field });
  return value as number;
}
export function nullable<T>(value: unknown, parse: (value: unknown) => T): T | null { return value === null ? null : parse(value); }
export function isIsoTimestamp(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) && !Number.isNaN(Date.parse(value));
}
export function timestamp(value: unknown, schema: string, field: string, code: ArchiveProtocolErrorCode = 'ARCHIVE_PROTOCOL_SHAPE_INVALID'): string {
  if (!isIsoTimestamp(value)) protocolError(code, `${schema}.${field} must be a canonical UTC timestamp.`, { field });
  return value;
}
export function stableId(value: unknown, schema: string, field: string, code: ArchiveProtocolErrorCode = 'ARCHIVE_PROTOCOL_SHAPE_INVALID'): string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(value)) protocolError(code, `${schema}.${field} must be a stable identifier.`, { field });
  return value;
}
export function schemaVersion(value: unknown, expected: number, schema: string): void {
  if (value !== expected) protocolError('ARCHIVE_PROTOCOL_VERSION_UNSUPPORTED', `${schema}.schemaVersion must equal ${expected}.`, { expected, actual: typeof value === 'number' ? value : null });
}
export function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const nested of Object.values(value as Record<string, unknown>)) deepFreeze(nested);
  }
  return value;
}
