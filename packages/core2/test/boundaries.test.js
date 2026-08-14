const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const TOML = require('@iarna/toml');
const { deriveSummaryConfig, readCallerConfig, writeDerivedConfigs } = require('../dist/promptpile/config');
const { runReact } = require('../dist/promptpile/react-runner');
const { resolvePackagedBoundaries } = require('../dist/promptpile/binaries');
const { createPlayWorkspace, WRITABLE_SUMMARY_AUTHORITY_NOTE } = require('../dist/session/play');
const { readPublishedWorld } = require('../dist/world/read');
const { archiveFixture, eventStream } = require('./helpers');

test('the public TUI example is a valid caller-owned Promptpile config', async () => {
  const example = path.resolve(__dirname, '../../../examples/dayloom-tui/llm.example.toml');
  const config = await readCallerConfig(example);
  assert.equal(typeof config.llm_api[0].name, 'string');
  assert.equal(typeof config.llm_api[0].api_key_env, 'string');
  assert.equal(config.promptpile.llm_api, config.llm_api[0].name);
  assert.equal(config['promptpile-react'], undefined);
});

test('derived config preserves profiles and owns max-step and prompt paths', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'core2-config-')); t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const caller = path.join(root, 'caller.toml'); fs.writeFileSync(caller, '[[llm_api]]\nname="profile"\nmodel="m"\n[promptpile]\nllm_api="profile"\nllm_api_temperature=0.3\n');
  const config = await readCallerConfig(caller);
  const paths = { thought: path.join(root, 'thought.md'), sendFinal: path.join(root, 'send.md'), submitFinal: path.join(root, 'submit.md'), sendConfig: path.join(root, 'send.toml'), submitConfig: path.join(root, 'submit.toml'), summaryConfig: path.join(root, 'summary.toml') };
  await writeDerivedConfigs(config, paths);
  const send = TOML.parse(fs.readFileSync(paths.sendConfig, 'utf8')), submit = TOML.parse(fs.readFileSync(paths.submitConfig, 'utf8'));
  assert.equal(send.llm_api[0].name, 'profile'); assert.equal(send.promptpile.llm_api_temperature, 0.3);
  assert.deepEqual(send['promptpile-react'], { max_step: 1, thought_prompt: paths.thought, final_prompt: paths.sendFinal });
  assert.equal(submit['promptpile-react'].final_prompt, paths.submitFinal);
});
test('summary config preserves only provider identity and LLM selection', () => {
  const profile = [{ name: 'profile', model: 'model', api_key_env: 'KEY' }];
  const summary = deriveSummaryConfig({
    llm_api: profile,
    unrelated: { value: true },
    promptpile: {
      llm_api: 'profile', llm_api_key: 'secret', llm_api_key_env: 'KEY', llm_api_model: 'override',
      llm_api_base_url: 'https://example.invalid', llm_api_temperature: 0.7, llm_api_extra_body: { reasoning: 'low' },
      dir: 'wrong', dirs: ['wrong'], output_dir: 'wrong', output: 'wrong', receipt: 'wrong', quiet: true,
      input: 'wrong', continue: true, tools_file: 'wrong', disable_tool: false, tool_choice: 'required',
      after_hook: 'wrong', after_hook_failure: 'continue', insert_files: ['wrong'], append_files: ['wrong'],
      output_pile_file: 'wrong', output_pile_fd: 3, output_pile_format: 'json', missing_tool_results: 'ignore',
    },
  });
  assert.deepEqual(summary, {
    llm_api: profile,
    promptpile: {
      llm_api: 'profile', llm_api_key: 'secret', llm_api_key_env: 'KEY', llm_api_model: 'override',
      llm_api_base_url: 'https://example.invalid', llm_api_temperature: 0.7, llm_api_extra_body: { reasoning: 'low' },
    },
  });
});
test('play workspace isolates compression requests and marks summaries as untrusted history', async (t) => {
  const fixture = archiveFixture(); t.after(fixture.cleanup);
  const runtime = fs.mkdtempSync(path.join(os.tmpdir(), 'core2-workspace-')); t.after(() => fs.rmSync(runtime, { recursive: true, force: true }));
  const session = await createPlayWorkspace(runtime, 'session', await readPublishedWorld(fixture.root), await readCallerConfig(fixture.config));
  assert.equal(path.dirname(session.requestsDir), path.join(session.root, 'compression'));
  assert.equal(fs.statSync(session.requestsDir).isDirectory(), true);
  assert.equal(fs.readFileSync(session.summaryPromptPath, 'utf8').includes('Return exactly one JSON object'), true);
  assert.equal(TOML.parse(fs.readFileSync(session.summaryConfigPath, 'utf8')).llm_api[0].name, 'test');
  for (const prompt of ['thought.md', 'final-send.md', 'final-submit.md']) {
    assert.equal(fs.readFileSync(path.join(session.root, 'react', prompt), 'utf8').includes(WRITABLE_SUMMARY_AUTHORITY_NOTE), true);
  }
  assert.deepEqual(fs.readdirSync(session.contextDir), []);
});
test('React runner rejects malformed, schema-invalid, gaps, session changes and Final mismatch', async () => {
  const boundaries = await resolvePackagedBoundaries();
  const base = { runner: null, reactBin: 'react', validate: boundaries.validateAgentEvent, config: 'c', context: 'x', conversation: 'y' };
  for (const stdout of [
    '{bad\n',
    JSON.stringify({ schema_version: 1, type: 'bad', session_id: 'x', sequence: 0 }) + '\n',
    eventStream('ok').replace('"sequence":1', '"sequence":2'),
    eventStream('ok').replace('"session_id":"react-session","sequence":1', '"session_id":"changed","sequence":1'),
    eventStream('ok').replace('"content":"ok"}}', '"content":"different"}}'),
  ]) {
    const runner = { run: async (_bin, _args, options) => { options.onStdout?.(stdout); return { code: 0, stdout, stderr: '' }; } };
    await assert.rejects(() => runReact({ ...base, runner }));
  }
});
test('React runner consumes JSONL incrementally across stdout chunks', async () => {
  const boundaries = await resolvePackagedBoundaries(), received = [];
  const stream = eventStream('hello'), split = stream.indexOf('hello') + 2;
  const runner = { run: async (_bin, _args, options) => {
    options.onStdout(stream.slice(0, split)); options.onStdout(stream.slice(split));
    return { code: 0, stdout: stream, stderr: '' };
  } };
  const final = await runReact({ runner, reactBin: 'react', validate: boundaries.validateAgentEvent, config: 'c', context: 'x', conversation: 'y', onDelta: (text) => received.push(text) });
  assert.equal(final, 'hello'); assert.deepEqual(received, ['hello']);
});
test('React runner emits Final delta before the child process closes', async () => {
  const boundaries = await resolvePackagedBoundaries(), lines = eventStream('live').trimEnd().split('\n'); let close;
  const runner = { run: async (_bin, _args, options) => new Promise((resolve) => {
    options.onStdout(`${lines[0]}\n${lines[1]}\n`);
    close = () => { options.onStdout(`${lines[2]}\n`); resolve({ code: 0, stdout: eventStream('live'), stderr: '' }); };
  }) };
  let delta = '', settled = false;
  const running = runReact({ runner, reactBin: 'react', validate: boundaries.validateAgentEvent, config: 'c', context: 'x', conversation: 'y', onDelta: (text) => { delta += text; } }).finally(() => { settled = true; });
  while (!close) await new Promise((resolve) => setImmediate(resolve));
  assert.equal(delta, 'live'); assert.equal(settled, false); close(); assert.equal(await running, 'live');
});
test('React runner rejects truncated JSONL at EOF', async () => {
  const boundaries = await resolvePackagedBoundaries(), stdout = eventStream('x').slice(0, -3);
  const runner = { run: async (_bin, _args, options) => { options.onStdout(stdout); return { code: 0, stdout, stderr: '' }; } };
  await assert.rejects(() => runReact({ runner, reactBin: 'react', validate: boundaries.validateAgentEvent, config: 'c', context: 'x', conversation: 'y' }), /truncated JSONL/);
});
test('React invocation keeps the frozen context/output topology and enables no input, tools, or hook', async () => {
  const boundaries = await resolvePackagedBoundaries(), stdout = eventStream('ok'); let captured;
  const runner = { run: async (bin, args, options) => { captured = { bin, args, options }; options.onStdout(stdout); return { code: 0, stdout, stderr: '' }; } };
  await runReact({ runner, reactBin: 'packaged-react', validate: boundaries.validateAgentEvent, config: 'send.toml', context: 'context-dir', conversation: 'conversation-dir' });
  assert.deepEqual(captured.args, ['--config', 'send.toml', '-d', 'context-dir', '--output-dir', 'conversation-dir', '--continue', '--max-step', '1', '--quiet', '--output-format', 'stream-json']);
  assert.equal(captured.args.includes('--input'), false); assert.equal(captured.args.includes('--tools-file'), false); assert.equal(captured.args.includes('--after-hook-path'), false);
});
test('architecture guard rejects legacy and deep imports', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'core2-guard-'));
  try {
    fs.writeFileSync(path.join(root, 'bad.ts'), "import '@dayloom/core';\nimport 'promptpile-react/dist/runtime';\nimport 'promptpile-compress/dist/compress';\n");
    const result = spawnSync(process.execPath, [path.join(__dirname, '..', 'scripts', 'check-architecture.mjs')], { env: { ...process.env, CORE2_ARCHITECTURE_ROOT: root }, encoding: 'utf8' });
    assert.notEqual(result.status, 0); assert.match(result.stderr, /forbidden import @dayloom\/core/); assert.match(result.stderr, /forbidden import promptpile-compress\/dist\/compress/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
