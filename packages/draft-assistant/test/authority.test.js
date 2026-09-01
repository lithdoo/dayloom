import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { resolveAssistantAuthorityV1 } from '../dist/authority.js';
import { tempDir, llmConfig } from './support/helpers.mjs';

test('init resolves Draft/Conversation without manufacturing World authority', async () => {
  const root = await tempDir();
  try {
    const authority = await resolveAssistantAuthorityV1({
      cwd: root, worldRoot: null, drafts: ['draft.md'], draftDir: null,
      conversation: 'conversation', llmConfig: await llmConfig(root),
    });
    assert.equal(authority.archiveRoot, null);
    assert.equal(authority.draft.mode, 'files');
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('Archive overlap with Draft or Conversation is denied canonically', async () => {
  const root = await tempDir();
  try {
    const world = path.join(root, 'world');
    await mkdir(world);
    const config = await llmConfig(root);
    await assert.rejects(() => resolveAssistantAuthorityV1({
      cwd: root, worldRoot: world, drafts: [path.join(world, 'draft.md')], draftDir: null,
      conversation: 'conversation', llmConfig: config,
    }), /World and Draft authority overlap/);
    await mkdir(path.join(world, 'conversation'));
    await writeFile(path.join(root, 'draft.md'), 'x');
    await assert.rejects(() => resolveAssistantAuthorityV1({
      cwd: root, worldRoot: world, drafts: ['draft.md'], draftDir: null,
      conversation: path.join(world, 'conversation'), llmConfig: config,
    }), /World and Conversation authority overlap/);
  } finally { await rm(root, { recursive: true, force: true }); }
});
