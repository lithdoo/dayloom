import test from 'node:test';
import assert from 'node:assert/strict';
import { lstat, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  captureDraftDirectoryV1,
  captureDraftFilesV1,
  executeCliV1,
} from '../dist/index.js';

async function tempDir(prefix) {
  return mkdtemp(path.join(os.tmpdir(), prefix));
}

test('repeatable Draft files preserve caller order and exact bytes', async () => {
  const root = await tempDir('dayloom-draft-files-');
  try {
    const firstDir = path.join(root, 'first');
    const secondDir = path.join(root, 'second');
    await mkdir(firstDir);
    await mkdir(secondDir);
    const first = path.join(firstDir, 'notes.md');
    const second = path.join(secondDir, 'notes.md');
    await writeFile(first, '# First\n', 'utf8');
    await writeFile(second, '# Second\n', 'utf8');

    const captured = await captureDraftFilesV1([second, first]);
    assert.equal(captured.snapshot.mode, 'files');
    assert.deepEqual(captured.snapshot.entries.map((entry) => entry.path), [
      'files/0001/notes.md',
      'files/0002/notes.md',
    ]);
    assert.equal(new TextDecoder().decode(captured.files.get('files/0001/notes.md')), '# Second\n');
    assert.equal(new TextDecoder().decode(captured.files.get('files/0002/notes.md')), '# First\n');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('Draft directory snapshot uses canonical relative-path order', async () => {
  const root = await tempDir('dayloom-draft-dir-');
  try {
    await mkdir(path.join(root, 'events'));
    await writeFile(path.join(root, 'play.md'), '# Play\n', 'utf8');
    await writeFile(path.join(root, 'events', 'e002.md'), 'two\n', 'utf8');
    await writeFile(path.join(root, 'events', 'e001.md'), 'one\n', 'utf8');
    const captured = await captureDraftDirectoryV1(root);
    assert.deepEqual(captured.snapshot.entries.map((entry) => entry.path), [
      'root/events/e001.md',
      'root/events/e002.md',
      'root/play.md',
    ]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('Draft directory rejects symlinks where the platform permits creating one', { skip: process.platform === 'win32' }, async () => {
  const root = await tempDir('dayloom-draft-link-');
  try {
    const outside = path.join(root, 'outside.md');
    await writeFile(outside, 'outside\n', 'utf8');
    const draftRoot = path.join(root, 'draft');
    await mkdir(draftRoot);
    await writeFile(path.join(draftRoot, 'play.md'), '# Play\n', 'utf8');
    await symlink(outside, path.join(draftRoot, 'escape.md'));
    await assert.rejects(() => captureDraftDirectoryV1(draftRoot), (error) => error?.code === 'DRAFT_INVALID');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('init --check snapshots Draft without requiring an LLM or writing Archive authority', async () => {
  const root = await tempDir('dayloom-check-world-');
  const draft = path.join(root, 'world.md');
  const world = path.join(root, 'world');
  try {
    await writeFile(draft, '# New World\n', 'utf8');
    const before = await readFile(draft);
    const executed = await executeCliV1(['init', world, '--draft', draft, '--check', '--json']);
    assert.equal(executed.result.mode, 'checked');
    assert.equal(executed.result.baseCommitId, null);
    assert.equal(executed.result.draftMode, 'files');
    assert.equal(executed.result.draftFiles, 1);
    assert.equal((await lstat(world).catch(() => null)), null);
    assert.deepEqual(await readFile(draft), before);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
