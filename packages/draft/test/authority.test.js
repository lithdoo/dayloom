import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { resolveAuthorityV1 } from '../dist/authority.js';

async function tempDir() {
  return mkdtemp(path.join(os.tmpdir(), 'dayloom-draft-authority-'));
}

async function layout(root) {
  const world = path.join(root, 'world');
  const drafts = path.join(root, 'drafts');
  const conversationParent = path.join(root, 'sessions');
  await mkdir(world);
  await mkdir(drafts);
  await mkdir(conversationParent);
  const llmConfig = path.join(root, 'llm.toml');
  await writeFile(llmConfig, '[promptpile]\nllm_api_model = "test"\n', 'utf8');
  return { world, drafts, conversation: path.join(conversationParent, 'c1'), llmConfig };
}

test('missing Draft file is allowed when its parent exists', async () => {
  const root = await tempDir();
  try {
    const paths = await layout(root);
    const draft = path.join(paths.drafts, 'new.md');
    const resolved = await resolveAuthorityV1({
      world: paths.world,
      drafts: [draft],
      draftDir: null,
      conversation: paths.conversation,
      llmConfig: paths.llmConfig,
    });
    assert.equal(resolved.draft.mode, 'files');
    assert.equal(resolved.draft.files[0].exists, false);
    assert.equal(resolved.draft.files[0].canonical, path.join(await realpath(paths.drafts), 'new.md'));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('missing Draft parent, overlapping World, and draft-dir/file mix fail closed', async () => {
  const root = await tempDir();
  try {
    const paths = await layout(root);
    await assert.rejects(
      () => resolveAuthorityV1({
        world: paths.world,
        drafts: [path.join(paths.drafts, 'missing', 'new.md')],
        draftDir: null,
        conversation: paths.conversation,
        llmConfig: paths.llmConfig,
      }),
      (error) => error.code === 'AUTHORITY_INVALID',
    );
    await assert.rejects(
      () => resolveAuthorityV1({
        world: paths.world,
        drafts: [path.join(paths.world, 'inside.md')],
        draftDir: null,
        conversation: paths.conversation,
        llmConfig: paths.llmConfig,
      }),
      (error) => error.code === 'AUTHORITY_INVALID' && /overlap/.test(error.message),
    );
    await mkdir(path.join(paths.world, 'nested-draft'));
    await assert.rejects(
      () => resolveAuthorityV1({
        world: paths.world,
        drafts: [],
        draftDir: path.join(paths.world, 'nested-draft'),
        conversation: paths.conversation,
        llmConfig: paths.llmConfig,
      }),
      (error) => error.code === 'AUTHORITY_INVALID',
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('existing Draft symlink is rejected', { skip: process.platform === 'win32' }, async () => {
  const root = await tempDir();
  try {
    const paths = await layout(root);
    const outside = path.join(root, 'outside.md');
    await writeFile(outside, 'nope\n', 'utf8');
    const linked = path.join(paths.drafts, 'linked.md');
    await symlink(outside, linked);
    await assert.rejects(
      () => resolveAuthorityV1({
        world: paths.world,
        drafts: [linked],
        draftDir: null,
        conversation: paths.conversation,
        llmConfig: paths.llmConfig,
      }),
      (error) => error.code === 'AUTHORITY_INVALID',
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('Draft authority must not include the LLM config file', async () => {
  const root = await tempDir();
  try {
    const paths = await layout(root);
    await assert.rejects(
      () => resolveAuthorityV1({
        world: paths.world,
        drafts: [paths.llmConfig],
        draftDir: null,
        conversation: paths.conversation,
        llmConfig: paths.llmConfig,
      }),
      (error) => error.code === 'AUTHORITY_INVALID' && /LLM config/.test(error.message),
    );

    const workspace = path.join(root, 'workspace');
    await mkdir(workspace);
    const nestedConfig = path.join(workspace, 'promptpile.toml');
    await writeFile(nestedConfig, '[promptpile]\nllm_api_model = "test"\n', 'utf8');
    await assert.rejects(
      () => resolveAuthorityV1({
        world: paths.world,
        drafts: [],
        draftDir: workspace,
        conversation: paths.conversation,
        llmConfig: nestedConfig,
      }),
      (error) => error.code === 'AUTHORITY_INVALID' && /LLM config/.test(error.message),
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('Draft directory must already exist and cannot contain the World', async () => {
  const root = await tempDir();
  try {
    const paths = await layout(root);
    await assert.rejects(
      () => resolveAuthorityV1({
        world: paths.world,
        drafts: [],
        draftDir: path.join(root, 'missing-dir'),
        conversation: paths.conversation,
        llmConfig: paths.llmConfig,
      }),
      (error) => error.code === 'AUTHORITY_INVALID',
    );
    await assert.rejects(
      () => resolveAuthorityV1({
        world: paths.world,
        drafts: [],
        draftDir: root,
        conversation: paths.conversation,
        llmConfig: paths.llmConfig,
      }),
      (error) => error.code === 'AUTHORITY_INVALID' && /overlap/.test(error.message),
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
