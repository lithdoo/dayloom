import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Writable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { executeCliV1 } from '@dayloom/cli';
import { executeDraftV1 } from '../dist/run.js';
import { resolvePromptpileBoundariesV1 } from '../dist/binaries.js';
import { makePublishedWorld } from './support/world.mjs';

const fakeReact = fileURLToPath(new URL('./support/fake-react.mjs', import.meta.url));

async function tempDir() {
  return mkdtemp(path.join(os.tmpdir(), 'dayloom-draft-e2e-'));
}

function capture() {
  let out = '';
  let err = '';
  return {
    stdout: new Writable({ write(chunk, _enc, cb) { out += chunk.toString(); cb(); } }),
    stderr: new Writable({ write(chunk, _enc, cb) { err += chunk.toString(); cb(); } }),
    text: () => out,
    err: () => err,
  };
}

async function llmConfig(root) {
  const target = path.join(root, 'llm.toml');
  await writeFile(target, '[[llm_api]]\nname = "test"\nmodel = "test"\nbase_url = "http://127.0.0.1:9"\napi_key_env = "DAYLOOM_DRAFT_TEST_KEY"\n\n[promptpile]\nllm_api = "test"\n', 'utf8');
  return target;
}

async function runDraft(root, args, scenario = {}) {
  const io = capture();
  const envKey = 'DAYLOOM_DRAFT_FAKE';
  const previous = process.env[envKey];
  process.env[envKey] = JSON.stringify(scenario);
  try {
    const result = await executeDraftV1(args, {
      cwd: root,
      reactBin: fakeReact,
      stdout: io.stdout,
      stderr: io.stderr,
    });
    return { result, io };
  } finally {
    if (previous === undefined) delete process.env[envKey];
    else process.env[envKey] = previous;
  }
}

