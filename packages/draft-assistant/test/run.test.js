import test from 'node:test';
import assert from 'node:assert/strict';
import { access, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { executeDraftAssistantV1 } from '../dist/run.js';
import { capture, llmConfig, tempDir } from './support/helpers.mjs';
import { makePublishedWorld } from './support/world.mjs';

const boundaries = Object.freeze({
  promptpileBin: 'promptpile.js', reactBin: 'react.js', promptpileMcpBin: 'mcp.js',
  filesystemMcp: Object.freeze({ command: 'filesystem', argsPrefix: Object.freeze([]) }),
});

function baseArgs(config, command = 'init') {
  return [command, '--draft', 'draft.md', '--conversation', 'conversation', '--llm-config', config, '--message', 'hello'];
}

function runtimeStub(calls) {
  return async (input) => {
    calls.push(['runtime', input]);
    return {
      binding: { toolsFile: path.join(input.runtimeRoot, 'tools.toml'), afterHookPath: path.join(input.runtimeRoot, 'hook'), hookConfigPath: path.join(input.runtimeRoot, 'hook.json'), toolNames: [] },
      async close() { calls.push(['close', input.worldRoot === null ? 'sync' : 'dialogue']); },
    };
  };
}

test('init closes Dialogue then runs Draft-only Sync and exposes no init file tools', async () => {
  const root = await tempDir();
  const calls = [];
  const io = capture();
  try {
    const config = await llmConfig(root);
    const result = await executeDraftAssistantV1(baseArgs(config), {
      cwd: root, stdout: io.stdout, stderr: io.stderr,
      resolveBoundaries: async () => boundaries,
      startRuntime: runtimeStub(calls),
      appendUser: async () => { calls.push(['append']); },
      runDialogue: async (input) => {
        calls.push(['dialogue']);
        const derived = await readFile(input.config, 'utf8');
        assert.match(derived, /tools_file/);
        assert.doesNotMatch(derived, /after_hook/);
        const toolsMatch = /tools_file\s*=\s*"([^"]+)"/.exec(derived);
        assert.ok(toolsMatch);
        assert.equal(await readFile(toolsMatch[1].replace(/\\\\/g, '\\'), 'utf8'), 'tools = []\n');
        input.stdout.write('approved reply\n');
        return 0;
      },
      runSync: async (input) => {
        calls.push(['sync']);
        const derived = await readFile(input.config, 'utf8');
        const finalMatch = /final_prompt\s*=\s*"([^"]+)"/.exec(derived);
        assert.ok(finalMatch);
        assert.equal(await readFile(finalMatch[1].replace(/\\\\/g, '\\'), 'utf8'), '');
        await writeFile(path.join(root, 'draft.md'), '# Draft\n');
        return { code: 0, stdout: 'must stay hidden', stderr: '' };
      },
    });
    assert.deepEqual(calls.map((entry) => entry[0]), ['append', 'dialogue', 'runtime', 'sync', 'close']);
    assert.equal(calls[2][1].worldRoot, null);
    assert.equal(calls[2][1].draft.mode, 'files');
    assert.equal(io.out(), 'approved reply\n');
    assert.equal(result.exitCode, 0);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('world-bound Dialogue sees only a materialized read-only World and Sync sees no World', async () => {
  const root = await tempDir();
  const calls = [];
  let viewRoot;
  try {
    const world = path.join(root, 'world');
    await mkdir(world);
    await makePublishedWorld(world, { phase: 'planned', day: 'day1', lastSettledDay: null });
    const config = await llmConfig(root);
    const result = await executeDraftAssistantV1([
      'play', '--world', world, '--draft', 'draft.md', '--conversation', 'conversation',
      '--llm-config', config, '--message', 'open the door',
    ], {
      cwd: root, resolveBoundaries: async () => boundaries,
      startRuntime: async (input) => {
        calls.push(input);
        if (input.worldRoot !== null) {
          viewRoot = input.worldRoot;
          assert.notEqual(path.resolve(input.worldRoot), path.resolve(world));
          assert.equal(await readFile(path.join(input.worldRoot, 'canon', 'premise.md'), 'utf8'), '# Premise\n');
          await assert.rejects(() => access(path.join(input.worldRoot, 'manifest.json')));
          assert.equal(input.draft, null);
        } else assert.equal(input.draft.mode, 'files');
        return { binding: { toolsFile: 'tools', afterHookPath: 'hook', hookConfigPath: 'hook-config', toolNames: [] }, async close() {} };
      },
      appendUser: async () => {}, runDialogue: async () => 0,
      runSync: async () => {
        await writeFile(path.join(root, 'draft.md'), '# Play\n');
        return { code: 0, stdout: '', stderr: '' };
      },
    });
    assert.equal(result.exitCode, 0);
    assert.equal(calls.length, 2);
    assert.equal(calls[1].worldRoot, null);
    await assert.rejects(() => access(viewRoot));
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('failure boundaries preserve commit ordering and exit semantics', async (t) => {
  await t.test('pre-Dialogue setup does not append', async () => {
    const root = await tempDir();
    let appended = false;
    try {
      const config = await llmConfig(root);
      await assert.rejects(() => executeDraftAssistantV1(baseArgs(config), {
        cwd: root, resolveBoundaries: async () => { throw new Error('setup'); },
        appendUser: async () => { appended = true; },
      }), /setup/);
      assert.equal(appended, false);
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  await t.test('Dialogue failure does not start Sync', async () => {
    const root = await tempDir();
    let runtimes = 0;
    try {
      const result = await executeDraftAssistantV1(baseArgs(await llmConfig(root)), {
        cwd: root, resolveBoundaries: async () => boundaries,
        appendUser: async () => {}, runDialogue: async () => 7,
        startRuntime: async () => { runtimes += 1; throw new Error('Sync should not start'); },
      });
      assert.equal(result.exitCode, 7);
      assert.equal(runtimes, 0);
      assert.equal(result.startedSync, false);
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  await t.test('append failure does not start either React', async () => {
    const root = await tempDir();
    let dialogue = false;
    try {
      const config = await llmConfig(root);
      await assert.rejects(() => executeDraftAssistantV1(baseArgs(config), {
        cwd: root, resolveBoundaries: async () => boundaries,
        appendUser: async () => { throw new Error('append failed'); },
        runDialogue: async () => { dialogue = true; return 0; },
      }), /append failed/);
      assert.equal(dialogue, false);
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  await t.test('Sync setup failure occurs only after accepted Dialogue', async () => {
    const root = await tempDir();
    let appended = false;
    let dialogue = false;
    try {
      const config = await llmConfig(root);
      await assert.rejects(() => executeDraftAssistantV1(baseArgs(config), {
        cwd: root, resolveBoundaries: async () => boundaries,
        appendUser: async () => { appended = true; },
        runDialogue: async () => { dialogue = true; return 0; },
        startRuntime: async () => { throw new Error('sync setup failed'); },
      }), /sync setup failed/);
      assert.equal(appended, true);
      assert.equal(dialogue, true);
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  await t.test('Sync failure follows committed Dialogue and reports only diagnostics', async () => {
    const root = await tempDir();
    const io = capture();
    try {
      const result = await executeDraftAssistantV1(baseArgs(await llmConfig(root)), {
        cwd: root, stdout: io.stdout, stderr: io.stderr,
        resolveBoundaries: async () => boundaries, startRuntime: runtimeStub([]),
        appendUser: async () => {}, runDialogue: async (input) => { input.stdout.write('reply\n'); return 0; },
        runSync: async () => ({ code: 9, stdout: 'hidden sync output', stderr: 'sync failed\n' }),
      });
      assert.equal(result.exitCode, 9);
      assert.equal(result.startedDialogue, true);
      assert.equal(result.startedSync, true);
      assert.equal(io.out(), 'reply\n');
      assert.equal(io.err(), 'sync failed\n');
    } finally { await rm(root, { recursive: true, force: true }); }
  });
});

test('help and version do not resolve external boundaries', async () => {
  for (const flag of ['--help', '--version']) {
    let resolved = false;
    const result = await executeDraftAssistantV1([flag], { resolveBoundaries: async () => { resolved = true; return boundaries; }, stdout: capture().stdout });
    assert.equal(result.exitCode, 0);
    assert.equal(resolved, false);
  }
});

test('React debug preserves a failed operation root that actually exists', async () => {
  const root = await tempDir();
  const io = capture();
  const previous = process.env.PROMPTPILE_REACT_DEBUG;
  let preserved;
  process.env.PROMPTPILE_REACT_DEBUG = '1';
  try {
    const result = await executeDraftAssistantV1(baseArgs(await llmConfig(root)), {
      cwd: root, stdout: io.stdout, stderr: io.stderr,
      resolveBoundaries: async () => boundaries,
      appendUser: async () => {},
      runDialogue: async () => 7,
    });
    assert.equal(result.exitCode, 7);
    const match = /draft-assistant: preserved failed operation: (.+)\n/.exec(io.err());
    assert.ok(match);
    preserved = match[1].trim();
    await access(preserved);
    await access(path.join(preserved, 'dialogue', 'config.toml'));
  } finally {
    if (previous === undefined) delete process.env.PROMPTPILE_REACT_DEBUG;
    else process.env.PROMPTPILE_REACT_DEBUG = previous;
    if (preserved) await rm(preserved, { recursive: true, force: true });
    await rm(root, { recursive: true, force: true });
  }
});

test('Sync cannot report success without a non-empty Draft artifact', async () => {
  const root = await tempDir();
  try {
    const config = await llmConfig(root);
    await assert.rejects(() => executeDraftAssistantV1(baseArgs(config), {
      cwd: root,
      resolveBoundaries: async () => boundaries,
      startRuntime: runtimeStub([]),
      appendUser: async () => {},
      runDialogue: async () => 0,
      runSync: async () => ({ code: 0, stdout: '', stderr: '' }),
    }), (error) => error?.code === 'DRAFT_SYNC_FAILED' && /UTF-8 Draft artifact/.test(error.message));
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('React debug also preserves completed operation diagnostics', async () => {
  const root = await tempDir();
  const io = capture();
  const previous = process.env.PROMPTPILE_REACT_DEBUG;
  let preserved;
  process.env.PROMPTPILE_REACT_DEBUG = 'true';
  try {
    const result = await executeDraftAssistantV1(baseArgs(await llmConfig(root)), {
      cwd: root, stdout: io.stdout, stderr: io.stderr,
      resolveBoundaries: async () => boundaries,
      startRuntime: runtimeStub([]),
      appendUser: async () => {},
      runDialogue: async () => 0,
      runSync: async () => {
        await writeFile(path.join(root, 'draft.md'), '# Draft\n');
        return { code: 0, stdout: '', stderr: '' };
      },
    });
    assert.equal(result.exitCode, 0);
    const match = /draft-assistant: preserved completed operation: (.+)\n/.exec(io.err());
    assert.ok(match);
    preserved = match[1].trim();
    await access(path.join(preserved, 'sync', 'config.toml'));
  } finally {
    if (previous === undefined) delete process.env.PROMPTPILE_REACT_DEBUG;
    else process.env.PROMPTPILE_REACT_DEBUG = previous;
    if (preserved) await rm(preserved, { recursive: true, force: true });
    await rm(root, { recursive: true, force: true });
  }
});
