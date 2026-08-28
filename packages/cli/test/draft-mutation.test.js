import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  executeCliV1,
  readPublishedHeadV1,
  runVerifyV1,
} from '../dist/index.js';
import { validWorldFiles, writeWorldFiles } from './support/valid-world.mjs';

async function tempRoot() {
  return mkdtemp(path.join(os.tmpdir(), 'dayloom-draft-mutation-'));
}

function editorFrom(fn) {
  return { edit: fn };
}

async function initializeWorld(root) {
  const draft = path.join(root, 'init.md');
  const world = path.join(root, 'world');
  await writeFile(draft, '# Create a small world\n', 'utf8');
  const seen = [];
  const editor = editorFrom(async (input) => {
    seen.push(input);
    assert.equal(input.command, 'init');
    assert.equal(input.baseCommitId, null);
    assert.equal(input.draft.snapshot.entries[0].path, 'files/0001/init.md');
    assert.equal(new TextDecoder().decode(input.draft.files.get('files/0001/init.md')), '# Create a small world\n');
    await writeWorldFiles(input.workspaceRoot, validWorldFiles('Editor World'));
  });
  const result = await executeCliV1(['init', world, '--draft', draft, '--json'], { draftEditor: editor });
  assert.equal(result.result.mode, 'published');
  assert.equal(result.result.revision, 1);
  assert.equal(seen.length, 1);
  return { world, draft };
}