test('A. single missing Draft file, World RO, sibling denied, conversation persists, stream-json is native', async () => {
  const root = await tempDir();
  try {
    const world = path.join(root, 'world');
    const drafts = path.join(root, 'drafts');
    const conversation = path.join(root, 'conversation');
    await mkdir(world);
    await mkdir(drafts);
    await writeFile(path.join(drafts, 'sibling.md'), 'keep\n', 'utf8');
    const draft = path.join(drafts, 'new-draft.md');
    const evidence = path.join(root, 'evidence.json');
    const { result, io } = await runDraft(root, [
      '--world', world,
      '--draft', draft,
      '--conversation', conversation,
      '--llm-config', await llmConfig(root),
      '--message', 'Create the initial world intent.',
      '--output-format', 'stream-json',
    ], {
      evidence,
      final: 'Created the draft.',
      rounds: [
        [{ id: 'list', name: 'mcp__world__list_directory', arguments: { path: '.' } }],
        [{ id: 'write', name: 'mcp__draft__write_file', arguments: { path: 'new-draft.md', content: '# New World\n' } }],
        [{ id: 'sibling', name: 'mcp__draft__write_file', arguments: { path: 'sibling.md', content: 'hacked\n' } }],
        [{ id: 'world-write', name: 'mcp__world__write_file', arguments: { path: 'manifest.json', content: '{}\n' } }],
      ],
    });
    assert.equal(result.exitCode, 0);
    assert.equal(result.startedReact, true);
    assert.equal(result.command, 'init');
    assert.equal(await readFile(draft, 'utf8'), '# New World\n');
    assert.equal(await readFile(path.join(drafts, 'sibling.md'), 'utf8'), 'keep\n');
    const names = await readdir(conversation);
    assert.equal(names.some((name) => /user\.md$/.test(name)), true);
    assert.equal(names.some((name) => /assistant\.md$/.test(name)), true);
    const events = io.text().trim().split('\n').map((line) => JSON.parse(line));
    assert.equal(events[0].schema_version, 1);
    assert.equal(events[0].type, 'session.started');
    assert.equal(events.at(-1).type, 'session.completed');
    assert.equal(events.every((event) => event.ok === undefined && event.event === undefined), true);
    const evidenceRows = JSON.parse(await readFile(evidence, 'utf8'));
    assert.match(evidenceRows[2][0].content, /DAYLOOM_DRAFT_TOOL_ERROR/);
    assert.match(evidenceRows[3][0].content, /DAYLOOM_DRAFT_TOOL_ERROR/);

    const second = await runDraft(root, [
      '--world', world,
      '--draft', draft,
      '--conversation', conversation,
      '--llm-config', await llmConfig(root),
      '--message', 'Tighten the premise.',
    ], { final: 'Continued.', rounds: [] });
    assert.equal(second.result.exitCode, 0);
    const after = await readdir(conversation);
    assert.equal(after.filter((name) => /user\.md$/.test(name)).length, 2);
    assert.equal(after.filter((name) => /assistant\.md$/.test(name)).length, 2);

    const checked = await executeCliV1(['init', world, '--draft', draft, '--check']);
    assert.equal(checked.result.mode, 'checked');
    assert.equal(checked.result.draftFiles, 1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('B. explicit multi-file authority writes only selected files', async () => {
  const root = await tempDir();
  try {
    const world = path.join(root, 'world');
    const drafts = path.join(root, 'drafts');
    await mkdir(world);
    await mkdir(drafts);
    const a = path.join(drafts, 'a.md');
    const b = path.join(drafts, 'b.md');
    const c = path.join(drafts, 'c.md');
    await writeFile(a, 'a\n', 'utf8');
    await writeFile(b, 'b\n', 'utf8');
    await writeFile(c, 'c\n', 'utf8');
    await makePublishedWorld(world, { phase: 'planned', day: 'day1', lastSettledDay: null });
    const { result } = await runDraft(root, [
      'play',
      '--world', world,
      '--draft', a,
      '--draft', b,
      '--conversation', path.join(root, 'conversation'),
      '--llm-config', await llmConfig(root),
      '--message', 'Update both selected drafts.',
    ], {
      rounds: [
        [{ id: 'read', name: 'mcp__world__read_file_lines', arguments: { path: 'current.json' } }],
        [
          { id: 'a', name: 'mcp__draft__write_file', arguments: { path: 'a.md', content: 'A\n' } },
          { id: 'b', name: 'mcp__draft__write_file', arguments: { path: 'b.md', content: 'B\n' } },
        ],
        [{ id: 'c', name: 'mcp__draft__write_file', arguments: { path: 'c.md', content: 'C\n' } }],
      ],
    });
    assert.equal(result.command, 'play');
    assert.equal(await readFile(a, 'utf8'), 'A\n');
    assert.equal(await readFile(b, 'utf8'), 'B\n');
    assert.equal(await readFile(c, 'utf8'), 'c\n');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('C. draft-dir allows subtree writes and blocks traversal', async () => {
  const root = await tempDir();
  try {
    const world = path.join(root, 'world');
    const draftDir = path.join(root, 'draft');
    await mkdir(world);
    await mkdir(draftDir);
    await writeFile(path.join(root, 'outside.md'), 'outside\n', 'utf8');
    const { result } = await runDraft(root, [
      '--world', world,
      '--draft-dir', draftDir,
      '--conversation', path.join(root, 'conversation'),
      '--llm-config', await llmConfig(root),
      '--message', 'Fill the draft directory.',
    ], {
      rounds: [
        [{ id: 'mkdir', name: 'mcp__draft__create_directory', arguments: { path: 'events' } }],
        [{ id: 'write', name: 'mcp__draft__write_file', arguments: { path: 'events/e1.md', content: 'one\n' } }],
        [{ id: 'escape', name: 'mcp__draft__write_file', arguments: { path: '../outside.md', content: 'pwned\n' } }],
      ],
    });
    assert.equal(result.command, 'init');
    assert.equal(await readFile(path.join(draftDir, 'events', 'e1.md'), 'utf8'), 'one\n');
    assert.equal(await readFile(path.join(root, 'outside.md'), 'utf8'), 'outside\n');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('D. omitted command on idle World fails before React', async () => {
  const root = await tempDir();
  try {
    const world = path.join(root, 'world');
    await mkdir(world);
    await makePublishedWorld(world);
    const stamp = path.join(root, 'react-started');
    const config = await llmConfig(root);
    await assert.rejects(
      () => runDraft(root, [
        '--world', world,
        '--draft', path.join(root, 'x.md'),
        '--conversation', path.join(root, 'conversation'),
        '--llm-config', config,
        '--message', 'hello',
      ], { stamp }),
      (error) => error.code === 'AMBIGUOUS_COMMAND' && error.details.availableCommands.join(',') === 'plan,revise',
    );
    await assert.rejects(() => readFile(stamp));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('invalid World, unavailable command, and World/Draft overlap fail before React', async () => {
  const root = await tempDir();
  try {
    const invalid = path.join(root, 'invalid');
    await mkdir(invalid);
    await writeFile(path.join(invalid, 'manifest.json'), '{}\n');
    const invalidConfig = await llmConfig(root);
    await assert.rejects(
      () => runDraft(root, [
        '--world', invalid,
        '--draft', path.join(root, 'd.md'),
        '--conversation', path.join(root, 'c'),
        '--llm-config', invalidConfig,
        '--message', 'x',
      ]),
      (error) => error.code === 'WORLD_INVALID',
    );

    const world = path.join(root, 'world');
    await mkdir(world);
    await makePublishedWorld(world);
    await assert.rejects(
      () => runDraft(root, [
        'init',
        '--world', world,
        '--draft', path.join(root, 'd.md'),
        '--conversation', path.join(root, 'c'),
        '--llm-config', invalidConfig,
        '--message', 'x',
      ]),
      (error) => error.code === 'NOT_AVAILABLE',
    );

    const overlapWorld = path.join(root, 'overlap-world');
    await mkdir(overlapWorld);
    await assert.rejects(
      () => runDraft(root, [
        '--world', overlapWorld,
        '--draft', path.join(overlapWorld, 'inside.md'),
        '--conversation', path.join(root, 'c2'),
        '--llm-config', invalidConfig,
        '--message', 'x',
      ]),
      (error) => error.code === 'AUTHORITY_INVALID',
    );

    const nested = path.join(root, 'workspace');
    await mkdir(nested);
    const nestedConfig = path.join(nested, 'promptpile.toml');
    await writeFile(nestedConfig, await readFile(invalidConfig, 'utf8'), 'utf8');
    const stamp = path.join(root, 'react-started-llm');
    await assert.rejects(
      () => runDraft(root, [
        '--world', overlapWorld,
        '--draft-dir', nested,
        '--conversation', path.join(root, 'c3'),
        '--llm-config', nestedConfig,
        '--message', 'x',
      ], { stamp }),
      (error) => error.code === 'AUTHORITY_INVALID' && /LLM config/.test(error.message),
    );
    await assert.rejects(() => readFile(stamp));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('MCP setup failure does not append Conversation', async () => {
  const root = await tempDir();
  try {
    const world = path.join(root, 'world');
    await mkdir(world);
    const conversation = path.join(root, 'conversation');
    const failingMcp = path.join(root, 'fail-mcp.mjs');
    await writeFile(failingMcp, 'process.exit(1);\n', 'utf8');
    const real = await resolvePromptpileBoundariesV1();
    const config = await llmConfig(root);
    await assert.rejects(
      () => executeDraftV1([
        '--world', world,
        '--draft', path.join(root, 'd.md'),
        '--conversation', conversation,
        '--llm-config', config,
        '--message', 'hello',
      ], {
        cwd: root,
        reactBin: fakeReact,
        resolveBoundaries: async () => ({
          ...real,
          promptpileMcpBin: failingMcp,
        }),
      }),
      (error) => error.code === 'MCP_FAILED',
    );
    await assert.rejects(() => readdir(conversation));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('bin --help and --version do not start React', async () => {
  const { spawnSync } = await import('node:child_process');
  const bin = fileURLToPath(new URL('../dist/main.js', import.meta.url));
  const help = spawnSync(process.execPath, [bin, '--help'], { encoding: 'utf8' });
  assert.equal(help.status, 0);
  assert.match(help.stdout, /dayloom-draft/);
  const version = spawnSync(process.execPath, [bin, '--version'], { encoding: 'utf8' });
  assert.equal(version.status, 0);
  assert.match(version.stdout, /1\.0\.0-beta\.1/);
});
