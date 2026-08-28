import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  readCallerLlmConfigV1,
  resolveLlmConfigPathV1,
  resolvePromptpileBoundariesV1,
} from '../dist/index.js';
import {
  DRAFT_FILE_TOOLS_V1,
  WORKSPACE_FILE_TOOLS_V1,
  startFileRuntimeV1,
} from '../dist/ai/file-runtime.js';
import { ReactProcessErrorV1 } from '../dist/ai/react.js';
import { runReactWithDecisionRetriesV1 } from '../dist/ai/promptpile-editor.js';
import { assertWorkspaceMutationPolicyV1 } from '../dist/ai/tool-artifacts.js';
import * as TOML from '@iarna/toml';

async function tempRoot() {
  return mkdtemp(path.join(os.tmpdir(), 'dayloom-ai-boundary-'));
}

test('explicit llm config wins over DAYLOOM_LLM_CONFIG and caller model fields remain intact', async () => {
  const root = await tempRoot();
  try {
    const explicit = path.join(root, 'explicit.toml');
    const fallback = path.join(root, 'fallback.toml');
    await writeFile(explicit, '[[llm_api]]\nname = "deepseek"\nmodel = "deepseek-chat"\nbase_url = "https://api.deepseek.com/v1"\napi_key_env = "DEEPSEEK_API_KEY"\n\n[promptpile]\nllm_api = "deepseek"\n', 'utf8');
    await writeFile(fallback, '[promptpile]\nllm_api_model = "fallback"\n', 'utf8');
    const resolved = await resolveLlmConfigPathV1(explicit, { DAYLOOM_LLM_CONFIG: fallback });
    assert.equal(resolved, path.resolve(explicit));
    const parsed = await readCallerLlmConfigV1(resolved);
    assert.equal(parsed.promptpile.llm_api, 'deepseek');
    assert.equal(parsed.llm_api[0].model, 'deepseek-chat');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('llm config can come from DAYLOOM_LLM_CONFIG', async () => {
  const root = await tempRoot();
  try {
    const config = path.join(root, 'llm.toml');
    await writeFile(config, '[promptpile]\nllm_api_model = "test"\n', 'utf8');
    assert.equal(await resolveLlmConfigPathV1(null, { DAYLOOM_LLM_CONFIG: config }), path.resolve(config));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('missing llm config is a stable LLM_CONFIG_REQUIRED error', async () => {
  await assert.rejects(
    () => resolveLlmConfigPathV1(null, {}),
    (error) => error?.code === 'LLM_CONFIG_REQUIRED',
  );
});

test('caller cannot override Dayloom-owned React or filesystem execution fields', async () => {
  const root = await tempRoot();
  try {
    const react = path.join(root, 'react.toml');
    await writeFile(react, '[promptpile-react]\ntools_file = "evil.toml"\n', 'utf8');
    await assert.rejects(() => readCallerLlmConfigV1(react), (error) => error?.code === 'INVALID_ARGUMENT');

    const tools = path.join(root, 'tools.toml');
    await writeFile(tools, '[promptpile]\ntools_file = "evil.toml"\n', 'utf8');
    await assert.rejects(
      () => readCallerLlmConfigV1(tools),
      (error) => error?.code === 'INVALID_ARGUMENT' && /tools_file/.test(error.message),
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('malformed caller TOML is rejected before any AI process starts', async () => {
  const root = await tempRoot();
  try {
    const config = path.join(root, 'broken.toml');
    await writeFile(config, '[promptpile\nllm_api = "broken"\n', 'utf8');
    await assert.rejects(
      () => readCallerLlmConfigV1(config),
      (error) => error?.code === 'INVALID_ARGUMENT' && /TOML is invalid/.test(error.message),
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('Promptpile adapter resolves only packaged binaries', async () => {
  const boundaries = await resolvePromptpileBoundariesV1();
  assert.ok(path.isAbsolute(boundaries.promptpileBin));
  assert.ok(path.isAbsolute(boundaries.reactBin));
  assert.ok(path.isAbsolute(boundaries.promptpileMcpBin));
  assert.ok(path.isAbsolute(boundaries.filesystemMcp.command));
  assert.equal(typeof boundaries.validateProcessPile, 'function');
});

test('filesystem runtime exposes tree, search, ranged read, guarded directory creation, and write', async () => {
  assert.deepEqual(DRAFT_FILE_TOOLS_V1, [
    'list_directory',
    'directory_tree',
    'search_files',
    'search_files_content',
    'read_file_lines',
  ]);
  assert.deepEqual(WORKSPACE_FILE_TOOLS_V1, [...DRAFT_FILE_TOOLS_V1, 'create_directory', 'write_file']);

  const root = await tempRoot();
  const runtimeRoot = path.join(root, 'runtime');
  const draftRoot = path.join(root, 'draft');
  const workspaceRoot = path.join(root, 'workspace');
  await Promise.all([mkdir(draftRoot), mkdir(workspaceRoot)]);
  const boundaries = await resolvePromptpileBoundariesV1();
  let runtime;
  try {
    runtime = await startFileRuntimeV1({
      runtimeRoot,
      promptpileMcpBin: boundaries.promptpileMcpBin,
      filesystemMcp: boundaries.filesystemMcp,
      draftRoot,
      workspaceRoot,
      command: 'revise',
      targetDay: null,
    });
    const exported = TOML.parse(await readFile(runtime.binding.toolsFile, 'utf8'));
    const names = exported.tools.map((tool) => tool.name).sort();
    assert.deepEqual(names, [
      ...DRAFT_FILE_TOOLS_V1.map((tool) => `mcp__draft__${tool}`),
      ...WORKSPACE_FILE_TOOLS_V1.map((tool) => `mcp__workspace__${tool}`),
    ].sort());
    assert.equal(names.some((name) => /edit_file|move_file|delete/.test(name)), false);
  } finally {
    await runtime?.close();
    await rm(root, { recursive: true, force: true });
  }
});

test('workspace mutation guard permits scoped nesting and rejects program-owned or cross-command paths', () => {
  const root = path.resolve('workspace-guard-test');
  const call = (name, requestedPath) => [{
    id: 'call-1',
    name,
    arguments: JSON.stringify({ path: requestedPath, content: 'x' }),
    raw: {},
  }];
  const revise = { workspaceRoot: root, command: 'revise', targetDay: null };
  assert.doesNotThrow(() => assertWorkspaceMutationPolicyV1(call('mcp__workspace__create_directory', 'custom/story'), revise));
  assert.doesNotThrow(() => assertWorkspaceMutationPolicyV1(call('mcp__workspace__write_file', 'custom/story/foo.md'), revise));
  assert.throws(() => assertWorkspaceMutationPolicyV1(call('mcp__workspace__write_file', 'profile/dayloom.json'), revise), /cannot mutate/);
  assert.throws(() => assertWorkspaceMutationPolicyV1(call('mcp__workspace__write_file', '../outside.md'), revise), /outside/);
  assert.throws(() => assertWorkspaceMutationPolicyV1(
    call('mcp__workspace__write_file', 'days/day1/play-index.json'),
    { workspaceRoot: root, command: 'plan', targetDay: 'day1' },
  ), /cannot mutate/);
  assert.throws(() => assertWorkspaceMutationPolicyV1(
    call('mcp__workspace__write_file', 'profile/dayloom.json'),
    { workspaceRoot: root, command: 'init', targetDay: null },
  ), /cannot mutate/);
  const play = { workspaceRoot: root, command: 'play', targetDay: 'day2' };
  assert.doesNotThrow(() => assertWorkspaceMutationPolicyV1(call('mcp__workspace__create_directory', 'days/day2/events/event2'), play));
  assert.doesNotThrow(() => assertWorkspaceMutationPolicyV1(call('mcp__workspace__write_file', 'days/day2/events/event2/event.yaml'), play));
  assert.throws(() => assertWorkspaceMutationPolicyV1(call('mcp__workspace__create_directory', 'days/day2/events/bonus'), play), /cannot mutate/);
});

test('three invalid React check decisions remain a hard failure', async () => {
  let attempts = 0;
  const terminal = new ReactProcessErrorV1('check_decision_invalid', 'invalid decision');
  await assert.rejects(
    () => runReactWithDecisionRetriesV1(async () => { attempts += 1; throw terminal; }),
    (error) => error === terminal,
  );
  assert.equal(attempts, 3);
});
