import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  buildTargetControlV1,
  createDayloomPatchV1,
  createRootTreeV1,
  encodeArchiveCommitV1,
  encodeArchiveManifestV1,
  encodeArchiveOperationV1,
  encodeCurrentPointerV1,
  encodeDayloomPatchCanonicalV1,
  encodeDraftSnapshotCanonicalV1,
  encodeRootTreeCanonicalV1,
  expectedMediaTypeV1,
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
  parseDraftSnapshotV1,
} from '@dayloom/archive-protocol';
import {
  buildPatchFromTargetTreeV1,
  changedAfterFilesV1,
  executeCliV1,
  materializeWorkspaceV1,
  publishV1,
  readPublishedHeadV1,
  runVerifyV1,
  scanWorkspaceV1,
} from '../dist/index.js';
import { validWorldFiles } from './support/valid-world.mjs';

const encoder = new TextEncoder();
const timestamp = '2026-08-28T00:00:00.000Z';

async function put(root, relative, bytes) {
  const target = path.join(root, ...relative.split('/'));
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, bytes);
}

async function makeIdleWorld() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'dayloom-mutation-v1-'));
  const files = validWorldFiles('Mutation World');
  const draftBytes = encoder.encode('# Init\n');
  const tree = createRootTreeV1([...files].map(([documentPath, bytes]) => ({
    path: documentPath,
    blobHash: hashBytesV1(bytes),
    mediaType: expectedMediaTypeV1(documentPath),
    bytes: bytes.byteLength,
  })));
  const snapshot = parseDraftSnapshotV1({
    schemaVersion: 1,
    mode: 'files',
    entries: [{ order: 1, path: 'files/0001/init.md', bytes: draftBytes.byteLength, sha256: hashBytesV1(draftBytes) }],
  });
  const patch = createDayloomPatchV1({
    baseCommitId: null,
    command: 'init',
    draftSnapshotHash: hashDraftSnapshotV1(snapshot),
    control: { before: null, after: { phase: 'idle', day: null, lastSettledDay: null } },
    changes: tree.entries.map((entry) => ({ path: entry.path, beforeBlobHash: null, afterBlobHash: entry.blobHash })),
  });
  const operation = { schemaVersion: 1, id: 'op_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', command: 'init', patchHash: hashDayloomPatchV1(patch), createdAt: timestamp };
  const commit = {
    schemaVersion: 1,
    id: 'commit_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    revision: 1,
    parentCommitId: null,
    operationId: operation.id,
    createdAt: timestamp,
    rootTreeHash: hashRootTreeV1(tree),
    control: patch.control.after,
  };
  const manifest = { schemaVersion: 1, worldId: 'world_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', title: 'Mutation World', createdAt: timestamp };
  const current = { schemaVersion: 1, revision: 1, commitId: commit.id, updatedAt: timestamp };
  await put(root, 'manifest.json', encodeArchiveManifestV1(manifest));
  await put(root, 'current.json', encodeCurrentPointerV1(current));
  for (const bytes of files.values()) await put(root, formatBlobPathV1(hashBytesV1(bytes)), bytes);
  await put(root, formatTreePathV1(commit.rootTreeHash), encodeRootTreeCanonicalV1(tree));
  await put(root, formatCommitPathV1(commit.id), encodeArchiveCommitV1(commit));
  await put(root, formatOperationPathV1(operation.id), encodeArchiveOperationV1(operation));
  await put(root, formatPatchPathV1(operation.id), encodeDayloomPatchCanonicalV1(patch));
  await put(root, formatDraftSnapshotPathV1(operation.id), encodeDraftSnapshotCanonicalV1(snapshot));
  await put(root, `${formatDraftRootV1(operation.id)}/files/0001/init.md`, draftBytes);
  return root;
}

