import {
  encodeCanonicalJsonV1,
  exactKeysV1,
  failV1,
  hashBytesV1,
  nullableHashV1,
  parseHashV1,
  parseNullableObjectIdV1,
  recordV1,
  schemaVersionV1,
} from './common.js';
import {
  controlChangedV1,
  parseWorldControlV1,
  type DayloomCommandV1,
  type WorldControlV1,
} from './control.js';
import { compareWorldDocumentPathsV1, parseWorldDocumentPathV1, portableCollisionKeyV1 } from './path.js';

export interface DayloomPatchChangeV1 {
  path: string;
  beforeBlobHash: string | null;
  afterBlobHash: string | null;
}

export interface DayloomPatchV1 {
  schemaVersion: 1;
  baseCommitId: string | null;
  command: DayloomCommandV1;
  draftSnapshotHash: string | null;
  control: {
    before: WorldControlV1 | null;
    after: WorldControlV1;
  };
  changes: readonly DayloomPatchChangeV1[];
}

export function parseDayloomCommandV1(value: unknown, field = 'command'): DayloomCommandV1 {
  if (value !== 'init' && value !== 'plan' && value !== 'play' && value !== 'revise' && value !== 'settle' && value !== 'abandon') {
    failV1('ARCHIVE_PROTOCOL_INVALID', `${field} is invalid.`);
  }
  return value;
}

export function parseDayloomPatchV1(value: unknown): Readonly<DayloomPatchV1> {
  const o = recordV1(value, 'DayloomPatchV1');
  exactKeysV1(o, ['schemaVersion', 'baseCommitId', 'command', 'draftSnapshotHash', 'control', 'changes'], 'DayloomPatchV1');
  schemaVersionV1(o.schemaVersion, 'DayloomPatchV1');
  const command = parseDayloomCommandV1(o.command);
  const baseCommitId = parseNullableObjectIdV1(o.baseCommitId, 'commit', 'DayloomPatchV1.baseCommitId');
  const draftSnapshotHash = nullableHashV1(o.draftSnapshotHash, 'DayloomPatchV1.draftSnapshotHash');
  const control = parsePatchControlV1(o.control);
  if (!Array.isArray(o.changes)) failV1('ARCHIVE_PROTOCOL_INVALID', 'DayloomPatchV1.changes must be an array.');
  const changes = o.changes.map((change, index) => parseChangeV1(change, index));
  validateChangeOrderV1(changes);
  if (changes.length === 0 && !controlChangedV1(control.before, control.after)) {
    failV1('ARCHIVE_PROTOCOL_INVALID', 'DayloomPatchV1 cannot be a file-and-control no-op.');
  }
  if (command === 'init' && baseCommitId !== null) failV1('ARCHIVE_PROTOCOL_REFERENCE_INVALID', 'init Patch must have null baseCommitId.');
  if (command !== 'init' && baseCommitId === null) failV1('ARCHIVE_PROTOCOL_REFERENCE_INVALID', `${command} Patch requires baseCommitId.`);
  if ((command === 'settle' || command === 'abandon') && draftSnapshotHash !== null) {
    failV1('ARCHIVE_PROTOCOL_REFERENCE_INVALID', `${command} Patch must not reference a Draft snapshot.`);
  }
  if (command !== 'settle' && command !== 'abandon' && draftSnapshotHash === null) {
    failV1('ARCHIVE_PROTOCOL_REFERENCE_INVALID', `${command} Patch requires a Draft snapshot hash.`);
  }
  return Object.freeze({
    schemaVersion: 1,
    baseCommitId,
    command,
    draftSnapshotHash,
    control,
    changes: Object.freeze(changes),
  });
}

function parsePatchControlV1(value: unknown): Readonly<{ before: WorldControlV1 | null; after: WorldControlV1 }> {
  const o = recordV1(value, 'DayloomPatchV1.control');
  exactKeysV1(o, ['before', 'after'], 'DayloomPatchV1.control');
  return Object.freeze({
    before: o.before === null ? null : parseWorldControlV1(o.before, 'DayloomPatchV1.control.before'),
    after: parseWorldControlV1(o.after, 'DayloomPatchV1.control.after'),
  });
}

function parseChangeV1(value: unknown, index: number): Readonly<DayloomPatchChangeV1> {
  const schema = `DayloomPatchV1.changes[${index}]`;
  const o = recordV1(value, schema);
  exactKeysV1(o, ['path', 'beforeBlobHash', 'afterBlobHash'], schema);
  const beforeBlobHash = o.beforeBlobHash === null ? null : parseHashV1(o.beforeBlobHash, `${schema}.beforeBlobHash`);
  const afterBlobHash = o.afterBlobHash === null ? null : parseHashV1(o.afterBlobHash, `${schema}.afterBlobHash`);
  if (beforeBlobHash === afterBlobHash || (beforeBlobHash === null && afterBlobHash === null)) {
    failV1('ARCHIVE_PROTOCOL_INVALID', `${schema} must describe a real file change.`);
  }
  return Object.freeze({ path: parseWorldDocumentPathV1(o.path), beforeBlobHash, afterBlobHash });
}

function validateChangeOrderV1(changes: readonly DayloomPatchChangeV1[]): void {
  const portable = new Set<string>();
  let previous: string | null = null;
  for (const change of changes) {
    if (previous !== null && compareWorldDocumentPathsV1(previous, change.path) >= 0) {
      failV1('ARCHIVE_PROTOCOL_INVALID', 'DayloomPatchV1.changes must be unique and canonically sorted.');
    }
    previous = change.path;
    const key = portableCollisionKeyV1(change.path);
    if (portable.has(key)) failV1('ARCHIVE_PROTOCOL_PATH_INVALID', `Patch contains a portable path collision: ${change.path}.`);
    portable.add(key);
  }
}

export function createDayloomPatchV1(input: Omit<DayloomPatchV1, 'schemaVersion' | 'changes'> & { changes: readonly DayloomPatchChangeV1[] }): Readonly<DayloomPatchV1> {
  const changes = input.changes
    .map((change) => ({ ...change }))
    .sort((left, right) => compareWorldDocumentPathsV1(left.path, right.path));
  return parseDayloomPatchV1({ schemaVersion: 1, ...input, changes });
}

export function encodeDayloomPatchCanonicalV1(value: DayloomPatchV1): Uint8Array {
  const patch = parseDayloomPatchV1(value);
  return encodeCanonicalJsonV1({
    schemaVersion: 1,
    baseCommitId: patch.baseCommitId,
    command: patch.command,
    draftSnapshotHash: patch.draftSnapshotHash,
    control: {
      before: patch.control.before === null ? null : {
        phase: patch.control.before.phase,
        day: patch.control.before.day,
        lastSettledDay: patch.control.before.lastSettledDay,
      },
      after: {
        phase: patch.control.after.phase,
        day: patch.control.after.day,
        lastSettledDay: patch.control.after.lastSettledDay,
      },
    },
    changes: patch.changes.map((change) => ({
      path: change.path,
      beforeBlobHash: change.beforeBlobHash,
      afterBlobHash: change.afterBlobHash,
    })),
  });
}

export function hashDayloomPatchV1(value: DayloomPatchV1): string {
  return hashBytesV1(encodeDayloomPatchCanonicalV1(value));
}