test('injected editor closes init Draft -> Workspace -> Patch -> Archive', async () => {
  const root = await tempRoot();
  try {
    const { world } = await initializeWorld(root);
    const head = await readPublishedHeadV1(world);
    assert.equal(head.manifest.title, 'Editor World');
    assert.equal(head.commit.control.phase, 'idle');
    assert.ok(head.tree.entries.some((entry) => entry.path === 'profile/dayloom.json'));
    assert.ok(head.tree.entries.some((entry) => entry.path === 'state/world.yaml'));
    assert.equal((await runVerifyV1(world)).commitsVerified, 1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('Draft mutation dry-run produces a Patch without publishing, then revise publishes through the same tail', async () => {
  const root = await tempRoot();
  try {
    const { world } = await initializeWorld(root);
    const draft = path.join(root, 'revise.md');
    await writeFile(draft, '# Add a note\n', 'utf8');
    const editor = editorFrom(async (input) => {
      assert.equal(input.command, 'revise');
      assert.match(input.baseCommitId, /^commit_/);
      const target = path.join(input.workspaceRoot, 'custom', 'note.md');
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, '# Note\nCreated by the editor.\n', 'utf8');
    });

    const before = await readPublishedHeadV1(world);
    const dryRun = await executeCliV1(['revise', world, '--draft', draft, '--dry-run', '--json'], { draftEditor: editor });
    assert.equal(dryRun.result.mode, 'dry-run');
    assert.equal(dryRun.result.changedPaths, 1);
    assert.equal(dryRun.result.patch.command, 'revise');
    assert.equal((await readPublishedHeadV1(world)).commit.id, before.commit.id);

    const published = await executeCliV1(['revise', world, '--draft', draft, '--base', before.commit.id, '--json'], { draftEditor: editor });
    assert.equal(published.result.mode, 'published');
    assert.equal(published.result.revision, 2);
    const head = await readPublishedHeadV1(world);
    assert.ok(head.tree.entries.some((entry) => entry.path === 'custom/note.md'));
    assert.equal((await runVerifyV1(world)).commitsVerified, 2);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('bounded repair can turn an invalid initial edit into a publishable World', async () => {
  const root = await tempRoot();
  const draft = path.join(root, 'init.md');
  const world = path.join(root, 'world');
  try {
    await writeFile(draft, '# Repair this world\n', 'utf8');
    let repairs = 0;
    const editor = {
      async edit(input) {
        await mkdir(path.join(input.workspaceRoot, 'state'), { recursive: true });
        await writeFile(path.join(input.workspaceRoot, 'state', 'world.yaml'), 'schemaVersion: 1\ntitle: Repaired World\nstatus: active\n');
      },
      async repair(input) {
        repairs += 1;
        assert.equal(input.attempt, 1);
        assert.match(input.diagnostics[0].message, /canon\/premise\.md/);
        await writeWorldFiles(input.workspaceRoot, validWorldFiles('Repaired World'));
      },
    };
    const result = await executeCliV1(['init', world, '--draft', draft], { draftEditor: editor });
    assert.equal(result.result.mode, 'published');
    assert.equal(repairs, 1);
    assert.equal((await runVerifyV1(world)).commitsVerified, 1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('bounded repair continues when the diagnostic is unchanged but the Workspace advances', async () => {
  const root = await tempRoot();
  const draft = path.join(root, 'init.md');
  const world = path.join(root, 'world');
  try {
    await writeFile(draft, '# Incremental repair\n');
    let repairs = 0;
    const editor = {
      async edit(input) {
        await mkdir(path.join(input.workspaceRoot, 'state'), { recursive: true });
        await writeFile(path.join(input.workspaceRoot, 'state', 'world.yaml'), 'schemaVersion: 1\ntitle: Incremental World\nstatus: active\n');
      },
      async repair(input) {
        repairs += 1;
        assert.equal(input.maxAttempts, 4);
        if (repairs === 1) {
          const target = path.join(input.workspaceRoot, 'custom', 'repair-progress.md');
          await mkdir(path.dirname(target), { recursive: true });
          await writeFile(target, '# Progress\n');
          return;
        }
        await writeWorldFiles(input.workspaceRoot, validWorldFiles('Incremental World'));
      },
    };
    const result = await executeCliV1(['init', world, '--draft', draft], { draftEditor: editor });
    assert.equal(result.result.mode, 'published');
    assert.equal(repairs, 2);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('Draft dry-run rejects a World that changes while the editor is running', async () => {
  const root = await tempRoot();
  try {
    const { world } = await initializeWorld(root);
    const outerDraft = path.join(root, 'outer.md');
    const innerDraft = path.join(root, 'inner.md');
    await writeFile(outerDraft, '# Outer revision\n');
    await writeFile(innerDraft, '# Inner revision\n');
    const innerEditor = editorFrom(async (input) => {
      const target = path.join(input.workspaceRoot, 'custom', 'inner.md');
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, '# Inner\n');
    });
    const outerEditor = editorFrom(async (input) => {
      await executeCliV1(['revise', world, '--draft', innerDraft], { draftEditor: innerEditor });
      const target = path.join(input.workspaceRoot, 'custom', 'outer.md');
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, '# Outer\n');
    });
    await assert.rejects(
      () => executeCliV1(['revise', world, '--draft', outerDraft, '--dry-run'], { draftEditor: outerEditor }),
      (error) => error?.code === 'WORLD_CONFLICT',
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('command write policy rejects an editor that touches forbidden paths', async () => {
  const root = await tempRoot();
  try {
    const { world } = await initializeWorld(root);
    const draft = path.join(root, 'revise.md');
    await writeFile(draft, '# Bad revision\n', 'utf8');
    const before = await readPublishedHeadV1(world);
    const editor = editorFrom(async (input) => {
      await writeFile(path.join(input.workspaceRoot, 'profile', 'dayloom.json'), '{"schemaVersion":1,"profile":"dayloom","profileVersion":1}\n\n', 'utf8');
    });
    await assert.rejects(
      () => executeCliV1(['revise', world, '--draft', draft, '--json'], { draftEditor: editor }),
      (error) => error?.code === 'PATCH_INVALID' && /revise cannot write profile\/dayloom\.json/.test(error.message),
    );
    assert.equal((await readPublishedHeadV1(world)).commit.id, before.commit.id);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('plan target control and required day document are program-owned constraints', async () => {
  const root = await tempRoot();
  try {
    const { world } = await initializeWorld(root);
    const draft = path.join(root, 'plan.md');
    await writeFile(draft, '# Plan day one\n', 'utf8');
    const editor = editorFrom(async (input) => {
      assert.equal(input.targetControl.phase, 'planned');
      assert.equal(input.targetControl.day, 'day1');
      const target = path.join(input.workspaceRoot, 'days', 'day1', 'plan.json');
      // The command boundary owns protocol directories; an editor only needs write_file semantics.
      await writeFile(target, '{"version":1,"intent":"day one"}\n', 'utf8');
    });
    const result = await executeCliV1(['plan', world, '--draft', draft, '--json'], { draftEditor: editor });
    assert.equal(result.result.revision, 2);
    const head = await readPublishedHeadV1(world);
    assert.equal(head.commit.control.phase, 'planned');
    assert.equal(head.commit.control.day, 'day1');
    assert.ok(head.tree.entries.some((entry) => entry.path === 'days/day1/plan.json'));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
