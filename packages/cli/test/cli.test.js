import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  createDayloomPatchV1,
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
  parseDraftSnapshotV1,
} from '@dayloom/archive-protocol';
import {
  availableMutationCommandsV1,
  buildPatchFromTargetTreeV1,
  changedAfterFilesV1,
  executeCliV1,
  materializeWorkspaceV1,
  parseArgvV1,
  publishV1,
  readPublishedHeadV1,
  runVerifyV1,
  scanWorkspaceV1,
} from '../dist/index.js';

const timestamp = '2026-08-28T00:00:00.000Z';
const encoder = new TextEncoder();

async function writeArchiveFile(root, relative, bytes) {
  const target = path.join(root, ...relative.split('/'));
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, bytes);
}

async function makePublishedWorld() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'dayloom-cli-v1-'));
  const descriptorBytes = encoder.encode('{"schemaVersion":1,"profile":"dayloom","profileVersion":1}\n');
  const worldBytes = encoder.encode('schemaVersion: 1\ntitle: Test World\nstatus: active\n');
  const draftBytes = encoder.encode('# Init Draft\n');
  const descriptorHash = hashBytesV1(descriptorBytes);
  const worldHash = hashBytesV1(worldBytes);

  const tree = createRootTreeV1([
    { path: 'profile/dayloom.json', blobHash: descriptorHash, mediaType: 'application/json', bytes: descriptorBytes.byteLength },
    { path: 'state/world.yaml', blobHash: worldHash, mediaType: 'application/yaml', bytes: worldBytes.byteLength },
  ]);
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
    changes: [
      { path: 'profile/dayloom.json', beforeBlobHash: null, afterBlobHash: descriptorHash },
      { path: 'state/world.yaml', beforeBlobHash: null, afterBlobHash: worldHash },
    ],
  });
  const operation = {
    schemaVersion: 1,
    id: 'op_11111111111111111111111111111111',
    command: 'init',
    patchHash: hashDayloomPatchV1(patch),
    createdAt: timestamp,
  };
  const commit = {
    schemaVersion: 1,
    id: 'commit_11111111111111111111111111111111',
    revision: 1,
    parentCommitId: null,
    operationId: operation.id,
    createdAt: timestamp,
    rootTreeHash: hashRootTreeV1(tree),
    control: patch.control.after,
  };
  const manifest = {
    schemaVersion: 1,
    worldId: 'world_11111111111111111111111111111111',
    title: 'Test World',
    createdAt: timestamp,
  };
  const current = {
    schemaVersion: 1,
    revision: 1,
    commitId: commit.id,
    updatedAt: timestamp,
  };

  await writeArchiveFile(root, 'manifest.json', encodeArchiveManifestV1(manifest));
  await writeArchiveFile(root, 'current.json', encodeCurrentPointerV1(current));
  await writeArchiveFile(root, formatBlobPathV1(descriptorHash), descriptorBytes);
  await writeArchiveFile(root, formatBlobPathV1(worldHash), worldBytes);
  await writeArchiveFile(root, formatTreePathV1(commit.rootTreeHash), encodeRootTreeCanonicalV1(tree));
  await writeArchiveFile(root, formatCommitPathV1(commit.id), encodeArchiveCommitV1(commit));
  await writeArchiveFile(root, formatOperationPathV1(operation.id), encodeArchiveOperationV1(operation));
  await writeArchiveFile(root, formatPatchPathV1(operation.id), encodeDayloomPatchCanonicalV1(patch));
  await writeArchiveFile(root, formatDraftSnapshotPathV1(operation.id), encodeDraftSnapshotCanonicalV1(snapshot));
  await writeArchiveFile(root, `${formatDraftRootV1(operation.id)}/files/0001/init.md`, draftBytes);

  return { root, worldHash };
}

