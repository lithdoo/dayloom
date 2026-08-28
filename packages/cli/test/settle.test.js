import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import YAML from 'yaml';
import {
  buildTargetControlV1,
  createRootTreeV1,
  expectedMediaTypeV1,
  hashBytesV1,
  hashDraftSnapshotV1,
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

function draftSnapshot(name, text) {
  const bytes = encoder.encode(text);
  const snapshot = parseDraftSnapshotV1({
    schemaVersion: 1,
    mode: 'files',
    entries: [{ order: 1, path: `files/0001/${name}`, bytes: bytes.byteLength, sha256: hashBytesV1(bytes) }],
  });
  return { snapshot, files: new Map([[`files/0001/${name}`, bytes]]) };
}

function filesToTree(files) {
  return createRootTreeV1([...files.entries()].map(([documentPath, bytes]) => ({
    path: documentPath,
    blobHash: hashBytesV1(bytes),
    mediaType: expectedMediaTypeV1(documentPath),
    bytes: bytes.byteLength,
  })));
}

async function initSettlementWorld() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'dayloom-settle-world-'));
  const files = validWorldFiles('Settlement World', {
    'state/calendar.yaml': 'schemaVersion: 1\ncurrentDay: null\nelapsed: 0h\n',
    'state/variables.yaml': 'schemaVersion: 1\nvariables:\n  mood: calm\n',
  });
  const tree = filesToTree(files);
  const draft = draftSnapshot('init.md', '# Init\n');
  const patch = buildPatchFromTargetTreeV1({
    command: 'init',
    baseCommitId: null,
    baseTree: null,
    targetTree: tree,
    draftSnapshotHash: hashDraftSnapshotV1(draft.snapshot),
    beforeControl: null,
    afterControl: buildTargetControlV1('init', null),
  });
  await publishV1({
    worldRoot: root,
    base: null,
    patch,
    targetTree: tree,
    afterFiles: new Map([...files.entries()].map(([documentPath, bytes]) => [documentPath, { mediaType: expectedMediaTypeV1(documentPath), bytes }])),
    draftSnapshot: draft,
    initialTitle: 'Settlement World',
  });
  return root;
}

async function publishDraftWorkspaceMutation(root, command, writes, draftName) {
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), `dayloom-${command}-workspace-`));
  try {
    const base = await readPublishedHeadV1(root);
    await materializeWorkspaceV1({ worldRoot: root, tree: base.tree, workspaceRoot });
    for (const [documentPath, text] of Object.entries(writes)) {
      const target = path.join(workspaceRoot, ...documentPath.split('/'));
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, text, 'utf8');
    }
    const workspace = await scanWorkspaceV1(workspaceRoot);
    const draft = draftSnapshot(draftName, `# ${command}\n`);
    const patch = buildPatchFromTargetTreeV1({
      command,
      baseCommitId: base.commit.id,
      baseTree: base.tree,
      targetTree: workspace.tree,
      draftSnapshotHash: hashDraftSnapshotV1(draft.snapshot),
      beforeControl: base.commit.control,
      afterControl: buildTargetControlV1(command, base.commit.control),
    });
    return await publishV1({
      worldRoot: root,
      base,
      patch,
      targetTree: workspace.tree,
      afterFiles: changedAfterFilesV1(patch, workspace),
      draftSnapshot: draft,
    });
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
}

async function readWorkspaceYaml(root, documentPath) {
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), 'dayloom-read-workspace-'));
  try {
    const head = await readPublishedHeadV1(root);
    await materializeWorkspaceV1({ worldRoot: root, tree: head.tree, workspaceRoot });
    return YAML.parse(await readFile(path.join(workspaceRoot, ...documentPath.split('/')), 'utf8'));
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
}

