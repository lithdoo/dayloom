import { lstat, readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import {
  encodeArchiveCommitV1,
  encodeArchiveOperationV1,
  encodeDayloomPatchCanonicalV1,
  encodeDraftSnapshotCanonicalV1,
  encodeRootTreeCanonicalV1,
  formatBlobPathV1,
  formatCommitPathV1,
  formatDraftRootV1,
  formatDraftSnapshotPathV1,
  formatOperationPathV1,
  formatOperationRootV1,
  formatPatchPathV1,
  formatTreePathV1,
  hashBytesV1,
  parseArchiveCommitV1,
  parseArchiveOperationV1,
  parseDayloomPatchV1,
  parseDraftSnapshotV1,
  parseRootTreeV1,
  verifyCommitTransitionV1,
  verifyDraftEntryBytesV1,
  verifyDraftSnapshotRelationV1,
  type ArchiveCommitV1,
  type ArchiveMediaTypeV1,
  type ArchiveOperationV1,
  type DayloomPatchV1,
  type DraftSnapshotV1,
  type RootTreeV1,
} from '@dayloom/archive-protocol';
import { CliErrorV1, cliErrorV1 } from '../cli/errors.js';
import { assertPatchWritePolicyV1 } from './write-policy.js';
import {
  pathExistsV1,
  readCanonicalJsonFileV1,
  readPublishedHeadV1,
  resolveArchivePathV1,
} from './read.js';
import { validateHeadIdentityDocumentsV1, validateWorldDocumentSyntaxV1 } from './profile.js';

interface CommitNodeV1 {
  commit: Readonly<ArchiveCommitV1>;
  tree: Readonly<RootTreeV1>;
  operation: Readonly<ArchiveOperationV1>;
  patch: Readonly<DayloomPatchV1>;
  snapshot: Readonly<DraftSnapshotV1> | null;
}

export interface VerifyResultV1 {
  valid: true;
  revision: number;
  commitId: string;
  commitsVerified: number;
}

async function readNodeV1(worldRoot: string, commitId: string): Promise<CommitNodeV1> {
  const commit = (await readCanonicalJsonFileV1({
    target: resolveArchivePathV1(worldRoot, formatCommitPathV1(commitId)),
    schema: `commit ${commitId}`,
    parse: parseArchiveCommitV1,
    encode: encodeArchiveCommitV1,
  })).value;
  const tree = (await readCanonicalJsonFileV1({
    target: resolveArchivePathV1(worldRoot, formatTreePathV1(commit.rootTreeHash)),
    schema: `tree ${commit.rootTreeHash}`,
    parse: parseRootTreeV1,
    encode: encodeRootTreeCanonicalV1,
  })).value;
  const operation = (await readCanonicalJsonFileV1({
    target: resolveArchivePathV1(worldRoot, formatOperationPathV1(commit.operationId)),
    schema: `operation ${commit.operationId}`,
    parse: parseArchiveOperationV1,
    encode: encodeArchiveOperationV1,
  })).value;
  const patch = (await readCanonicalJsonFileV1({
    target: resolveArchivePathV1(worldRoot, formatPatchPathV1(commit.operationId)),
    schema: `patch for ${commit.operationId}`,
    parse: parseDayloomPatchV1,
    encode: encodeDayloomPatchCanonicalV1,
  })).value;

  let snapshot: Readonly<DraftSnapshotV1> | null = null;
  const snapshotTarget = resolveArchivePathV1(worldRoot, formatDraftSnapshotPathV1(commit.operationId));
  const draftRoot = resolveArchivePathV1(worldRoot, formatDraftRootV1(commit.operationId));
  if (patch.draftSnapshotHash !== null) {
    snapshot = (await readCanonicalJsonFileV1({
      target: snapshotTarget,
      schema: `Draft snapshot for ${commit.operationId}`,
      parse: parseDraftSnapshotV1,
      encode: encodeDraftSnapshotCanonicalV1,
    })).value;
    await verifyDraftArtifactSetV1(draftRoot, snapshot);
  } else if (await pathExistsV1(snapshotTarget) || await pathExistsV1(draftRoot)) {
    throw cliErrorV1('WORLD_INVALID', `Deterministic operation ${commit.operationId} contains Draft artifacts.`);
  }
  verifyDraftSnapshotRelationV1({ patch, snapshot });
  return { commit, tree, operation, patch, snapshot };
}

async function verifyDraftArtifactSetV1(root: string, snapshot: DraftSnapshotV1): Promise<void> {
  const actual = await walkRegularFilesV1(root);
  const expected = snapshot.entries.map((entry) => entry.path).sort();
  if (actual.length !== expected.length || actual.some((entry, index) => entry !== expected[index])) {
    throw cliErrorV1('WORLD_INVALID', 'Draft archive files do not exactly match draft-snapshot.json.');
  }
  for (const entry of snapshot.entries) {
    const bytes = await readFile(path.join(root, ...entry.path.split('/')));
    verifyDraftEntryBytesV1({ snapshot, path: entry.path, bytes });
  }
}

async function walkRegularFilesV1(root: string): Promise<string[]> {
  let rootStat;
  try { rootStat = await lstat(root); } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw cliErrorV1('WORLD_INVALID', 'Draft archive directory is missing.');
    throw error;
  }
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) throw cliErrorV1('WORLD_INVALID', 'Draft archive root must be a real directory.');
  const result: string[] = [];
  const visit = async (directory: string, prefix: string): Promise<void> => {
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      const relative = prefix === '' ? entry.name : `${prefix}/${entry.name}`;
      const target = path.join(directory, entry.name);
      const stat = await lstat(target);
      if (stat.isSymbolicLink()) throw cliErrorV1('WORLD_INVALID', `Draft archive contains a symbolic link: ${relative}.`);
      if (stat.isDirectory()) await visit(target, relative);
      else if (stat.isFile()) result.push(relative);
      else throw cliErrorV1('WORLD_INVALID', `Draft archive contains a special file: ${relative}.`);
    }
  };
  await visit(root, '');
  return result.sort();
}