test('argv grammar and availability are strict', () => {
  const parsed = parseArgvV1(['plan', './world', '--draft', 'a.md', '--draft', 'b.md', '--base', 'commit_x', '--json']);
  assert.equal(parsed.command, 'plan');
  assert.deepEqual(parsed.drafts, ['a.md', 'b.md']);
  assert.equal(parsed.json, true);
  assert.deepEqual(availableMutationCommandsV1({ status: 'published', control: { phase: 'idle', day: null, lastSettledDay: null } }), ['plan', 'revise']);
  assert.throws(() => parseArgvV1(['plan', './world', '--draft', 'a.md', '--draft-dir', 'drafts']));
  assert.throws(() => parseArgvV1(['status', './world', '--dry-run']));
});

test('status and verify close over a new Archive history', async () => {
  const fixture = await makePublishedWorld();
  try {
    const status = await executeCliV1(['status', fixture.root, '--json']);
    assert.deepEqual(status.result, {
      status: 'published',
      revision: 1,
      commitId: 'commit_11111111111111111111111111111111',
      phase: 'idle',
      day: null,
      lastSettledDay: null,
      availableCommands: ['plan', 'revise'],
    });
    const verified = await runVerifyV1(fixture.root);
    assert.deepEqual(verified, {
      valid: true,
      revision: 1,
      commitId: 'commit_11111111111111111111111111111111',
      commitsVerified: 1,
    });
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test('Workspace diff publishes a second commit that verifies from its Patch', async () => {
  const fixture = await makePublishedWorld();
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), 'dayloom-workspace-v1-'));
  try {
    const base = await readPublishedHeadV1(fixture.root);
    await materializeWorkspaceV1({ worldRoot: fixture.root, tree: base.tree, workspaceRoot });
    await mkdir(path.join(workspaceRoot, 'custom'), { recursive: true });
    await writeFile(path.join(workspaceRoot, 'custom', 'note.md'), '# Note\n');
    const workspace = await scanWorkspaceV1(workspaceRoot);

    const draftBytes = encoder.encode('# Revise Draft\n');
    const snapshot = parseDraftSnapshotV1({
      schemaVersion: 1,
      mode: 'files',
      entries: [{ order: 1, path: 'files/0001/revise.md', bytes: draftBytes.byteLength, sha256: hashBytesV1(draftBytes) }],
    });
    const patch = buildPatchFromTargetTreeV1({
      command: 'revise',
      baseCommitId: base.commit.id,
      baseTree: base.tree,
      targetTree: workspace.tree,
      draftSnapshotHash: hashDraftSnapshotV1(snapshot),
      beforeControl: base.commit.control,
      afterControl: base.commit.control,
    });
    const result = await publishV1({
      worldRoot: fixture.root,
      base,
      patch,
      targetTree: workspace.tree,
      afterFiles: changedAfterFilesV1(patch, workspace),
      draftSnapshot: { snapshot, files: new Map([['files/0001/revise.md', draftBytes]]) },
    });
    assert.equal(result.revision, 2);
    assert.equal(result.changedPaths, 1);
    const verified = await runVerifyV1(fixture.root);
    assert.equal(verified.revision, 2);
    assert.equal(verified.commitsVerified, 2);
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test('verify rejects tampered blob bytes', async () => {
  const fixture = await makePublishedWorld();
  try {
    const target = path.join(fixture.root, ...formatBlobPathV1(fixture.worldHash).split('/'));
    await writeFile(target, encoder.encode('tampered'));
    await assert.rejects(() => runVerifyV1(fixture.root), (error) => error?.code === 'WORLD_INVALID');
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test('status reports incomplete Archive as invalid rather than guessing', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'dayloom-cli-invalid-'));
  try {
    await writeFile(path.join(root, 'manifest.json'), '{}\n');
    const executed = await executeCliV1(['status', root, '--json']);
    assert.equal(executed.result.status, 'invalid');
    assert.deepEqual(executed.result.availableCommands, []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
