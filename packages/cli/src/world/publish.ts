import { randomUUID } from 'node:crypto';
import { link, mkdir, open, readFile, rename, rm } from 'node:fs/promises';
import path from 'node:path';
import {
  createRootTreeV1,
  encodeArchiveCommitV1,
  encodeArchiveManifestV1,
  encodeArchiveOperationV1,
  encodeCurrentPointerV1,
  encodeDayloomPatchCanonicalV1,
  encodeDraftSnapshotCanonicalV1,
  encodeRootTreeCanonicalV1,
  formatBlobPathV1,
  formatCommitPathV1,
  formatDraftRootV1,
  formatDraftSnapshotPathV1,
  formatOperationPathV1,
  formatPatchPathV1,
  formatTreePathV1,
  hashBytesV1,
  hashDayloomPatchV1,
  hashDraftSnapshotV1,
  hashRootTreeV1,
  parseArchiveCommitV1,
  parseArchiveManifestV1,
  parseArchiveOperationV1,
  parseCurrentPointerV1,
  verifyCommitTransitionV1,
  verifyDraftEntryBytesV1,
  verifyDraftSnapshotRelationV1,
  verifyTreeTransitionV1,
  type ArchiveManifestV1,
  type ArchiveMediaTypeV1,
  type DayloomPatchV1,
  type DraftSnapshotV1,
  type RootTreeV1,
} from '@dayloom/archive-protocol';
import { cliErrorV1 } from '../cli/errors.js';
import { classifyWorldV1, readPublishedHeadV1, resolveArchivePathV1, type PublishedHeadV1 } from './read.js';
import { validateHeadIdentityDocumentsV1, validateWorldDocumentSyntaxV1 } from './profile.js';
import { assertPatchWritePolicyV1 } from './write-policy.js';
import { validateWorldProfileWorkspaceV1 } from './domain-validator.js';
import { verifyPublishedArchiveV1 } from './verify.js';
import type { ScannedWorkspaceV1, WorkspaceFileV1 } from '../workspace/files.js';

export interface PublishFileV1 {
  mediaType: ArchiveMediaTypeV1;
  bytes: Uint8Array;
}

export interface PreparedDraftSnapshotV1 {
  snapshot: Readonly<DraftSnapshotV1>;
  files: ReadonlyMap<string, Uint8Array>;
}

export interface PublishInputV1 {
  worldRoot: string;
  base: PublishedHeadV1 | null;
  patch: Readonly<DayloomPatchV1>;
  targetTree: Readonly<RootTreeV1>;
  afterFiles: ReadonlyMap<string, PublishFileV1>;
  draftSnapshot?: PreparedDraftSnapshotV1;
  initialTitle?: string;
}

export interface PublishResultV1 {
  mode: 'published';
  baseCommitId: string | null;
  commitId: string;
  revision: number;
  operationId: string;
  patchHash: string;
  changedPaths: number;
  controlChanged: boolean;
}

const objectId = (prefix: 'world' | 'commit' | 'op') => `${prefix}_${randomUUID().replaceAll('-', '').toLowerCase()}`;

async function installImmutableV1(target: string, bytes: Uint8Array): Promise<void> {
  await mkdir(path.dirname(target), { recursive: true });
  const temporary = `${target}.tmp-${randomUUID()}`;
  const handle = await open(temporary, 'wx');
  try {
    await handle.writeFile(bytes);
    await handle.sync();
  } finally {
    await handle.close();
  }
  try {
    await link(temporary, target);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    const existing = await readFile(target);
    if (!Buffer.from(existing).equals(Buffer.from(bytes))) throw cliErrorV1('WORLD_INVALID', `Immutable Archive object already exists with different bytes: ${target}.`);
  } finally {
    await rm(temporary, { force: true }).catch(() => undefined);
  }
}

async function atomicWriteV1(target: string, bytes: Uint8Array, exclusive: boolean): Promise<void> {
  await mkdir(path.dirname(target), { recursive: true });
  const temporary = `${target}.tmp-${randomUUID()}`;
  const handle = await open(temporary, 'wx');
  try {
    await handle.writeFile(bytes);
    await handle.sync();
  } finally {
    await handle.close();
  }
  try {
    if (exclusive) await link(temporary, target);
    else await rename(temporary, target);
  } finally {
    await rm(temporary, { force: true }).catch(() => undefined);
  }
}

