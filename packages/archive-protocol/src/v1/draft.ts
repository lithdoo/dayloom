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

export interface DraftSnapshotEntryV1 {
  order: number;
  path: string;
  bytes: number;
  sha256: string;
}

export interface DraftSnapshotV1 {
  schemaVersion: 1;
  mode: 'files' | 'directory';
  entries: readonly DraftSnapshotEntryV1[];
}

export function parseDraftSnapshotV1(value: unknown): Readonly<DraftSnapshotV1> {
  const o = recordV1(value, 'DraftSnapshotV1');
  exactKeysV1(o, ['schemaVersion', 'mode', 'entries'], 'DraftSnapshotV1');
  schemaVersionV1(o.schemaVersion, 'DraftSnapshotV1');
  if (o.mode !== 'files' && o.mode !== 'directory') failV1('ARCHIVE_PROTOCOL_INVALID', 'DraftSnapshotV1.mode is invalid.');
  if (!Array.isArray(o.entries) || o.entries.length === 0) failV1('ARCHIVE_PROTOCOL_INVALID', 'DraftSnapshotV1.entries must be a non-empty array.');
  const entries = o.entries.map((entry, index) => parseEntryV1(entry, index));
  validateEntriesV1(o.mode, entries);
  return Object.freeze({ schemaVersion: 1, mode: o.mode, entries: Object.freeze(entries) });
}

function parseEntryV1(value: unknown, index: number): Readonly<DraftSnapshotEntryV1> {
  const schema = `DraftSnapshotV1.entries[${index}]`;
  const o = recordV1(value, schema);
  exactKeysV1(o, ['order', 'path', 'bytes', 'sha256'], schema);
  return Object.freeze({
    order: integerV1(o.order, `${schema}.order`, 1),
    path: parseDraftArchivePathV1(o.path),
    bytes: integerV1(o.bytes, `${schema}.bytes`, 0),
    sha256: parseHashV1(o.sha256, `${schema}.sha256`),
  });
}

export function parseDraftArchivePathV1(value: unknown): string {
  if (typeof value !== 'string' || value === '' || value.includes('\0') || value.includes('\\') || value.startsWith('/') || value.endsWith('/')) {
    failV1('ARCHIVE_PROTOCOL_PATH_INVALID', 'Draft archive path is invalid.');
  }
  const segments = value.split('/');
  if (segments.some((segment) => segment === '' || segment === '.' || segment === '..' || /[\u0000-\u001f]/.test(segment))) {
    failV1('ARCHIVE_PROTOCOL_PATH_INVALID', 'Draft archive path contains an invalid segment.');
  }
  return value;
}

function validateEntriesV1(mode: DraftSnapshotV1['mode'], entries: readonly DraftSnapshotEntryV1[]): void {
  const paths = new Set<string>();
  let previousPath: string | null = null;
  entries.forEach((entry, index) => {
    if (entry.order !== index + 1) failV1('ARCHIVE_PROTOCOL_INVALID', 'Draft snapshot order must be contiguous and start at 1.');
    if (paths.has(entry.path)) failV1('ARCHIVE_PROTOCOL_PATH_INVALID', `Draft snapshot repeats path: ${entry.path}.`);
    paths.add(entry.path);
    if (mode === 'files') {
      const expectedPrefix = `files/${String(index + 1).padStart(4, '0')}/`;
      if (!entry.path.startsWith(expectedPrefix) || entry.path.slice(expectedPrefix.length).includes('/')) {
        failV1('ARCHIVE_PROTOCOL_PATH_INVALID', `Draft files snapshot path must use ${expectedPrefix}<basename>.`);
      }
    } else {
      if (!entry.path.startsWith('root/') || entry.path === 'root/') {
        failV1('ARCHIVE_PROTOCOL_PATH_INVALID', 'Draft directory snapshot paths must be under root/.');
      }
      if (previousPath !== null && previousPath >= entry.path) {
        failV1('ARCHIVE_PROTOCOL_INVALID', 'Draft directory snapshot entries must be sorted by canonical path.');
      }
      previousPath = entry.path;
    }
  });
}

export function encodeDraftSnapshotCanonicalV1(value: DraftSnapshotV1): Uint8Array {
  const snapshot = parseDraftSnapshotV1(value);
  return encodeCanonicalJsonV1({
    schemaVersion: 1,
    mode: snapshot.mode,
    entries: snapshot.entries.map((entry) => ({
      order: entry.order,
      path: entry.path,
      bytes: entry.bytes,
      sha256: entry.sha256,
    })),
  });
}

export function hashDraftSnapshotV1(value: DraftSnapshotV1): string {
  return hashBytesV1(encodeDraftSnapshotCanonicalV1(value));
}
