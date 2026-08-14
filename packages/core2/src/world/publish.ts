import { link, mkdir, open, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  buildCandidateTreeV1, compareWorldDocumentPathsV1, encodeRootTreeCanonicalV1, formatBlobObjectPathV1,
  formatCommitObjectPathV2, formatOperationPathV2, formatTreeObjectPathV1, hashBlobV1, hashRootTreeV1,
  parseArchiveCommitV2, parseArchiveOperationV2, parseCurrentPointerV2, parseStagingManifestV1,
  validateCommitParentRelationV2, validateOperationStagingRelationV2, validatePreparedTargetRelationV2,
  type StagedChangeV1,
} from '@dayloom/archive-protocol';
import type { PlayDocuments } from '../session/submission';
import { readPublishedWorld, type PublishedWorld } from './read';

const jsonBytes = (value: unknown) => new TextEncoder().encode(`${JSON.stringify(value, null, 2)}\n`);
export async function installImmutable(target: string, bytes: Uint8Array): Promise<void> {
  await mkdir(path.dirname(target), { recursive: true });
  const temporary = `${target}.tmp-${randomUUID()}`;
  let handle;
  try {
    handle = await open(temporary, 'wx');
    await handle.writeFile(bytes);
    await handle.sync();
    await handle.close(); handle = undefined;
    try { await link(temporary, target); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST' || !Buffer.from(await readFile(target)).equals(Buffer.from(bytes))) throw error;
    }
  } finally {
    await handle?.close().catch(() => undefined);
    await rm(temporary, { force: true }).catch(() => undefined);
  }
}
async function atomic(target: string, bytes: Uint8Array) {
  const temporary = `${target}.tmp-${randomUUID()}`;
  await writeFile(temporary, bytes, { flag: 'wx' });
  try { await rename(temporary, target); } finally { await rm(temporary, { force: true }); }
}

interface PublicationOptions { writeDiagnostic?: (target: string, bytes: Uint8Array) => Promise<void> }
export async function publishPlay(worldRoot: string, pinned: PublishedWorld, day: string, documents: PlayDocuments, options: PublicationOptions = {}): Promise<PublishedWorld> {
  const playPath = `days/${day}/play.json`, summaryPath = `days/${day}/summary.md`;
  if (pinned.tree.entries.some((entry) => entry.path === playPath || entry.path === summaryPath)) throw Object.assign(new Error('Published Play history must not be overwritten.'), { code: 'SUBMISSION_INVALID' });
  const operationId = `op_${randomUUID().replaceAll('-', '')}`, commitId = `commit_${randomUUID().replaceAll('-', '')}`, timestamp = new Date().toISOString();
  const files = [{ path: playPath, bytes: documents.play, mediaType: 'application/json' as const }, { path: summaryPath, bytes: documents.summary, mediaType: 'text/markdown' as const }];
  const changes: StagedChangeV1[] = files.map((file): StagedChangeV1 => ({ op: 'put', path: file.path, mediaType: file.mediaType, bytes: file.bytes.byteLength, sha256: hashBlobV1(file.bytes), fileId: `file_${randomUUID().replaceAll('-', '')}` })).sort((a, b) => compareWorldDocumentPathsV1(a.path, b.path));
  const staging = parseStagingManifestV1({ schemaVersion: 1, baseRevision: pinned.commit.revision, baseCommitId: pinned.commit.id, baseRootTreeHash: pinned.commit.rootTreeHash, changes });
  const candidate = buildCandidateTreeV1({ baseTree: pinned.tree, staging }), treeHash = hashRootTreeV1(candidate);
  const lockPath = path.join(worldRoot, '.locks', 'publish.lock');
  await mkdir(path.dirname(lockPath), { recursive: true });
  let lock;
  let committed: PublishedWorld | null = null;
  try { lock = await open(lockPath, 'wx'); } catch (error) { throw Object.assign(new Error('World publication is already locked.', { cause: error }), { code: 'WORLD_CONFLICT' }); }
  try {
    let visible: PublishedWorld;
    try { visible = await readPublishedWorld(worldRoot); }
    catch (error) { throw Object.assign(new Error('Published World changed or became invalid during the Session.', { cause: error }), { code: 'WORLD_CONFLICT' }); }
    if (visible.commit.revision !== pinned.commit.revision || visible.commit.id !== pinned.commit.id || visible.commit.rootTreeHash !== pinned.commit.rootTreeHash) throw Object.assign(new Error('Published World changed during the Session.'), { code: 'WORLD_CONFLICT' });
    const operation = parseArchiveOperationV2({ schemaVersion: 2, id: operationId, type: 'play', status: 'prepared', baseRevision: pinned.commit.revision, baseCommitId: pinned.commit.id, baseRootTreeHash: pinned.commit.rootTreeHash, targetCommitId: commitId, targetRootTreeHash: treeHash, createdAt: timestamp, updatedAt: timestamp, lastError: null });
    const commit = parseArchiveCommitV2({ schemaVersion: 2, id: commitId, revision: pinned.commit.revision + 1, parentCommitId: pinned.commit.id, operationId, createdAt: timestamp, rootTreeHash: treeHash, control: { phase: 'awaiting-settle', day, lastSettledDay: pinned.commit.control.lastSettledDay } });
    validateOperationStagingRelationV2({ operation, staging }); validateCommitParentRelationV2({ child: commit, parent: pinned.commit }); validatePreparedTargetRelationV2({ operation, targetCommit: commit, candidateTree: candidate });
    for (const change of changes) {
      if (change.op !== 'put') continue;
      await installImmutable(path.join(worldRoot, ...formatBlobObjectPathV1(change.sha256).split('/')), files.find((file) => file.path === change.path)!.bytes);
    }
    await installImmutable(path.join(worldRoot, ...formatTreeObjectPathV1(treeHash).split('/')), encodeRootTreeCanonicalV1(candidate));
    await installImmutable(path.join(worldRoot, ...formatCommitObjectPathV2(commitId).split('/')), jsonBytes(commit));
    await installImmutable(path.join(worldRoot, ...formatOperationPathV2(operationId).split('/')), jsonBytes(operation));
    await atomic(path.join(worldRoot, 'current.json'), jsonBytes(parseCurrentPointerV2({ schemaVersion: 2, revision: commit.revision, commitId, updatedAt: timestamp })));
    committed = Object.freeze({
      manifest: pinned.manifest, commit, tree: candidate,
      view: Object.freeze({ worldId: pinned.manifest.worldId, title: pinned.manifest.title, revision: commit.revision, commitId: commit.id, phase: commit.control.phase, day: commit.control.day, lastSettledDay: commit.control.lastSettledDay }),
      playContext: null,
    });
    try { committed = await readPublishedWorld(worldRoot); } catch { /* replacement is already the public truth */ }
    const diagnosed = parseArchiveOperationV2({ ...operation, status: 'published', updatedAt: new Date().toISOString() });
    const diagnosticTarget = path.join(worldRoot, ...formatOperationPathV2(operationId).split('/'));
    try { await (options.writeDiagnostic ?? atomic)(diagnosticTarget, jsonBytes(diagnosed)); } catch { /* current.json is already public truth */ }
    return committed;
  } finally {
    try { await lock.close(); await rm(lockPath, { force: true }); }
    catch (error) { if (committed === null) throw error; }
  }
}