async function publishPlan(root) {
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), 'dayloom-plan-workspace-'));
  try {
    const base = await readPublishedHeadV1(root);
    await materializeWorkspaceV1({ worldRoot: root, tree: base.tree, workspaceRoot });
    const planPath = path.join(workspaceRoot, 'days', 'day1', 'plan.json');
    await Promise.all([
      mkdir(path.join(workspaceRoot, 'days', 'day1', 'dialogue'), { recursive: true }),
      mkdir(path.join(workspaceRoot, 'days', 'day1', 'events'), { recursive: true }),
    ]);
    await Promise.all([
      writeFile(planPath, '{"version":1,"intent":"test"}\n'),
      writeFile(path.join(workspaceRoot, 'days', 'day1', 'timeline.md'), '# Timeline\n'),
      writeFile(path.join(workspaceRoot, 'days', 'day1', 'dialogue', 'planning.md'), '# Planning\n'),
      writeFile(path.join(workspaceRoot, 'days', 'day1', 'events', 'index.yaml'), 'schemaVersion: 1\nids: []\n'),
    ]);
    const workspace = await scanWorkspaceV1(workspaceRoot);
    const draftBytes = encoder.encode('# Plan\n');
    const snapshot = parseDraftSnapshotV1({
      schemaVersion: 1,
      mode: 'files',
      entries: [{ order: 1, path: 'files/0001/plan.md', bytes: draftBytes.byteLength, sha256: hashBytesV1(draftBytes) }],
    });
    const patch = buildPatchFromTargetTreeV1({
      command: 'plan',
      baseCommitId: base.commit.id,
      baseTree: base.tree,
      targetTree: workspace.tree,
      draftSnapshotHash: hashDraftSnapshotV1(snapshot),
      beforeControl: base.commit.control,
      afterControl: buildTargetControlV1('plan', base.commit.control),
    });
    return await publishV1({
      worldRoot: root,
      base,
      patch,
      targetTree: workspace.tree,
      afterFiles: changedAfterFilesV1(patch, workspace),
      draftSnapshot: { snapshot, files: new Map([['files/0001/plan.md', draftBytes]]) },
    });
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
}

test('abandon dry-run is non-mutating and publish removes only current-day documents', async () => {
  const root = await makeIdleWorld();
  try {
    const plan = await publishPlan(root);
    const planned = await readPublishedHeadV1(root);
    assert.equal(planned.commit.control.phase, 'planned');
    assert.ok(planned.tree.entries.some((entry) => entry.path === 'days/day1/plan.json'));

    const dryRun = await executeCliV1(['abandon', root, '--base', plan.commitId, '--dry-run', '--json']);
    assert.equal(dryRun.result.mode, 'dry-run');
    assert.equal(dryRun.result.changedPaths, 4);
    assert.equal(dryRun.result.patch.command, 'abandon');
    assert.equal((await readPublishedHeadV1(root)).commit.id, plan.commitId);

    const published = await executeCliV1(['abandon', root, '--base', plan.commitId, '--json']);
    assert.equal(published.result.mode, 'published');
    assert.equal(published.result.revision, 3);
    const head = await readPublishedHeadV1(root);
    assert.equal(head.commit.control.phase, 'idle');
    assert.equal(head.commit.control.day, null);
    assert.equal(head.commit.control.lastSettledDay, null);
    assert.equal(head.tree.entries.some((entry) => entry.path.startsWith('days/day1/')), false);
    assert.equal((await runVerifyV1(root)).commitsVerified, 3);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('publisher refuses abandon when the visible base graph has a missing unchanged blob', async () => {
  const root = await makeIdleWorld();
  try {
    const plan = await publishPlan(root);
    const before = await readPublishedHeadV1(root);
    const premise = before.tree.entries.find((entry) => entry.path === 'canon/premise.md');
    assert.ok(premise);
    await rm(path.join(root, ...formatBlobPathV1(premise.blobHash).split('/')));
    await assert.rejects(
      () => executeCliV1(['abandon', root, '--base', plan.commitId]),
      (error) => error?.code === 'WORLD_INVALID',
    );
    assert.equal((await readPublishedHeadV1(root)).commit.id, before.commit.id);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('abandon rejects a stale explicit base before publication', async () => {
  const root = await makeIdleWorld();
  try {
    await publishPlan(root);
    await assert.rejects(
      () => executeCliV1(['abandon', root, '--base', 'commit_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', '--json']),
      (error) => error?.code === 'WORLD_CONFLICT',
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
