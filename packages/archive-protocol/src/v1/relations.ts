import { failV1, hashBytesV1, sameJsonV1 } from './common.js';
import { parseArchiveCommitV1, type ArchiveCommitV1 } from './commit.js';
import { validateControlTransitionV1 } from './control.js';
import { parseCurrentPointerV1, type CurrentPointerV1 } from './current.js';
import { hashDraftSnapshotV1, parseDraftSnapshotV1, type DraftSnapshotV1 } from './draft.js';
import { parseArchiveOperationV1, type ArchiveOperationV1 } from './operation.js';
import { hashDayloomPatchV1, parseDayloomPatchV1, type DayloomPatchV1 } from './patch.js';
import { hashRootTreeV1, parseRootTreeV1, verifyTreeTransitionV1, type RootTreeV1 } from './tree.js';

export function verifyCurrentPointerRelationV1(input: {
  current: CurrentPointerV1;
  commit: ArchiveCommitV1;
}): void {
  const current = parseCurrentPointerV1(input.current);
  const commit = parseArchiveCommitV1(input.commit);
  if (current.commitId !== commit.id || current.revision !== commit.revision) {
    failV1('ARCHIVE_PROTOCOL_REFERENCE_INVALID', 'current.json does not identify the supplied commit.');
  }
}

export function verifyCommitTransitionV1(input: {
  parent: ArchiveCommitV1 | null;
  baseTree: RootTreeV1 | null;
  operation: ArchiveOperationV1;
  patch: DayloomPatchV1;
  commit: ArchiveCommitV1;
  targetTree: RootTreeV1;
}): void {
  const parent = input.parent === null ? null : parseArchiveCommitV1(input.parent);
  const baseTree = input.baseTree === null ? null : parseRootTreeV1(input.baseTree);
  const operation = parseArchiveOperationV1(input.operation);
  const patch = parseDayloomPatchV1(input.patch);
  const commit = parseArchiveCommitV1(input.commit);
  const targetTree = parseRootTreeV1(input.targetTree);

  if (commit.operationId !== operation.id) {
    failV1('ARCHIVE_PROTOCOL_REFERENCE_INVALID', 'Commit does not reference the supplied operation.');
  }
  if (operation.command !== patch.command || operation.patchHash !== hashDayloomPatchV1(patch)) {
    failV1('ARCHIVE_PROTOCOL_REFERENCE_INVALID', 'Operation does not anchor the supplied Patch.');
  }
  if (!sameJsonV1(patch.control.after, commit.control)) {
    failV1('ARCHIVE_PROTOCOL_REFERENCE_INVALID', 'Patch target control does not match commit control.');
  }
  if (commit.rootTreeHash !== hashRootTreeV1(targetTree)) {
    failV1('ARCHIVE_PROTOCOL_REFERENCE_INVALID', 'Commit rootTreeHash does not match target tree.');
  }

  if (parent === null) {
    if (baseTree !== null || commit.revision !== 1 || commit.parentCommitId !== null || patch.baseCommitId !== null || patch.command !== 'init' || patch.control.before !== null) {
      failV1('ARCHIVE_PROTOCOL_REFERENCE_INVALID', 'Initial commit relation is invalid.');
    }
    validateControlTransitionV1('init', null, patch.control.after);
    verifyTreeTransitionV1({ schemaVersion: 1, entries: [] }, targetTree, patch.changes);
    return;
  }

  if (baseTree === null) failV1('ARCHIVE_PROTOCOL_REFERENCE_INVALID', 'Non-initial commit requires a base tree.');
  if (commit.parentCommitId !== parent.id || commit.revision !== parent.revision + 1 || patch.baseCommitId !== parent.id) {
    failV1('ARCHIVE_PROTOCOL_REFERENCE_INVALID', 'Commit parent/base relation is invalid.');
  }
  if (parent.rootTreeHash !== hashRootTreeV1(baseTree)) {
    failV1('ARCHIVE_PROTOCOL_REFERENCE_INVALID', 'Parent rootTreeHash does not match base tree.');
  }
  if (!sameJsonV1(patch.control.before, parent.control)) {
    failV1('ARCHIVE_PROTOCOL_REFERENCE_INVALID', 'Patch base control does not match parent control.');
  }
  validateControlTransitionV1(patch.command, parent.control, patch.control.after);
  verifyTreeTransitionV1(baseTree, targetTree, patch.changes);
}

export function verifyDraftSnapshotRelationV1(input: {
  patch: DayloomPatchV1;
  snapshot: DraftSnapshotV1 | null;
}): void {
  const patch = parseDayloomPatchV1(input.patch);
  if (patch.draftSnapshotHash === null) {
    if (input.snapshot !== null) failV1('ARCHIVE_PROTOCOL_REFERENCE_INVALID', 'Deterministic Patch must not have a Draft snapshot.');
    return;
  }
  if (input.snapshot === null) failV1('ARCHIVE_PROTOCOL_REFERENCE_INVALID', 'Draft-driven Patch requires a Draft snapshot.');
  const snapshot = parseDraftSnapshotV1(input.snapshot);
  if (hashDraftSnapshotV1(snapshot) !== patch.draftSnapshotHash) {
    failV1('ARCHIVE_PROTOCOL_REFERENCE_INVALID', 'Patch draftSnapshotHash does not match Draft snapshot.');
  }
}

export function verifyDraftEntryBytesV1(input: {
  snapshot: DraftSnapshotV1;
  path: string;
  bytes: Uint8Array;
}): void {
  const snapshot = parseDraftSnapshotV1(input.snapshot);
  const entry = snapshot.entries.find((candidate) => candidate.path === input.path);
  if (!entry || entry.bytes !== input.bytes.byteLength || entry.sha256 !== hashBytesV1(input.bytes)) {
    failV1('ARCHIVE_PROTOCOL_REFERENCE_INVALID', `Draft bytes do not match snapshot entry: ${input.path}.`);
  }
}