async function assertExactFileV1(target: string, expected: Uint8Array): Promise<void> {
  const actual = await readFile(target);
  if (!Buffer.from(actual).equals(Buffer.from(expected))) throw cliErrorV1('WORLD_INVALID', `Installed Archive object does not match expected bytes: ${target}.`);
}

export function validatePreparedPublicationV1(input: PublishInputV1): void {
  try {
    assertPatchWritePolicyV1(input.patch);
    verifyTreeTransitionV1(input.base?.tree ?? createRootTreeV1([]), input.targetTree, input.patch.changes);
    verifyDraftSnapshotRelationV1({ patch: input.patch, snapshot: input.draftSnapshot?.snapshot ?? null });
    const baseCommitId = input.base?.commit.id ?? null;
    if (input.patch.baseCommitId !== baseCommitId) throw new Error('Patch baseCommitId does not match pinned base.');
    if (input.patch.control.before !== null && input.base === null) throw new Error('Initial Patch cannot have base control.');
    if (input.base !== null && JSON.stringify(input.patch.control.before) !== JSON.stringify(input.base.commit.control)) throw new Error('Patch base control does not match pinned base.');
    if ((input.base === null) !== (input.patch.command === 'init')) throw new Error('init/base relation is inconsistent.');
    if ((input.base === null) !== (input.initialTitle !== undefined)) throw new Error('Initial title is required exactly for init publication.');
    const targetByPath = new Map(input.targetTree.entries.map((entry) => [entry.path, entry] as const));
    for (const change of input.patch.changes) {
      if (change.afterBlobHash === null) continue;
      const supplied = input.afterFiles.get(change.path);
      const entry = targetByPath.get(change.path);
      if (!supplied || !entry || hashBytesV1(supplied.bytes) !== change.afterBlobHash || entry.blobHash !== change.afterBlobHash || entry.mediaType !== supplied.mediaType || entry.bytes !== supplied.bytes.byteLength) {
        throw new Error(`Publication bytes do not match Patch target: ${change.path}.`);
      }
    }
    if (input.afterFiles.size !== input.patch.changes.filter((change) => change.afterBlobHash !== null).length) throw new Error('afterFiles contains paths outside Patch after states.');
    if (input.draftSnapshot) {
      if (hashDraftSnapshotV1(input.draftSnapshot.snapshot) !== input.patch.draftSnapshotHash) throw new Error('Draft snapshot hash does not match Patch.');
      if (input.draftSnapshot.files.size !== input.draftSnapshot.snapshot.entries.length) throw new Error('Draft snapshot file set is incomplete.');
      for (const entry of input.draftSnapshot.snapshot.entries) {
        const bytes = input.draftSnapshot.files.get(entry.path);
        if (!bytes) throw new Error(`Draft snapshot bytes are missing: ${entry.path}.`);
        verifyDraftEntryBytesV1({ snapshot: input.draftSnapshot.snapshot, path: entry.path, bytes });
      }
    }
  } catch (error) {
    throw cliErrorV1('PATCH_INVALID', error instanceof Error ? error.message : 'Publication input is invalid.');
  }
}

export async function assertPinnedWorldUnchangedV1(worldRoot: string, base: PublishedHeadV1 | null): Promise<void> {
  if (base === null) {
    const classified = await classifyWorldV1(worldRoot);
    if (classified.status !== 'uninitialized') throw cliErrorV1(classified.status === 'invalid' ? 'WORLD_INVALID' : 'WORLD_CONFLICT', 'World is no longer uninitialized.');
    return;
  }
  let current: PublishedHeadV1;
  try { current = await readPublishedHeadV1(worldRoot); }
  catch (error) { throw cliErrorV1('WORLD_INVALID', error instanceof Error ? error.message : 'Visible World is invalid.'); }
  if (
    current.current.revision !== base.current.revision ||
    current.commit.id !== base.commit.id ||
    current.commit.rootTreeHash !== base.commit.rootTreeHash
  ) throw cliErrorV1('WORLD_CONFLICT', 'Published World changed during the operation.');
}