test('settle applies structured event patches and publishes a new verified version', async () => {
  const root = await initSettlementWorld();
  try {
    await publishDraftWorkspaceMutation(root, 'plan', {
      'days/day1/plan.json': '{"version":1,"intent":"test settlement"}\n',
    }, 'plan.md');

    const play = await publishDraftWorkspaceMutation(root, 'play', {
      'days/day1/play.json': '{"version":1}\n',
      'days/day1/play-index.json': '{"version":1,"eventIds":["event1"]}\n',
      'days/day1/events/index.yaml': 'schemaVersion: 1\nids:\n  - event1\n',
      'days/day1/events/event1/scene.md': '# Scene\nSomething happens.\n',
      'days/day1/events/event1/dialogue.md': '# Dialogue\nHello.\n',
      'days/day1/events/event1/user-action.md': 'Continue.\n',
      'days/day1/events/event1/event.yaml': 'schemaVersion: 1\nid: event1\nbeatId: null\ntitle: Turning Point\nlocationId: null\nparticipantIds: []\nstatus: resolved\n',
      'days/day1/events/event1/result.yaml': 'schemaVersion: 1\nsummary: The situation changed.\nlearnedFacts:\n  - The situation can change.\ntimeAdvanced: 2h\ncompletedBeatIds: []\nskippedBeatIds: []\nendDay: true\n',
      'days/day1/events/event1/state-patch.yaml': 'schemaVersion: 1\nchanges:\n  - op: set-world-variable\n    key: mood\n    expected: calm\n    value: focused\n',
    }, 'play.md');

    const awaiting = await readPublishedHeadV1(root);
    assert.equal(awaiting.commit.control.phase, 'awaiting-settle');
    assert.equal(awaiting.commit.control.day, 'day1');

    const dryRun = await executeCliV1(['settle', root, '--base', play.commitId, '--dry-run', '--json']);
    assert.equal(dryRun.result.mode, 'dry-run');
    assert.equal(dryRun.result.eventsSettled, 1);
    assert.equal(dryRun.result.patch.command, 'settle');
    assert.equal((await readPublishedHeadV1(root)).commit.id, play.commitId);
    assert.equal((await readWorkspaceYaml(root, 'state/variables.yaml')).variables.mood, 'calm');

    const settled = await executeCliV1(['settle', root, '--base', play.commitId, '--json']);
    assert.equal(settled.result.mode, 'published');
    assert.equal(settled.result.revision, 4);

    const head = await readPublishedHeadV1(root);
    assert.equal(head.commit.control.phase, 'idle');
    assert.equal(head.commit.control.day, null);
    assert.equal(head.commit.control.lastSettledDay, 'day1');
    assert.equal((await readWorkspaceYaml(root, 'state/variables.yaml')).variables.mood, 'focused');
    assert.equal((await readWorkspaceYaml(root, 'state/calendar.yaml')).elapsed, '2h');
    assert.equal((await readWorkspaceYaml(root, 'memory/facts.yaml')).facts.length, 1);
    assert.deepEqual((await readWorkspaceYaml(root, 'days/day1/settlement.yaml')).eventIds, ['event1']);
    assert.equal((await runVerifyV1(root)).commitsVerified, 4);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('settle refuses a state patch whose expected value is stale', async () => {
  const root = await initSettlementWorld();
  try {
    await publishDraftWorkspaceMutation(root, 'plan', {
      'days/day1/plan.json': '{"version":1,"intent":"test stale precondition"}\n',
    }, 'plan.md');
    await publishDraftWorkspaceMutation(root, 'play', {
      'days/day1/play.json': '{"version":1}\n',
      'days/day1/play-index.json': '{"version":1,"eventIds":["event1"]}\n',
      'days/day1/events/index.yaml': 'schemaVersion: 1\nids:\n  - event1\n',
      'days/day1/events/event1/scene.md': '# Scene\nSomething happens.\n',
      'days/day1/events/event1/dialogue.md': '# Dialogue\nHello.\n',
      'days/day1/events/event1/user-action.md': 'Continue.\n',
      'days/day1/events/event1/event.yaml': 'schemaVersion: 1\nid: event1\nbeatId: null\ntitle: Turning Point\nlocationId: null\nparticipantIds: []\nstatus: resolved\n',
      'days/day1/events/event1/result.yaml': 'schemaVersion: 1\nsummary: The situation changed.\nlearnedFacts: []\ntimeAdvanced: null\ncompletedBeatIds: []\nskippedBeatIds: []\nendDay: true\n',
      'days/day1/events/event1/state-patch.yaml': 'schemaVersion: 1\nchanges:\n  - op: set-world-variable\n    key: mood\n    expected: wrong\n    value: focused\n',
    }, 'play.md');

    const before = await readPublishedHeadV1(root);
    await assert.rejects(
      () => executeCliV1(['settle', root, '--json']),
      (error) => error?.code === 'VALIDATION_FAILED' && /precondition failed/.test(error.message),
    );
    assert.equal((await readPublishedHeadV1(root)).commit.id, before.commit.id);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
