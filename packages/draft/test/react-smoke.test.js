import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Writable } from 'node:stream';
import { executeCliV1 } from '@dayloom/cli';
import { executeDraftV1 } from '../dist/run.js';
import { startOpenAiStub } from './support/openai-stub.mjs';

const API_KEY_ENV = 'DAYLOOM_DRAFT_SMOKE_KEY';

test('real promptpile-react writes Draft through hook+MCP and persists Final', { timeout: 120_000 }, async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'dayloom-draft-react-smoke-'));
  const stub = await startOpenAiStub({
    write: { path: 'new-draft.md', content: '# New World\n' },
    final: 'Created the draft.',
  });
  const previousKey = process.env[API_KEY_ENV];
  process.env[API_KEY_ENV] = 'test';
  try {
    const world = path.join(root, 'world');
    const drafts = path.join(root, 'drafts');
    const conversation = path.join(root, 'conversation');
    const draft = path.join(drafts, 'new-draft.md');
    await mkdir(world);
    await mkdir(drafts);
    const llmConfig = path.join(root, 'llm.toml');
    await writeFile(
      llmConfig,
      `[[llm_api]]\nname = "stub"\nmodel = "stub"\nbase_url = ${JSON.stringify(stub.baseUrl)}\napi_key_env = ${JSON.stringify(API_KEY_ENV)}\n\n[promptpile]\nllm_api = "stub"\n`,
      'utf8',
    );

    let stdout = '';
    let stderr = '';
    const result = await executeDraftV1([
      '--world', world,
      '--draft', draft,
      '--conversation', conversation,
      '--llm-config', llmConfig,
      '--message', 'Create the initial world intent.',
      '--output-format', 'stream-json',
    ], {
      cwd: root,
      stdout: new Writable({ write(chunk, _enc, cb) { stdout += chunk.toString(); cb(); } }),
      stderr: new Writable({ write(chunk, _enc, cb) { stderr += chunk.toString(); cb(); } }),
    });

    assert.equal(result.exitCode, 0, stderr);
    assert.equal(result.startedReact, true);
    assert.equal(result.command, 'init');
    assert.deepEqual(stub.phases, ['thought', 'observe', 'check', 'final'], stderr);
    assert.equal(await readFile(draft, 'utf8'), '# New World\n');

    const names = await readdir(conversation);
    assert.equal(names.some((name) => /user\.md$/.test(name)), true);
    const assistant = names.find((name) => /assistant\.md$/.test(name));
    assert.equal(typeof assistant, 'string');
    assert.match(await readFile(path.join(conversation, assistant), 'utf8'), /Created the draft/);

    const events = stdout.trim().split('\n').map((line) => JSON.parse(line));
    assert.equal(events[0].schema_version, 1);
    assert.equal(events[0].type, 'session.started');
    assert.equal(events.at(-1).type, 'session.completed');
    assert.equal(events.at(-1).stop_reason, 'final');
    assert.equal(events.every((event) => event.ok === undefined && event.event === undefined), true);

    const checked = await executeCliV1(['init', world, '--draft', draft, '--check']);
    assert.equal(checked.result.mode, 'checked');
    assert.equal(checked.result.draftFiles, 1);
  } finally {
    if (previousKey === undefined) delete process.env[API_KEY_ENV];
    else process.env[API_KEY_ENV] = previousKey;
    await stub.close().catch(() => undefined);
    await rm(root, { recursive: true, force: true });
  }
});