async function validateTargetIdentityV1(input: {
  worldRoot: string;
  manifest: ArchiveManifestV1;
  tree: RootTreeV1;
}): Promise<void> {
  await validateHeadIdentityDocumentsV1({
    manifest: input.manifest,
    readDocument: async (documentPath) => {
      const entry = input.tree.entries.find((candidate) => candidate.path === documentPath);
      if (!entry) throw new Error(`Required World document is missing: ${documentPath}.`);
      const bytes = await readFile(resolveArchivePathV1(input.worldRoot, formatBlobPathV1(entry.blobHash)));
      if (hashBytesV1(bytes) !== entry.blobHash || bytes.byteLength !== entry.bytes) throw new Error(`Target blob is invalid: ${documentPath}.`);
      return { mediaType: entry.mediaType, bytes };
    },
  });
}

export async function validateArchivedTargetWorldV1(worldRoot: string, tree: RootTreeV1): Promise<void> {
  const files = new Map<string, WorkspaceFileV1>();
  for (const entry of tree.entries) {
    const bytes = await readFile(resolveArchivePathV1(worldRoot, formatBlobPathV1(entry.blobHash)));
    if (bytes.byteLength !== entry.bytes || hashBytesV1(bytes) !== entry.blobHash) {
      throw cliErrorV1('WORLD_INVALID', `Target blob is invalid: ${entry.path}.`);
    }
    validateWorldDocumentSyntaxV1(entry.path, entry.mediaType, bytes);
    files.set(entry.path, {
      path: entry.path,
      mediaType: entry.mediaType,
      bytes,
      blobHash: entry.blobHash,
    });
  }
  const workspace: ScannedWorkspaceV1 = Object.freeze({ files, tree });
  try { validateWorldProfileWorkspaceV1(workspace); }
  catch (error) {
    throw cliErrorV1('VALIDATION_FAILED', error instanceof Error ? error.message : 'Target World profile is invalid.');
  }
}

