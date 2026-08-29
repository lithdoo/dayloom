import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { resolveDraftCommandV1 } from '../dist/command.js';
import { makePublishedWorld } from './support/world.mjs';

async function tempDir() {
  return mkdtemp(path.join(os.tmpdir(), 'dayloom-draft-command-'));
}

test('missing World infers init and rejects an unavailable explicit command', async () => {
  const root = await tempDir();
  try {
    const world = path.join(root, 'missing-world');
    const inferred = await resolveDraftCommandV1(world, null);
    assert.equal(inferred.command, 'init');
    assert.deepEqual(inferred.available, ['init']);
    await assert.rejects(
      () => resolveDraftCommandV1(world, 'plan'),
      (error) => error.code === 'NOT_AVAILABLE' && error.details.availableCommands[0] === 'init',
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('idle World is ambiguous when command is omitted and does not pick a default', async () => {
  const root = await tempDir();
  try {
    const world = path.join(root, 'world');
    await mkdir(world);
    await makePublishedWorld(world);
    await assert.rejects(
      () => resolveDraftCommandV1(world, null),
      (error) => error.code === 'AMBIGUOUS_COMMAND' && error.details.availableCommands.join(',') === 'plan,revise',
    );
    const planned = await resolveDraftCommandV1(world, 'plan');
    assert.equal(planned.command, 'plan');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('planned World infers play', async () => {
  const root = await tempDir();
  try {
    const world = path.join(root, 'world');
    await mkdir(world);
    await makePublishedWorld(world, { phase: 'planned', day: 'day1', lastSettledDay: null });
    const inferred = await resolveDraftCommandV1(world, null);
    assert.equal(inferred.command, 'play');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('invalid World fails closed and is never inferred as init', async () => {
  const root = await tempDir();
  try {
    const world = path.join(root, 'world');
    await mkdir(world);
    await writeFile(path.join(world, 'manifest.json'), '{}\n');
    await assert.rejects(
      () => resolveDraftCommandV1(world, null),
      (error) => error.code === 'WORLD_INVALID',
    );
    await assert.rejects(
      () => resolveDraftCommandV1(world, 'init'),
      (error) => error.code === 'WORLD_INVALID',
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('awaiting-settle has no Draft command', async () => {
  const root = await tempDir();
  try {
    const world = path.join(root, 'world');
    await mkdir(world);
    await makePublishedWorld(world, { phase: 'awaiting-settle', day: 'day1', lastSettledDay: null });
    await assert.rejects(
      () => resolveDraftCommandV1(world, null),
      (error) => error.code === 'NOT_AVAILABLE' && error.details.availableCommands.length === 0,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
