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
const { createPlayWorkspace } = require('../dist/session/play');
const { buildDayloomObservePrompt, OBSERVE_HANDOFF_AUTHORITY_NOTE, WRITABLE_SUMMARY_AUTHORITY_NOTE } = require('../dist/session/prompts');
const { buildLifecycleContext, createInitWorkspace, createPlanningWorkspace, createReviseWorkspace } = require('../dist/session/lifecycle');
const { readPublishedWorld } = require('../dist/world/read');
const { archiveFixture, eventStream } = require('./helpers');

function continuationStream(observe, final = 'ok') {
  const process_id = `react_${'3'.repeat(32)}`, work_id = `work_${'4'.repeat(32)}`, work_path = 'C:/tmp/react/continuation-work';
  const events = [];
  const add = (event) => events.push({ schema_version: 1, process_id, sequence: events.length, ...event });
  add({ type: 'process.started', max_steps: 1, work_id, work_path, work_lifecycle: 'cleanup' });
  add({ type: 'phase.started', phase: 'thought', step_index: 0 });
  add({ type: 'phase.completed', phase: 'thought', step_index: 0 });
  add({ type: 'phase.started', phase: 'observe', step_index: 0 });
  add({ type: 'phase.delta', phase: 'observe', step_index: 0, channel: 'assistant_text', content: observe });
  add({ type: 'phase.completed', phase: 'observe', step_index: 0 });
  add({ type: 'phase.started', phase: 'check', step_index: 0 });
  add({ type: 'phase.completed', phase: 'check', step_index: 0, continue: true });
  add({ type: 'work.ready', work_id, work_path, status: 'checked' });
  add({ type: 'phase.started', phase: 'final' });
  add({ type: 'phase.delta', phase: 'final', channel: 'assistant_text', content: final });
  add({ type: 'phase.completed', phase: 'final' });
  add({ type: 'process.completed', stop_reason: 'max_step', steps_completed: 1, final: { status: 'completed', content: final } });
  return events.map(JSON.stringify).join('\n') + '\n';
}

test('the public TUI example is a valid caller-owned Promptpile config', async () => {
  const example = path.resolve(__dirname, '../../../examples/dayloom-tui/llm.example.toml');
  const config = await readCallerConfig(example);
  assert.equal(typeof config.llm_api[0].name, 'string');
  assert.equal(typeof config.llm_api[0].api_key_env, 'string');
  assert.equal(config.promptpile.llm_api, config.llm_api[0].name);
  assert.equal(config['promptpile-react'], undefined);
});

