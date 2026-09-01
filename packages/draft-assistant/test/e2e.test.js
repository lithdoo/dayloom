import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { executeCliV1 } from '../../cli/dist/index.js';
import { resolvePromptpileBoundariesV1 } from '../dist/binaries.js';
import { startFileRuntimeV1 } from '../dist/runtime.js';
import { executeDraftAssistantV1 } from '../dist/run.js';
import { capture, llmConfig, tempDir } from './support/helpers.mjs';
import { startAssistantOpenAiStub } from './support/assistant-openai-stub.mjs';
import { validWorldFiles } from './support/world.mjs';
import { makePublishedWorld } from './support/world.mjs';

test('init Conversation → Draft hands off to CLI --check without Archive mutation', async () => {
  const root = await tempDir();
  try {
    const draft = path.join(root, 'init.md');
    const world = path.join(root, 'fresh-world');
    const config = await llmConfig(root);
    const result = await executeDraftAssistantV1([
      'init', '--draft', draft, '--conversation', path.join(root, 'conversation'),
      '--llm-config', config, '--message', 'A quiet mystery town.',
    ], {
      cwd: root,
      resolveBoundaries: async () => ({ promptpileBin: 'p', reactBin: 'r', promptpileMcpBin: 'm', filesystemMcp: { command: 'f', argsPrefix: [] } }),
      appendUser: async () => {},
      runDialogue: async () => 0,
      startRuntime: async (input) => ({
        binding: { toolsFile: 'tools', afterHookPath: 'hook', hookConfigPath: 'hook-config', toolNames: [] },
        async close() {},
      }),
      runSync: async () => {
        await writeFile(draft, '# Init\nA quiet mystery town.\n', 'utf8');
        return { code: 0, stdout: '', stderr: '' };
      },
    });
    assert.equal(result.exitCode, 0);
    assert.match(await readFile(draft, 'utf8'), /mystery town/);
    const checked = await executeCliV1(['init', world, '--draft', draft, '--check']);
    assert.equal(checked.result.mode, 'checked');
    assert.equal(checked.result.draftFiles, 1);
    await assert.rejects(() => readFile(path.join(world, 'current.json')));
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('real promptpile-react runs Dialogue then Draft Sync, persists only Dialogue, and skips Sync Final', { timeout: 120_000 }, async () => {
  const root = await tempDir();
  const stub = await startAssistantOpenAiStub({ repairOnce: true });
  const previous = process.env.DAYLOOM_ASSISTANT_TEST_KEY;
  process.env.DAYLOOM_ASSISTANT_TEST_KEY = 'test-key';
  try {
    const config = path.join(root, 'llm.toml');
    await writeFile(config, `[[llm_api]]\nname = "test"\nmodel = "test"\nbase_url = "${stub.baseUrl}"\napi_key_env = "DAYLOOM_ASSISTANT_TEST_KEY"\n\n[promptpile]\nllm_api = "test"\n`, 'utf8');
    const io = capture();
    const draft = path.join(root, 'intent.md');
    const conversation = path.join(root, 'conversation');
    const result = await executeDraftAssistantV1([
      'init', '--draft', draft, '--conversation', conversation,
      '--llm-config', config, '--message', 'Create a quiet mystery town.',
    ], { cwd: root, stdout: io.stdout, stderr: io.stderr });
    assert.equal(result.exitCode, 0, io.err());
    assert.equal(await readFile(draft, 'utf8'), '# Initialization intent\nA quiet town with a central mystery.\n');
    assert.equal(io.out(), 'What should the central mystery conceal?\n');
    const second = await executeDraftAssistantV1([
      'init', '--draft', draft, '--conversation', conversation,
      '--llm-config', config, '--message', 'Keep the mystery understated.',
    ], { cwd: root, stdout: io.stdout, stderr: io.stderr });
    assert.equal(second.exitCode, 0, io.err());
    assert.equal(io.out(), 'What should the central mystery conceal?\nWhat should the central mystery conceal?\n');
    const artifacts = await (await import('node:fs/promises')).readdir(conversation);
    assert.equal(artifacts.filter((name) => /user\.md$/.test(name)).length, 2);
    assert.equal(artifacts.filter((name) => /assistant\.md$/.test(name)).length, 2);
    assert.equal(stub.sawRepairCarryover(), true);
    assert.deepEqual(stub.phases.slice(0, 10), [
      'dialogue-thought', 'dialogue-observe', 'check',
      'dialogue-thought', 'dialogue-observe', 'check', 'dialogue-final',
      'sync-thought', 'sync-observe', 'check',
    ]);
  } finally {
    if (previous === undefined) delete process.env.DAYLOOM_ASSISTANT_TEST_KEY;
    else process.env.DAYLOOM_ASSISTANT_TEST_KEY = previous;
    await stub.close();
    await rm(root, { recursive: true, force: true });
  }
});

test('assistant Draft closes through the real CLI dry-run mutation pipeline', async () => {
  const root = await tempDir();
  try {
    const draft = path.join(root, 'init.md');
    await writeFile(draft, '# Initialization intent\nA quiet mystery town.\n', 'utf8');
    const world = path.join(root, 'world');
    const editor = {
      async edit(input) {
        for (const [relative, bytes] of validWorldFiles('Mystery Town')) {
          const target = path.join(input.workspaceRoot, ...relative.split('/'));
          await mkdir(path.dirname(target), { recursive: true });
          await writeFile(target, bytes);
        }
      },
    };
    const executed = await executeCliV1(['init', world, '--draft', draft, '--dry-run'], { draftEditor: editor });
    assert.equal(executed.result.mode, 'dry-run');
    assert.equal(executed.result.title, 'Mystery Town');
    assert.ok(executed.result.changedPaths > 0);
    await assert.rejects(() => readFile(path.join(world, 'current.json')));
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('real React max-step policy fails closed before Sync', { timeout: 120_000 }, async () => {
  const root = await tempDir();
  const stub = await startAssistantOpenAiStub({ alwaysReject: true });
  const previous = process.env.DAYLOOM_ASSISTANT_TEST_KEY;
  process.env.DAYLOOM_ASSISTANT_TEST_KEY = 'test-key';
  try {
    const config = path.join(root, 'llm.toml');
    await writeFile(config, `[[llm_api]]\nname = "test"\nmodel = "test"\nbase_url = "${stub.baseUrl}"\napi_key_env = "DAYLOOM_ASSISTANT_TEST_KEY"\n\n[promptpile]\nllm_api = "test"\n`, 'utf8');
    const draft = path.join(root, 'intent.md');
    const result = await executeDraftAssistantV1([
      'init', '--draft', draft, '--conversation', path.join(root, 'conversation'),
      '--llm-config', config, '--message', 'Create a mystery.',
    ], { cwd: root, ...capture() });
    assert.notEqual(result.exitCode, 0);
    assert.equal(result.startedDialogue, true);
    assert.equal(result.startedSync, false);
    await assert.rejects(() => readFile(draft));
    assert.equal(stub.phases.filter((phase) => phase === 'dialogue-observe').length, 4);
    assert.equal(stub.phases.includes('dialogue-final'), false);
    assert.equal(stub.phases.includes('sync-thought'), false);
  } finally {
    if (previous === undefined) delete process.env.DAYLOOM_ASSISTANT_TEST_KEY;
    else process.env.DAYLOOM_ASSISTANT_TEST_KEY = previous;
    await stub.close();
    await rm(root, { recursive: true, force: true });
  }
});

test('world-only file runtime exports only read tools', async () => {
  const root = await tempDir();
  let runtime;
  try {
    const worldView = path.join(root, 'world-view');
    await mkdir(worldView);
    await writeFile(path.join(worldView, 'premise.md'), '# Premise\n');
    const boundaries = await resolvePromptpileBoundariesV1();
    runtime = await startFileRuntimeV1({
      runtimeRoot: path.join(root, 'runtime'), promptpileMcpBin: boundaries.promptpileMcpBin,
      filesystemMcp: boundaries.filesystemMcp, worldRoot: worldView, draft: null,
    });
    assert.ok(runtime.binding.toolNames.length > 0);
    assert.equal(runtime.binding.toolNames.every((name) => name.startsWith('mcp__world__')), true);
    assert.equal(runtime.binding.toolNames.some((name) => /write|create|delete/.test(name)), false);
  } finally {
    await runtime?.close();
    for (let attempt = 0; attempt < 40; attempt += 1) {
      try { await rm(root, { recursive: true, force: true }); break; }
      catch (error) {
        if (!['EBUSY', 'EPERM', 'ENOTEMPTY'].includes(error.code) || attempt === 39) throw error;
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
    }
  }
});

test('plan, play, and revise Drafts each close through CLI --dry-run', async () => {
  const root = await tempDir();
  try {
    const cases = [
      {
        command: 'plan', control: { phase: 'idle', day: null, lastSettledDay: null },
        files: {
          'days/day1/plan.json': '{"version":1,"intent":"investigate"}\n',
          'days/day1/timeline.md': '# Timeline\n',
          'days/day1/dialogue/planning.md': '# Planning\n',
          'days/day1/events/index.yaml': 'schemaVersion: 1\nids: []\n',
        },
      },
      {
        command: 'play', control: { phase: 'planned', day: 'day1', lastSettledDay: null },
        files: {
          'days/day1/play-index.json': '{"version":1,"eventIds":["event1"]}\n',
          'days/day1/events/index.yaml': 'schemaVersion: 1\nids:\n  - event1\n',
          'days/day1/events/event1/scene.md': '# Scene\nA door opens.\n',
          'days/day1/events/event1/dialogue.md': '# Dialogue\nWho is there?\n',
          'days/day1/events/event1/user-action.md': 'The user opens the door.\n',
          'days/day1/events/event1/event.yaml': 'schemaVersion: 1\nid: event1\nbeatId: null\ntitle: The Door\nlocationId: null\nparticipantIds: []\nstatus: resolved\n',
          'days/day1/events/event1/result.yaml': 'schemaVersion: 1\nsummary: The door opened.\nlearnedFacts: []\ntimeAdvanced: null\ncompletedBeatIds: []\nskippedBeatIds: []\nendDay: false\n',
          'days/day1/events/event1/state-patch.yaml': 'schemaVersion: 1\nchanges: []\n',
        },
      },
      {
        command: 'revise', control: { phase: 'idle', day: null, lastSettledDay: null },
        files: { 'canon/premise.md': '# Revised premise\n' },
      },
    ];
    for (const item of cases) {
      const world = path.join(root, `${item.command}-world`);
      await mkdir(world);
      await makePublishedWorld(world, item.control);
      const draft = path.join(root, `${item.command}.md`);
      await writeFile(draft, `# ${item.command} intent\n`);
      const editor = { async edit(input) {
        for (const [relative, contents] of Object.entries(item.files)) {
          const target = path.join(input.workspaceRoot, ...relative.split('/'));
          await mkdir(path.dirname(target), { recursive: true });
          await writeFile(target, contents);
        }
      } };
      const executed = await executeCliV1([item.command, world, '--draft', draft, '--dry-run'], { draftEditor: editor });
      assert.equal(executed.result.mode, 'dry-run', item.command);
      assert.equal(executed.result.patch.command, item.command);
    }
  } finally { await rm(root, { recursive: true, force: true }); }
});