export async function publishV1(input: PublishInputV1): Promise<PublishResultV1> {
  validatePreparedPublicationV1(input);
  await mkdir(input.worldRoot, { recursive: true });

  const timestamp = new Date().toISOString();
  const operationId = objectId('op');
  const commitId = objectId('commit');
  const patchHash = hashDayloomPatchV1(input.patch);
  const operation = parseArchiveOperationV1({ schemaVersion: 1, id: operationId, command: input.patch.command, patchHash, createdAt: timestamp });
  const commit = parseArchiveCommitV1({
    schemaVersion: 1,
    id: commitId,
    revision: (input.base?.commit.revision ?? 0) + 1,
    parentCommitId: input.base?.commit.id ?? null,
    operationId,
    createdAt: timestamp,
    rootTreeHash: hashRootTreeV1(input.targetTree),
    control: input.patch.control.after,
  });
  verifyCommitTransitionV1({ parent: input.base?.commit ?? null, baseTree: input.base?.tree ?? null, operation, patch: input.patch, commit, targetTree: input.targetTree });

  const manifest = input.base?.manifest ?? parseArchiveManifestV1({
    schemaVersion: 1,
    worldId: objectId('world'),
    title: input.initialTitle,
    createdAt: timestamp,
  });
  const current = parseCurrentPointerV1({ schemaVersion: 1, revision: commit.revision, commitId: commit.id, updatedAt: timestamp });

  const patchBytes = encodeDayloomPatchCanonicalV1(input.patch);
  const treeBytes = encodeRootTreeCanonicalV1(input.targetTree);
  const operationBytes = encodeArchiveOperationV1(operation);
  const commitBytes = encodeArchiveCommitV1(commit);
  const currentBytes = encodeCurrentPointerV1(current);
  const manifestBytes = encodeArchiveManifestV1(manifest);

  const lockPath = path.join(input.worldRoot, '.locks', 'publish.lock');
  await mkdir(path.dirname(lockPath), { recursive: true });
  let lock;
  try { lock = await open(lockPath, 'wx'); }
  catch (error) { throw cliErrorV1('WORLD_CONFLICT', 'World publication is already locked.', undefined); }

  let visible = false;
  let manifestInstalled = false;
  try {
    await assertPinnedWorldUnchangedV1(input.worldRoot, input.base);
    if (input.base !== null) await verifyPublishedArchiveV1(input.worldRoot);
    for (const [documentPath, file] of input.afterFiles) {
      await installImmutableV1(resolveArchivePathV1(input.worldRoot, formatBlobPathV1(hashBytesV1(file.bytes))), file.bytes);
      const change = input.patch.changes.find((candidate) => candidate.path === documentPath);
      if (!change || change.afterBlobHash !== hashBytesV1(file.bytes)) throw cliErrorV1('PATCH_INVALID', `Unexpected publication file: ${documentPath}.`);
    }
    await installImmutableV1(resolveArchivePathV1(input.worldRoot, formatTreePathV1(commit.rootTreeHash)), treeBytes);

    if (input.draftSnapshot) {
      const snapshotBytes = encodeDraftSnapshotCanonicalV1(input.draftSnapshot.snapshot);
      await installImmutableV1(resolveArchivePathV1(input.worldRoot, formatDraftSnapshotPathV1(operationId)), snapshotBytes);
      for (const entry of input.draftSnapshot.snapshot.entries) {
        await installImmutableV1(resolveArchivePathV1(input.worldRoot, `${formatDraftRootV1(operationId)}/${entry.path}`), input.draftSnapshot.files.get(entry.path)!);
      }
    }
    await installImmutableV1(resolveArchivePathV1(input.worldRoot, formatPatchPathV1(operationId)), patchBytes);
    await installImmutableV1(resolveArchivePathV1(input.worldRoot, formatOperationPathV1(operationId)), operationBytes);
    await installImmutableV1(resolveArchivePathV1(input.worldRoot, formatCommitPathV1(commitId)), commitBytes);

    await assertExactFileV1(resolveArchivePathV1(input.worldRoot, formatTreePathV1(commit.rootTreeHash)), treeBytes);
    await assertExactFileV1(resolveArchivePathV1(input.worldRoot, formatPatchPathV1(operationId)), patchBytes);
    await assertExactFileV1(resolveArchivePathV1(input.worldRoot, formatOperationPathV1(operationId)), operationBytes);
    await assertExactFileV1(resolveArchivePathV1(input.worldRoot, formatCommitPathV1(commitId)), commitBytes);
    if (input.draftSnapshot) {
      await assertExactFileV1(resolveArchivePathV1(input.worldRoot, formatDraftSnapshotPathV1(operationId)), encodeDraftSnapshotCanonicalV1(input.draftSnapshot.snapshot));
      for (const entry of input.draftSnapshot.snapshot.entries) {
        await assertExactFileV1(
          resolveArchivePathV1(input.worldRoot, `${formatDraftRootV1(operationId)}/${entry.path}`),
          input.draftSnapshot.files.get(entry.path)!,
        );
      }
    }
    await validateArchivedTargetWorldV1(input.worldRoot, input.targetTree);
    await validateTargetIdentityV1({ worldRoot: input.worldRoot, manifest, tree: input.targetTree });

    if (input.base === null) {
      await atomicWriteV1(resolveArchivePathV1(input.worldRoot, 'manifest.json'), manifestBytes, true);
      manifestInstalled = true;
    }
    await atomicWriteV1(resolveArchivePathV1(input.worldRoot, 'current.json'), currentBytes, input.base === null);
    visible = true;
  } catch (error) {
    if (input.base === null && manifestInstalled && !visible) await rm(resolveArchivePathV1(input.worldRoot, 'manifest.json'), { force: true }).catch(() => undefined);
    throw error;
  } finally {
    await lock.close().catch(() => undefined);
    await rm(lockPath, { force: true }).catch(() => undefined);
  }

  return {
    mode: 'published',
    baseCommitId: input.base?.commit.id ?? null,
    commitId,
    revision: commit.revision,
    operationId,
    patchHash,
    changedPaths: input.patch.changes.length,
    controlChanged: JSON.stringify(input.patch.control.before) !== JSON.stringify(input.patch.control.after),
  };
}
