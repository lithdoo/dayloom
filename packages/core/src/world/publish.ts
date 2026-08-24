import { link, mkdir, open, readFile, rename, rm } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  buildCandidateTreeV1, compareWorldDocumentPathsV1, createRootTreeV1, encodeRootTreeCanonicalV1,
  formatBlobObjectPathV1, formatCommitObjectPathV2, formatOperationPathV2, formatTreeObjectPathV1,
  hashBlobV1, hashRootTreeV1, parseArchiveCommitV2, parseArchiveManifestV2, parseArchiveOperationV2,
  parseCurrentPointerV2, parseStagingManifestV1, parseWorldDocumentPathV1,
  validateCommitParentRelationV2, validateContentV1, validateOperationStagingRelationV2, validatePreparedTargetRelationV2,
  type ArchiveMediaTypeV1, type StagedChangeV1,
} from '@dayloom/archive-protocol';
import { classifyWorld, readPublishedWorld, validatePublishedProfile, type PublishedWorld } from './read';
import { assertMutationPathAllowedV1, expectedMediaTypeV1 } from './profile/policy';

export type WorldChange =
  | { op: 'put'; path: string; mediaType: ArchiveMediaTypeV1; bytes: Uint8Array }
  | { op: 'delete'; path: string };
export interface PublishMutationInput {
  operationType: 'init' | 'planning' | 'play' | 'revise' | 'settle' | 'abandon-day';
  base: PublishedWorld | null;
  initialManifest?: { worldId: string; title: string };
  changes: readonly WorldChange[];
  control: { phase: 'idle' | 'planned' | 'awaiting-settle'; day: string | null; lastSettledDay: string | null };
}
interface PublicationOptions {
  writeDiagnostic?: (target: string, bytes: Uint8Array) => Promise<void>;
  writeCurrent?: (target: string, bytes: Uint8Array, exclusive: boolean) => Promise<void>;
}
const jsonBytes = (value: unknown) => new TextEncoder().encode(`${JSON.stringify(value, null, 2)}\n`);
const id = (prefix: string) => `${prefix}_${randomUUID().replaceAll('-', '')}`;

