import { createHash } from 'node:crypto';

export type ArchiveProtocolErrorCodeV1 =
  | 'ARCHIVE_PROTOCOL_INVALID'
  | 'ARCHIVE_PROTOCOL_REFERENCE_INVALID'
  | 'ARCHIVE_PROTOCOL_HASH_INVALID'
  | 'ARCHIVE_PROTOCOL_PATH_INVALID';

export class ArchiveProtocolErrorV1 extends Error {
  constructor(
    readonly code: ArchiveProtocolErrorCodeV1,
    message: string,
  ) {
    super(message);
    this.name = 'ArchiveProtocolErrorV1';
  }
}

export function failV1(code: ArchiveProtocolErrorCodeV1, message: string): never {
  throw new ArchiveProtocolErrorV1(code, message);
}

export function recordV1(value: unknown, schema: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    failV1('ARCHIVE_PROTOCOL_INVALID', `${schema} must be an object.`);
  }
  return value as Record<string, unknown>;
}

export function exactKeysV1(value: Record<string, unknown>, keys: readonly string[], schema: string): void {
  const actual = Object.keys(value);
  if (actual.length !== keys.length || keys.some((key) => !(key in value))) {
    failV1('ARCHIVE_PROTOCOL_INVALID', `${schema} has unknown or missing fields.`);
  }
}

export function stringV1(value: unknown, field: string, allowEmpty = false): string {
  if (typeof value !== 'string' || (!allowEmpty && value.trim() === '')) {
    failV1('ARCHIVE_PROTOCOL_INVALID', `${field} must be ${allowEmpty ? 'a string' : 'a non-empty string'}.`);
  }
  return value;
}

export function integerV1(value: unknown, field: string, minimum = 0): number {
  if (!Number.isSafeInteger(value) || (value as number) < minimum) {
    failV1('ARCHIVE_PROTOCOL_INVALID', `${field} must be an integer >= ${minimum}.`);
  }
  return value as number;
}

export function schemaVersionV1(value: unknown, schema: string): 1 {
  if (value !== 1) failV1('ARCHIVE_PROTOCOL_INVALID', `${schema}.schemaVersion must be 1.`);
  return 1;
}

const HASH_RE = /^sha256:([0-9a-f]{64})$/;

export function parseHashV1(value: unknown, field = 'hash'): string {
  if (typeof value !== 'string' || !HASH_RE.test(value)) {
    failV1('ARCHIVE_PROTOCOL_HASH_INVALID', `${field} must be sha256:<64 lowercase hex>.`);
  }
  return value;
}

export function hashBytesV1(bytes: Uint8Array): string {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
}

export function hashDigestV1(hash: string): string {
  const parsed = parseHashV1(hash);
  return parsed.slice('sha256:'.length);
}

export type ArchiveObjectKindV1 = 'world' | 'commit' | 'op';

export function parseObjectIdV1(value: unknown, kind: ArchiveObjectKindV1, field = `${kind}Id`): string {
  const prefix = kind === 'world' ? 'world' : kind === 'commit' ? 'commit' : 'op';
  const re = new RegExp(`^${prefix}_[0-9a-f]{32}$`);
  if (typeof value !== 'string' || !re.test(value)) {
    failV1('ARCHIVE_PROTOCOL_INVALID', `${field} must be ${prefix}_<32 lowercase hex>.`);
  }
  return value;
}

export function parseNullableObjectIdV1(value: unknown, kind: ArchiveObjectKindV1, field: string): string | null {
  return value === null ? null : parseObjectIdV1(value, kind, field);
}

export function timestampV1(value: unknown, field: string): string {
  if (typeof value !== 'string') failV1('ARCHIVE_PROTOCOL_INVALID', `${field} must be a UTC timestamp.`);
  const date = new Date(value);
  if (!Number.isFinite(date.getTime()) || date.toISOString() !== value) {
    failV1('ARCHIVE_PROTOCOL_INVALID', `${field} must be canonical UTC ISO-8601.`);
  }
  return value;
}

export function nullableHashV1(value: unknown, field: string): string | null {
  return value === null ? null : parseHashV1(value, field);
}

export function encodeCanonicalJsonV1(value: unknown): Uint8Array {
  return new TextEncoder().encode(`${JSON.stringify(value)}\n`);
}

export function decodeJsonV1(bytes: Uint8Array, schema: string): unknown {
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    failV1('ARCHIVE_PROTOCOL_INVALID', `${schema} must be valid UTF-8.`);
  }
  try {
    return JSON.parse(text);
  } catch {
    failV1('ARCHIVE_PROTOCOL_INVALID', `${schema} must be valid JSON.`);
  }
}

export function sameJsonV1(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}
