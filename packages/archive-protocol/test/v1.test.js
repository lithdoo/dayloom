import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createDayloomPatchV1,
  createRootTreeV1,
  encodeDayloomPatchCanonicalV1,
  hashBytesV1,
  hashDayloomPatchV1,
  hashDraftSnapshotV1,
  hashRootTreeV1,
  parseArchiveManifestV1,
  parseDayloomPatchV1,
  parseDraftSnapshotV1,
  verifyCommitTransitionV1,
  verifyCurrentPointerRelationV1,
  verifyDraftEntryBytesV1,
  verifyDraftSnapshotRelationV1,
} from '../dist/index.js';

const timestamp = '2026-08-28T00:00:00.000Z';
const worldBytes = new TextEncoder().encode('schemaVersion: 1\ntitle: Test World\nstatus: active\n');
const worldBlobHash = hashBytesV1(worldBytes);
const draftBytes = new TextEncoder().encode('# Init\n');
const draftSnapshot = parseDraftSnapshotV1({
  schemaVersion: 1,
  mode: 'files',
  entries: [{ order: 1, path: 'files/0001/init.md', bytes: draftBytes.byteLength, sha256: hashBytesV1(draftBytes) }],
});

function operation(id, command, patch) {
  return { schemaVersion: 1, id, command, patchHash: hashDayloomPatchV1(patch), createdAt: timestamp };
}

function commit(id, revision, parentCommitId, operationId, tree, control) {
  return { schemaVersion: 1, id, revision, parentCommitId, operationId, createdAt: timestamp, rootTreeHash: hashRootTreeV1(tree), control };
}

test('Patch canonical bytes and Draft snapshot identity are stable', () => {
  const patch = createDayloomPatchV1({
    baseCommitId: null,
    command: 'init',
    draftSnapshotHash: hashDraftSnapshotV1(draftSnapshot),
    control: { before: null, after: { phase: 'idle', day: null, lastSettledDay: null } },
    changes: [{ path: 'state/world.yaml', beforeBlobHash: null, afterBlobHash: worldBlobHash }],
  });
  const first = encodeDayloomPatchCanonicalV1(patch);
  const second = encodeDayloomPatchCanonicalV1(JSON.parse(new TextDecoder().decode(first)));
  assert.deepEqual(first, second);
  assert.match(hashDayloomPatchV1(patch), /^sha256:[0-9a-f]{64}$/);
  verifyDraftSnapshotRelationV1({ patch, snapshot: draftSnapshot });
  verifyDraftEntryBytesV1({ snapshot: draftSnapshot, path: 'files/0001/init.md', bytes: draftBytes });
});

test('init parent + Patch proves the initial commit', () => {
  const targetTree = createRootTreeV1([
    { path: 'state/world.yaml', blobHash: worldBlobHash, mediaType: 'application/yaml', bytes: worldBytes.byteLength },
  ]);
  const patch = createDayloomPatchV1({
    baseCommitId: null,
    command: 'init',
    draftSnapshotHash: hashDraftSnapshotV1(draftSnapshot),
    control: { before: null, after: { phase: 'idle', day: null, lastSettledDay: null } },
    changes: [{ path: 'state/world.yaml', beforeBlobHash: null, afterBlobHash: worldBlobHash }],
  });
  const op = operation('op_11111111111111111111111111111111', 'init', patch);
  const child = commit('commit_11111111111111111111111111111111', 1, null, op.id, targetTree, patch.control.after);
  verifyCommitTransitionV1({ parent: null, baseTree: null, operation: op, patch, commit: child, targetTree });
  verifyCurrentPointerRelationV1({
    current: { schemaVersion: 1, revision: 1, commitId: child.id, updatedAt: timestamp },
    commit: child,
  });
});

test('control-only settle is a valid version transition', () => {
  const tree = createRootTreeV1([]);
  const before = { phase: 'awaiting-settle', day: 'day1', lastSettledDay: null };
  const after = { phase: 'idle', day: null, lastSettledDay: 'day1' };
  const parent = commit('commit_22222222222222222222222222222222', 7, 'commit_11111111111111111111111111111111', 'op_22222222222222222222222222222222', tree, before);
  const patch = createDayloomPatchV1({
    baseCommitId: parent.id,
    command: 'settle',
    draftSnapshotHash: null,
    control: { before, after },
    changes: [],
  });
  const op = operation('op_33333333333333333333333333333333', 'settle', patch);
  const child = commit('commit_33333333333333333333333333333333', 8, parent.id, op.id, tree, after);
  verifyCommitTransitionV1({ parent, baseTree: tree, operation: op, patch, commit: child, targetTree: tree });
});

test('file-and-control no-op Patch is rejected', () => {
  assert.throws(() => parseDayloomPatchV1({
    schemaVersion: 1,
    baseCommitId: 'commit_11111111111111111111111111111111',
    command: 'revise',
    draftSnapshotHash: `sha256:${'1'.repeat(64)}`,
    control: {
      before: { phase: 'idle', day: null, lastSettledDay: null },
      after: { phase: 'idle', day: null, lastSettledDay: null },
    },
    changes: [],
  }));
});

test('strict durable parser rejects unknown fields', () => {
  assert.throws(() => parseArchiveManifestV1({
    schemaVersion: 1,
    worldId: 'world_11111111111111111111111111111111',
    title: 'World',
    createdAt: timestamp,
    extra: true,
  }));
});

test('tampered tree transition is rejected', () => {
  const baseHash = hashBytesV1(new TextEncoder().encode('before'));
  const afterHash = hashBytesV1(new TextEncoder().encode('after'));
  const baseTree = createRootTreeV1([{ path: 'custom/a.txt', blobHash: baseHash, mediaType: 'text/plain', bytes: 6 }]);
  const targetTree = createRootTreeV1([{ path: 'custom/a.txt', blobHash: afterHash, mediaType: 'text/plain', bytes: 5 }]);
  const before = { phase: 'idle', day: null, lastSettledDay: null };
  const patch = createDayloomPatchV1({
    baseCommitId: 'commit_44444444444444444444444444444444',
    command: 'revise',
    draftSnapshotHash: `sha256:${'2'.repeat(64)}`,
    control: { before, after: before },
    changes: [{ path: 'custom/a.txt', beforeBlobHash: baseHash, afterBlobHash: baseHash }],
  });
  void targetTree;
  assert.throws(() => patch);
});