test('derived config preserves profiles and owns prompt paths without duplicating the CLI step budget', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'core-config-')); t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const caller = path.join(root, 'caller.toml'); fs.writeFileSync(caller, '[[llm_api]]\nname="profile"\nmodel="m"\n[promptpile]\nllm_api="profile"\nllm_api_temperature=0.3\n');
  const config = await readCallerConfig(caller);
  const paths = { thoughtPrompt: path.join(root, 'thought.md'), observePrompt: path.join(root, 'observe.md'), checkPrompt: path.join(root, 'check.md'), toolsFile: path.join(root, 'tools.toml'), sendFinalPrompt: path.join(root, 'send.md'), submitFinalPrompt: path.join(root, 'submit.md'), sendConfig: path.join(root, 'send.toml'), submitConfig: path.join(root, 'submit.toml'), summaryConfig: path.join(root, 'summary.toml') };
  await writeDerivedConfigs(config, paths);
  const send = TOML.parse(fs.readFileSync(paths.sendConfig, 'utf8')), submit = TOML.parse(fs.readFileSync(paths.submitConfig, 'utf8'));
  assert.equal(send.llm_api[0].name, 'profile'); assert.equal(send.promptpile.llm_api_temperature, 0.3);
  assert.deepEqual(send['promptpile-react'], { tools_file: paths.toolsFile, thought_prompt: paths.thoughtPrompt, observe_prompt: paths.observePrompt, check_prompt: paths.checkPrompt, final_prompt: paths.sendFinalPrompt });
  assert.equal(submit['promptpile-react'].final_prompt, paths.submitFinalPrompt);
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
  const runtime = fs.mkdtempSync(path.join(os.tmpdir(), 'core-workspace-')); t.after(() => fs.rmSync(runtime, { recursive: true, force: true }));
  const session = await createPlayWorkspace(runtime, 'session', await readPublishedWorld(fixture.root), await readCallerConfig(fixture.config));
  assert.equal(path.dirname(session.requestsDir), path.join(session.root, 'compression'));
  assert.equal(fs.existsSync(path.join(session.root, 'react-work')), false);
  assert.equal(fs.statSync(session.requestsDir).isDirectory(), true);
  assert.equal(fs.readFileSync(session.summaryPromptPath, 'utf8').includes('只返回一个 JSON 对象'), true);
  assert.equal(TOML.parse(fs.readFileSync(session.summaryConfigPath, 'utf8')).llm_api[0].name, 'test');
  for (const prompt of ['thought.md', 'observe.md', 'final-send.md', 'final-submit.md']) {
    assert.equal(fs.readFileSync(path.join(session.root, 'react', prompt), 'utf8').includes(WRITABLE_SUMMARY_AUTHORITY_NOTE), true);
  }
  const observe = fs.readFileSync(path.join(session.root, 'react', 'observe.md'), 'utf8');
  assert.equal(fs.readFileSync(path.join(session.root, 'react', 'tools.toml'), 'utf8'), 'tools = []\n');
  for (const section of ['SESSION', 'USER_INTENT', 'AUTHORITATIVE_FACTS', 'EXACT_IDS', 'DECISIONS', 'CONSTRAINTS', 'UNRESOLVED', 'FINAL_CONTRACT']) assert.match(observe, new RegExp(`\\[${section}\\]`));
  assert.equal(observe, buildDayloomObservePrompt(false));
  assert.match(observe, /model-proposal, awaiting-user-confirmation/);
  const check = fs.readFileSync(path.join(session.root, 'react', 'check.md'), 'utf8');
  assert.match(check, /retrieval_available=false/);
  assert.match(check, /用户选择或澄清/);
  assert.match(check, /优先停止/);
  for (const prompt of ['final-send.md', 'final-submit.md']) {
    const finalPrompt = fs.readFileSync(path.join(session.root, 'react', prompt), 'utf8');
    assert.equal(finalPrompt.includes(OBSERVE_HANDOFF_AUTHORITY_NOTE), true);
    assert.match(finalPrompt, /不要假设原始 Thought 或工具工作对你可见/);
    assert.doesNotMatch(finalPrompt, /completed reasoning/);
  }
  assert.deepEqual(fs.readdirSync(session.contextDir), []);
});
test('lifecycle workspaces own exact markers, empty Init context, and concrete business prompts', async (t) => {
  const fixture = archiveFixture(); t.after(fixture.cleanup);
  const runtime = fs.mkdtempSync(path.join(os.tmpdir(), 'core-lifecycle-workspace-')); t.after(() => fs.rmSync(runtime, { recursive: true, force: true }));
  const config = await readCallerConfig(fixture.config), world = await readPublishedWorld(fixture.root);
  const init = await createInitWorkspace(runtime, 'init', config);
  const planning = await createPlanningWorkspace(runtime, 'planning', world, config);
  const revise = await createReviseWorkspace(runtime, 'revise', world, config);
  assert.deepEqual(fs.readdirSync(init.contextDir), []);
  assert.equal(init.submitMarker, '[DAYLOOM_INIT_SUBMIT_V2]\n立即按照 Core 的 Init Submission Final 契约最终整理本会话。');
  assert.match(fs.readFileSync(init.submitConfig, 'utf8'), /final-submit\.md/);
  assert.match(fs.readFileSync(path.join(init.root, 'react', 'final-submit.md'), 'utf8'), /InitSubmissionV2/);
  assert.equal(planning.submitMarker, '[DAYLOOM_PLANNING_SUBMIT_V2]\n立即按照 Core 的 Planning Submission Final 契约最终整理本会话。');
  assert.equal(revise.submitMarker, '[DAYLOOM_REVISE_SUBMIT_V2]\n立即按照 Core 的 Revise Submission Final 契约最终整理本会话。');
  assert.match(buildLifecycleContext(planning), /^\[DAYLOOM_PLANNING_CONTEXT_V1\]/);
  assert.match(buildLifecycleContext(planning), /\[WORLD_PROFILE_V1\]/);
  assert.match(buildLifecycleContext(revise), /^\[DAYLOOM_REVISE_CONTEXT_V1\]/);
  assert.match(buildLifecycleContext(revise), /\[VERIFIED_WORLD_DOCUMENTS\]/);
  const settledWorld = { ...world, commit: { ...world.commit, control: { phase: 'idle', day: null, lastSettledDay: 'day1' } }, lastSettledSummary: 'Verified summary\n' };
  const day2 = await createPlanningWorkspace(runtime, 'planning-day2', settledWorld, config);
  assert.equal(buildLifecycleContext(day2).includes('\n\n[LAST_SETTLED_SUMMARY]\nVerified summary\n'), true);
  assert.equal(buildLifecycleContext(planning).includes('[LAST_SETTLED_SUMMARY]'), false);
  assert.match(fs.readFileSync(path.join(init.root, 'react', 'thought.md'), 'utf8'), /建立丰富的新 World/);
  assert.match(fs.readFileSync(path.join(init.root, 'react', 'thought.md'), 'utf8'), /用户明确确认前/);
  assert.match(fs.readFileSync(path.join(planning.root, 'react', 'thought.md'), 'utf8'), /不要修改 Canon、targetDay/);
  assert.match(fs.readFileSync(path.join(revise.root, 'react', 'thought.md'), 'utf8'), /不要重写 Manifest 标识/);
  for (const session of [init, planning, revise]) {
    for (const prompt of ['final-send.md', 'final-submit.md']) {
      const finalPrompt = fs.readFileSync(path.join(session.root, 'react', prompt), 'utf8');
      assert.equal(finalPrompt.includes(OBSERVE_HANDOFF_AUTHORITY_NOTE), true);
      assert.match(finalPrompt, /不要假设原始 Thought 或工具工作对你可见/);
      assert.match(finalPrompt, /直接回答用户最新一轮消息/);
      assert.match(finalPrompt, /model-proposal 和 awaiting-user-confirmation/);
      assert.match(finalPrompt, /确认、敲定、完成、最终确定或完整成型/);
    }
  }
  assert.match(buildDayloomObservePrompt(true), /retrieval_available=true/);
});
test('React runner rejects malformed, schema-invalid, gaps, session changes and Final mismatch', async () => {
  const boundaries = await resolvePackagedBoundaries();
  const base = { runner: null, reactBin: 'react', validateProcessPile: boundaries.validateProcessPile, config: 'c', context: 'x', conversation: 'y' };
  for (const stream of [
    '{bad\n',
    JSON.stringify({ schema_version: 1, type: 'bad', process_id: 'x', sequence: 0 }) + '\n',
    eventStream('ok').replace('"sequence":1', '"sequence":2'),
    eventStream('ok').replace(`"process_id":"react_${'1'.repeat(32)}","sequence":1`, `"process_id":"react_${'3'.repeat(32)}","sequence":1`),
    eventStream('ok').replace('"content":"ok"}}', '"content":"different"}}'),
  ]) {
    const runner = { run: async (_bin, _args, options) => { options.onExtraPipe?.(stream); return { code: 0, stdout: '', stderr: '' }; } };
    await assert.rejects(() => runReact({ ...base, runner }));
  }
});
test('React runner consumes Process Pile incrementally across FD3 chunks', async () => {
  const boundaries = await resolvePackagedBoundaries(), received = [];
  const stream = eventStream('hello'), split = stream.indexOf('hello') + 2;
  const runner = { run: async (_bin, _args, options) => {
    options.onExtraPipe(stream.slice(0, split)); options.onExtraPipe(stream.slice(split));
    return { code: 0, stdout: '', stderr: '' };
  } };
  const final = await runReact({ runner, reactBin: 'react', validateProcessPile: boundaries.validateProcessPile, config: 'c', context: 'x', conversation: 'y', observer: { outputDelta: (text) => received.push(text) } });
  assert.equal(final, 'hello'); assert.deepEqual(received, ['hello']);
});
test('React runner accepts max_step only when Check requested continuation at the exhausted budget', async () => {
  const boundaries = await resolvePackagedBoundaries();
  const base = { reactBin: 'react', validateProcessPile: boundaries.validateProcessPile, config: 'c', context: 'x', conversation: 'y' };
  const run = (stream) => runReact({ ...base, runner: { run: async (_bin, _args, options) => { options.onExtraPipe?.(stream); return { code: 0, stdout: '', stderr: '' }; } } });
  assert.equal(await run(eventStream('budget-final', { continueDecision: true })), 'budget-final');
  for (const stream of [
    eventStream('wrong-final', { continueDecision: true, stopReason: 'final' }),
    eventStream('wrong-max-step', { continueDecision: false, stopReason: 'max_step' }),
  ]) {
    await assert.rejects(() => run(stream), (error) => {
      assert.equal(error.name, 'ReactProtocolError');
      assert.equal(error.code, 'STOP_REASON');
      assert.match(error.message, /Final evidence is inconsistent/);
      return true;
    });
  }
});
test('React runner emits Final delta before the child process closes', async () => {
  const boundaries = await resolvePackagedBoundaries(), lines = eventStream('live').trimEnd().split('\n'); let close;
  const runner = { run: async (_bin, _args, options) => new Promise((resolve) => {
    options.onExtraPipe(`${lines.slice(0, 10).join('\n')}\n`);
    close = () => { options.onExtraPipe(`${lines.slice(10).join('\n')}\n`); resolve({ code: 0, stdout: '', stderr: '' }); };
  }) };
  let delta = '', settled = false;
  const running = runReact({ runner, reactBin: 'react', validateProcessPile: boundaries.validateProcessPile, config: 'c', context: 'x', conversation: 'y', observer: { outputDelta: (text) => { delta += text; } } }).finally(() => { settled = true; });
  while (!close) await new Promise((resolve) => setImmediate(resolve));
  assert.equal(delta, 'live'); assert.equal(settled, false); close(); assert.equal(await running, 'live');
});
test('React runner rejects truncated JSONL at EOF', async () => {
  const boundaries = await resolvePackagedBoundaries(), stream = eventStream('x').slice(0, -3);
  const runner = { run: async (_bin, _args, options) => { options.onExtraPipe(stream); return { code: 0, stdout: '', stderr: '' }; } };
  await assert.rejects(() => runReact({ runner, reactBin: 'react', validateProcessPile: boundaries.validateProcessPile, config: 'c', context: 'x', conversation: 'y' }), /truncated Process Pile JSONL/);
});
test('React runner preserves the concrete Process Pile failure message', async () => {
  const boundaries = await resolvePackagedBoundaries(), process_id = `react_${'1'.repeat(32)}`, work_id = `work_${'2'.repeat(32)}`, work_path = 'C:/tmp/react/work';
  const stream = [
    { schema_version: 1, process_id, sequence: 0, type: 'process.started', max_steps: 1, work_id, work_path, work_lifecycle: 'cleanup' },
    { schema_version: 1, process_id, sequence: 1, type: 'process.failed', phase: 'thought', steps_completed: 0, work: { work_id, status: 'failed', work_path }, error: { code: 'promptpile_exit_nonzero', message: 'provider rejected the API key' } },
  ].map(JSON.stringify).join('\n') + '\n';
  const runner = { run: async (_bin, _args, options) => { options.onExtraPipe(stream); return { code: 1, stdout: '', stderr: '' }; } };
  await assert.rejects(
    () => runReact({ runner, reactBin: 'react', validateProcessPile: boundaries.validateProcessPile, config: 'c', context: 'x', conversation: 'y' }),
    /provider rejected the API key/,
  );
});
test('React runner rejects a completed but empty Final', async () => {
  const boundaries = await resolvePackagedBoundaries(), stream = eventStream('   ');
  const runner = { run: async (_bin, _args, options) => { options.onExtraPipe(stream); return { code: 0, stdout: '', stderr: '' }; } };
  await assert.rejects(
    () => runReact({ runner, reactBin: 'react', validateProcessPile: boundaries.validateProcessPile, config: 'c', context: 'x', conversation: 'y' }),
    /React Final was empty/,
  );
});
test('React invocation keeps the frozen context/output topology and enables no input, tools, or hook', async () => {
  const boundaries = await resolvePackagedBoundaries(), stream = eventStream('ok'); let captured;
  const runner = { run: async (bin, args, options) => { captured = { bin, args, options }; options.onExtraPipe(stream); return { code: 0, stdout: '', stderr: '' }; } };
  await runReact({ runner, reactBin: 'packaged-react', validateProcessPile: boundaries.validateProcessPile, config: 'send.toml', context: 'context-dir', conversation: 'conversation-dir' });
  assert.deepEqual(captured.args, ['--config', 'send.toml', '-d', 'context-dir', '--output-dir', 'conversation-dir', '--continue', '--max-step', '10', '--quiet', '--process-pile-fd', '3', '--process-pile-format', 'json']);
  assert.equal(captured.args.includes('--input'), false); assert.equal(captured.args.includes('--tools-file'), false); assert.equal(captured.args.includes('--after-hook-path'), false);
});
test('React continuation policy requires available, needs-more, concrete archive retrieval evidence', async () => {
  const boundaries = await resolvePackagedBoundaries();
  const observe = `[SESSION]\nretrieval_available=true\n[RETRIEVAL_STATUS]\nneeds-more\n[NEXT_RETRIEVAL]\nread_file_lines path=canon/premise.md start_line=1 end_line=10\n[FINAL_CONTRACT]\nAnswer the latest user turn.`;
  const execute = (continuationPolicy, text = observe) => runReact({
    runner: { run: async (_bin, _args, options) => { options.onExtraPipe(continuationStream(text)); return { code: 0, stdout: '', stderr: '' }; } },
    reactBin: 'react', validateProcessPile: boundaries.validateProcessPile, config: 'c', context: 'x', conversation: 'y', continuationPolicy,
  });
  await assert.rejects(() => execute({ retrievalAvailable: false }), (error) => error.code === 'CONTINUE_POLICY' && /without an available retrieval/.test(error.message));
  await assert.rejects(() => execute({ retrievalAvailable: true }, observe.replace('needs-more', 'sufficient')), (error) => error.code === 'CONTINUE_POLICY' && /only when Observe retrieval status is needs-more/.test(error.message));
  await assert.rejects(() => execute({ retrievalAvailable: true }, observe.replace('read_file_lines path=canon/premise.md start_line=1 end_line=10', '<none>')), (error) => error.code === 'CONTINUE_POLICY' && /without a concrete next retrieval/.test(error.message));
  assert.equal(await execute({ retrievalAvailable: true }), 'ok');
});
test('architecture guard rejects legacy and deep imports', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'core-guard-'));
  try {
    fs.writeFileSync(path.join(root, 'bad.ts'), "import '@dayloom/core';\nimport 'promptpile-react/dist/runtime';\nimport 'promptpile-compress/dist/compress';\nimport 'promptpile-protocol';\n");
    const result = spawnSync(process.execPath, [path.join(__dirname, '..', 'scripts', 'check-architecture.mjs')], { env: { ...process.env, CORE_ARCHITECTURE_ROOT: root }, encoding: 'utf8' });
    assert.notEqual(result.status, 0); assert.match(result.stderr, /forbidden import @dayloom\/core/); assert.match(result.stderr, /forbidden import promptpile-compress\/dist\/compress/); assert.match(result.stderr, /package root may only be imported by archive-retrieval-artifacts/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