async function verifyTreeBlobsV1(worldRoot: string, tree: RootTreeV1): Promise<void> {
  for (const entry of tree.entries) {
    const target = resolveArchivePathV1(worldRoot, formatBlobPathV1(entry.blobHash));
    const stat = await lstat(target).catch((error) => {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw cliErrorV1('WORLD_INVALID', `Missing blob ${entry.blobHash}.`);
      throw error;
    });
    if (!stat.isFile() || stat.isSymbolicLink()) throw cliErrorV1('WORLD_INVALID', `Blob is not a regular file: ${entry.blobHash}.`);
    const bytes = await readFile(target);
    if (bytes.byteLength !== entry.bytes || hashBytesV1(bytes) !== entry.blobHash) {
      throw cliErrorV1('WORLD_INVALID', `Blob bytes do not match tree entry: ${entry.path}.`);
    }
    validateWorldDocumentSyntaxV1(entry.path, entry.mediaType, bytes);
  }
}

async function readDocumentV1(worldRoot: string, tree: RootTreeV1, documentPath: string): Promise<{ mediaType: ArchiveMediaTypeV1; bytes: Uint8Array }> {
  const entry = tree.entries.find((candidate) => candidate.path === documentPath);
  if (!entry) throw cliErrorV1('WORLD_INVALID', `Required World document is missing: ${documentPath}.`);
  const bytes = await readFile(resolveArchivePathV1(worldRoot, formatBlobPathV1(entry.blobHash)));
  if (bytes.byteLength !== entry.bytes || hashBytesV1(bytes) !== entry.blobHash) throw cliErrorV1('WORLD_INVALID', `World document blob is invalid: ${documentPath}.`);
  return { mediaType: entry.mediaType, bytes };
}

async function verifyPublishedArchiveInnerV1(worldRoot: string): Promise<VerifyResultV1> {
  const head = await readPublishedHeadV1(worldRoot);
  const seen = new Set<string>();
  let currentId: string | null = head.commit.id;
  let commitsVerified = 0;

  while (currentId !== null) {
    if (seen.has(currentId)) throw cliErrorV1('WORLD_INVALID', 'Commit history contains a cycle.');
    seen.add(currentId);
    const node = await readNodeV1(worldRoot, currentId);
    await verifyTreeBlobsV1(worldRoot, node.tree);
    try { assertPatchWritePolicyV1(node.patch); } catch (error) {
      throw cliErrorV1('WORLD_INVALID', error instanceof Error ? error.message : 'Patch write policy is invalid.');
    }

    if (node.commit.parentCommitId === null) {
      verifyCommitTransitionV1({
        parent: null,
        baseTree: null,
        operation: node.operation,
        patch: node.patch,
        commit: node.commit,
        targetTree: node.tree,
      });
      currentId = null;
    } else {
      const parent = await readNodeV1(worldRoot, node.commit.parentCommitId);
      verifyCommitTransitionV1({
        parent: parent.commit,
        baseTree: parent.tree,
        operation: node.operation,
        patch: node.patch,
        commit: node.commit,
        targetTree: node.tree,
      });
      currentId = parent.commit.id;
    }
    commitsVerified += 1;
  }

  if (commitsVerified !== head.commit.revision) throw cliErrorV1('WORLD_INVALID', 'Commit revision does not match reachable history length.');
  await validateHeadIdentityDocumentsV1({
    manifest: head.manifest,
    readDocument: (documentPath) => readDocumentV1(worldRoot, head.tree, documentPath),
  });

  return { valid: true, revision: head.commit.revision, commitId: head.commit.id, commitsVerified };
}

export async function verifyPublishedArchiveV1(worldRoot: string): Promise<VerifyResultV1> {
  try {
    return await verifyPublishedArchiveInnerV1(worldRoot);
  } catch (error) {
    if (error instanceof CliErrorV1 && error.code === 'WORLD_INVALID') throw error;
    throw cliErrorV1('WORLD_INVALID', error instanceof Error ? error.message : 'World verification failed.');
  }
}

void formatOperationRootV1;
