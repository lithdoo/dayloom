import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { resolveAssistantCommandV1 } from '../dist/command.js';
import { tempDir } from './support/helpers.mjs';
import { makePublishedWorld } from './support/world.mjs';

test('no World resolves init and never classifies a fake path', async () => {
  assert.equal((await resolveAssistantCommandV1({ world: null, explicit: null })).command, 'init');
});

test('Published availability controls inference and explicit commands', async () => {
  const root = await tempDir();
  try {
    const idle = path.join(root, 'idle');
    await mkdir(idle);
    await makePublishedWorld(idle);
    await assert.rejects(() => resolveAssistantCommandV1({ world: idle, explicit: null }), (error) => error.code === 'AMBIGUOUS_COMMAND');
    assert.equal((await resolveAssistantCommandV1({ world: idle, explicit: 'plan' })).command, 'plan');

    const planned = path.join(root, 'planned');
    await mkdir(planned);
    await makePublishedWorld(planned, { phase: 'planned', day: 'day1', lastSettledDay: null });
    assert.equal((await resolveAssistantCommandV1({ world: planned, explicit: null })).command, 'play');
    await assert.rejects(() => resolveAssistantCommandV1({ world: planned, explicit: 'revise' }), (error) => error.code === 'NOT_AVAILABLE');
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('uninitialized and invalid World fail closed', async () => {
  const root = await tempDir();
  try {
    await assert.rejects(() => resolveAssistantCommandV1({ world: path.join(root, 'missing'), explicit: null }), (error) => error.code === 'NOT_AVAILABLE');
    const invalid = path.join(root, 'invalid');
    await mkdir(invalid);
    const { writeFile } = await import('node:fs/promises');
    await writeFile(path.join(invalid, 'manifest.json'), '{}');
    await assert.rejects(() => resolveAssistantCommandV1({ world: invalid, explicit: null }), (error) => error.code === 'WORLD_INVALID');
  } finally { await rm(root, { recursive: true, force: true }); }
});