export async function installImmutable(target: string, bytes: Uint8Array): Promise<boolean> {
  await mkdir(path.dirname(target), { recursive: true });
  const temporary = `${target}.tmp-${randomUUID()}`;
  let handle;
  try {
    handle = await open(temporary, 'wx'); await handle.writeFile(bytes); await handle.sync(); await handle.close(); handle = undefined;
    try { await link(temporary, target); return true; }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST' || !Buffer.from(await readFile(target)).equals(Buffer.from(bytes))) throw error;
      return false;
    }
  } finally { await handle?.close().catch(() => undefined); await rm(temporary, { force: true }).catch(() => undefined); }
}
async function atomic(target: string, bytes: Uint8Array, exclusive = false) {
  await mkdir(path.dirname(target), { recursive: true });
  const temporary = `${target}.tmp-${randomUUID()}`;
  const handle = await open(temporary, 'wx');
  try { await handle.writeFile(bytes); await handle.sync(); } finally { await handle.close(); }
  try {
    if (exclusive) await link(temporary, target); else await rename(temporary, target);
  } finally { await rm(temporary, { force: true }); }
}
export async function publishMutation(worldRoot: string, input: PublishMutationInput, options: PublicationOptions = {}): Promise<PublishedWorld> {
  validateInput(input);
  const timestamp = new Date().toISOString(), operationId = id('op'), commitId = id('commit');
  const baseRevision = input.base?.commit.revision ?? 0, baseCommitId = input.base?.commit.id ?? null, baseRootTreeHash = input.base?.commit.rootTreeHash ?? null;
  const files = new Map<string, Extract<WorldChange, { op: 'put' }>>();
  const changes = input.changes.map((change): StagedChangeV1 => {
    if (change.op === 'delete') return { op: 'delete', path: change.path };
    files.set(change.path, change);
    return { op: 'put', path: change.path, mediaType: change.mediaType, bytes: change.bytes.byteLength, sha256: hashBlobV1(change.bytes), fileId: id('file') };
  }).sort((a, b) => compareWorldDocumentPathsV1(a.path, b.path));
  const staging = parseStagingManifestV1({ schemaVersion: 1, baseRevision, baseCommitId, baseRootTreeHash, changes });
  const candidate = buildCandidateTreeV1({ baseTree: input.base?.tree ?? createRootTreeV1([]), staging });
  const treeHash = hashRootTreeV1(candidate);
  const operation = parseArchiveOperationV2({ schemaVersion: 2, id: operationId, type: input.operationType, status: 'prepared', baseRevision, baseCommitId, baseRootTreeHash, targetCommitId: commitId, targetRootTreeHash: treeHash, createdAt: timestamp, updatedAt: timestamp, lastError: null });
  const commit = parseArchiveCommitV2({ schemaVersion: 2, id: commitId, revision: baseRevision + 1, parentCommitId: baseCommitId, operationId, createdAt: timestamp, rootTreeHash: treeHash, control: input.control });
  validateOperationStagingRelationV2({ operation, staging }); validateCommitParentRelationV2({ child: commit, parent: input.base?.commit ?? null }); validatePreparedTargetRelationV2({ operation, targetCommit: commit, candidateTree: candidate });
  const manifest = input.base?.manifest ?? parseArchiveManifestV2({ schemaVersion: 2, worldId: input.initialManifest!.worldId, title: input.initialManifest!.title, createdAt: timestamp });
  const lockPath = path.join(worldRoot, '.locks', 'publish.lock'); await mkdir(path.dirname(lockPath), { recursive: true });
  let lock; let visible = false; const created: string[] = [];
  try { lock = await open(lockPath, 'wx'); } catch (error) { throw coded('WORLD_CONFLICT', 'World publication is already locked.', error); }
  try {
    if (input.base === null) {
      const classified = await classifyWorld(worldRoot);
      if (classified.state.status !== 'uninitialized') throw coded(classified.state.status === 'invalid' ? 'WORLD_INVALID' : 'WORLD_CONFLICT', 'World is no longer uninitialized.');
    } else {
      let current: PublishedWorld;
      try { current = await readPublishedWorld(worldRoot); } catch (error) { throw coded('WORLD_INVALID', 'Visible World is invalid.', error); }
      if (current.commit.revision !== baseRevision || current.commit.id !== baseCommitId || current.commit.rootTreeHash !== baseRootTreeHash) throw coded('WORLD_CONFLICT', 'Published World changed during the operation.');
    }
    for (const change of changes) if (change.op === 'put') {
      const target = path.join(worldRoot, ...formatBlobObjectPathV1(change.sha256).split('/'));
      if (await installImmutable(target, files.get(change.path)!.bytes)) created.push(target);
    }
    const treeTarget = path.join(worldRoot, ...formatTreeObjectPathV1(treeHash).split('/'));
    if (await installImmutable(treeTarget, encodeRootTreeCanonicalV1(candidate))) created.push(treeTarget);
    const commitTarget = path.join(worldRoot, ...formatCommitObjectPathV2(commitId).split('/'));
    if (await installImmutable(commitTarget, jsonBytes(commit))) created.push(commitTarget);
    const operationTarget = path.join(worldRoot, ...formatOperationPathV2(operationId).split('/'));
    if (await installImmutable(operationTarget, jsonBytes(operation))) created.push(operationTarget);
    const committed = await validatePublishedProfile(worldRoot, manifest, commit, candidate);
    if (input.base === null) { const target = path.join(worldRoot, 'manifest.json'); await atomic(target, jsonBytes(manifest), true); created.push(target); }
    await (options.writeCurrent ?? atomic)(path.join(worldRoot, 'current.json'), jsonBytes(parseCurrentPointerV2({ schemaVersion: 2, revision: commit.revision, commitId, updatedAt: timestamp })), input.base === null);
    visible = true;
    const diagnosed = parseArchiveOperationV2({ ...operation, status: 'published', updatedAt: new Date().toISOString() });
    try { await (options.writeDiagnostic ?? atomic)(operationTarget, jsonBytes(diagnosed)); } catch { /* diagnostic only */ }
    return committed;
  } catch (error) {
    if (input.base === null && !visible) {
      let cleanupError: unknown;
      for (const target of created.reverse()) try { await rm(target, { force: true }); } catch (failure) { cleanupError ??= failure; }
      if (cleanupError !== undefined && codeOf(error) === '') throw Object.assign(new Error('Initial publication failed and cleanup did not complete.', { cause: cleanupError }), { code: 'INTERNAL_ERROR' });
    }
    throw error;
  } finally { await lock.close().catch(() => undefined); await rm(lockPath, { force: true }).catch(() => undefined); }
}

function validateInput(input: PublishMutationInput) {
  if ((input.base === null) !== (input.operationType === 'init') || (input.base === null) !== (input.initialManifest !== undefined)) throw new Error('Publication base and initial manifest are inconsistent.');
  const paths = new Set<string>();
  for (const change of input.changes) {
    const documentPath = assertMutationPathAllowedV1(input.operationType, parseWorldDocumentPathV1(change.path));
    if (paths.has(documentPath)) throw new Error('Publication change path is invalid or duplicated.');
    paths.add(documentPath);
    if (change.op === 'put') {
      if (change.mediaType !== expectedMediaTypeV1(documentPath)) throw new Error('Publication change mediaType is invalid.');
      validateContentV1(change.bytes, change.mediaType);
    }
  }
}
function coded(code: 'WORLD_CONFLICT' | 'WORLD_INVALID', message: string, cause?: unknown) { return Object.assign(new Error(message, { cause }), { code }); }
function codeOf(error: unknown): string { return typeof error === 'object' && error !== null && 'code' in error ? String((error as { code: unknown }).code) : ''; }
