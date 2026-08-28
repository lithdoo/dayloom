import {
  encodeCanonicalJsonV1,
  exactKeysV1,
  failV1,
  hashBytesV1,
  integerV1,
  parseHashV1,
  recordV1,
  schemaVersionV1,
} from './common.js';
import {
  compareWorldDocumentPathsV1,
  parseArchiveMediaTypeV1,
  parseWorldDocumentPathV1,
  portableCollisionKeyV1,
  type ArchiveMediaTypeV1,
} from './path.js';

export interface DocumentTreeEntryV1 {
  path: string;
  blobHash: string;
  mediaType: ArchiveMediaTypeV1;
  bytes: number;
}

export interface RootTreeV1 {
  schemaVersion: 1;
  entries: readonly DocumentTreeEntryV1[];
}

export interface TreePatchChangeV1 {
  path: string;
  beforeBlobHash: string | null;
  afterBlobHash: string | null;
}

export function parseRootTreeV1(value: unknown): Readonly<RootTreeV1> {
  const o = recordV1(value, 'RootTreeV1');
  exactKeysV1(o, ['schemaVersion', 'entries'], 'RootTreeV1');
  schemaVersionV1(o.schemaVersion, 'RootTreeV1');
  if (!Array.isArray(o.entries)) failV1('ARCHIVE_PROTOCOL_INVALID', 'RootTreeV1.entries must be an array.');
  const entries = o.entries.map((entry, index) => parseEntryV1(entry, index));
  validateEntriesV1(entries);
  return Object.freeze({ schemaVersion: 1, entries: Object.freeze(entries) });
}

function parseEntryV1(value: unknown, index: number): Readonly<DocumentTreeEntryV1> {
  const schema = `RootTreeV1.entries[${index}]`;
  const o = recordV1(value, schema);
  exactKeysV1(o, ['path', 'blobHash', 'mediaType', 'bytes'], schema);
  const path = parseWorldDocumentPathV1(o.path);
  return Object.freeze({
    path,
    blobHash: parseHashV1(o.blobHash, `${schema}.blobHash`),
    mediaType: parseArchiveMediaTypeV1(o.mediaType, path),
    bytes: integerV1(o.bytes, `${schema}.bytes`, 0),
  });
}

function validateEntriesV1(entries: readonly DocumentTreeEntryV1[]): void {
  const portable = new Set<string>();
  let previous: string | null = null;
  for (const entry of entries) {
    if (previous !== null && compareWorldDocumentPathsV1(previous, entry.path) >= 0) {
      failV1('ARCHIVE_PROTOCOL_INVALID', 'Root tree entries must be unique and canonically sorted.');
    }
    previous = entry.path;
    const key = portableCollisionKeyV1(entry.path);
    if (portable.has(key)) failV1('ARCHIVE_PROTOCOL_PATH_INVALID', `Root tree contains a portable path collision: ${entry.path}.`);
    portable.add(key);
  }
}

export function createRootTreeV1(entries: readonly DocumentTreeEntryV1[]): Readonly<RootTreeV1> {
  const sorted = entries
    .map((entry) => ({ ...entry }))
    .sort((left, right) => compareWorldDocumentPathsV1(left.path, right.path));
  return parseRootTreeV1({ schemaVersion: 1, entries: sorted });
}

export function emptyRootTreeV1(): Readonly<RootTreeV1> {
  return Object.freeze({ schemaVersion: 1, entries: Object.freeze([]) });
}

export function encodeRootTreeCanonicalV1(value: RootTreeV1): Uint8Array {
  const tree = parseRootTreeV1(value);
  return encodeCanonicalJsonV1({
    schemaVersion: 1,
    entries: tree.entries.map((entry) => ({
      path: entry.path,
      blobHash: entry.blobHash,
      mediaType: entry.mediaType,
      bytes: entry.bytes,
    })),
  });
}

export function hashRootTreeV1(value: RootTreeV1): string {
  return hashBytesV1(encodeRootTreeCanonicalV1(value));
}

export function verifyTreeTransitionV1(
  baseValue: RootTreeV1,
  targetValue: RootTreeV1,
  changes: readonly TreePatchChangeV1[],
): void {
  const base = parseRootTreeV1(baseValue);
  const target = parseRootTreeV1(targetValue);
  const baseMap = new Map(base.entries.map((entry) => [entry.path, entry] as const));
  const targetMap = new Map(target.entries.map((entry) => [entry.path, entry] as const));
  const actual = new Map<string, TreePatchChangeV1>();

  for (const change of changes) {
    const path = parseWorldDocumentPathV1(change.path);
    if (actual.has(path)) failV1('ARCHIVE_PROTOCOL_REFERENCE_INVALID', `Patch repeats path: ${path}.`);
    actual.set(path, change);
  }

  const paths = new Set([...baseMap.keys(), ...targetMap.keys()]);
  const expectedChanged = new Set<string>();
  for (const path of paths) {
    const before = baseMap.get(path)?.blobHash ?? null;
    const after = targetMap.get(path)?.blobHash ?? null;
    if (before === after) continue;
    expectedChanged.add(path);
    const change = actual.get(path);
    if (!change || change.beforeBlobHash !== before || change.afterBlobHash !== after) {
      failV1('ARCHIVE_PROTOCOL_REFERENCE_INVALID', `Patch does not describe tree transition for ${path}.`);
    }
  }

  if (actual.size !== expectedChanged.size || [...actual.keys()].some((path) => !expectedChanged.has(path))) {
    failV1('ARCHIVE_PROTOCOL_REFERENCE_INVALID', 'Patch contains changes not present in the tree transition.');
  }
}
