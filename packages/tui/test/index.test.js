import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { ScriptedDayloomCore, deferred, failure, invalid, published, success } from './support/scripted-core.mjs';

const testDriverModule = '../dist/runtime-driver/create-runtime-driver-from-core-for-test.js';

async function driverFor(core, worldRoot = path.resolve('test-world')) {
  const { createRuntimeDriverFromCoreForTest } = await import(testDriverModule);
  return createRuntimeDriverFromCoreForTest({ worldRoot, core });
}

test('exports package marker without exporting the test-only Core seam', async () => {
  const api = await import('../dist/index.js');
  assert.equal(api.tuiPackageName, '@dayloom/tui');
  assert.equal('createRuntimeDriverFromCoreForTest' in api, false);
});

test('tui-cli-option-order-is-stable and config precedence is exact', async () => {
  const { parseArgv, resolveLlmConfigPath, usage } = await import('../dist/index.js');
  assert.deepEqual(parseArgv(['node', 'tui'], '/cwd'), { worldRoot: '/cwd', llmConfigPath: null, help: false });
  assert.deepEqual(parseArgv(['node', 'tui', 'world', '--llm-config', 'a.toml']), { worldRoot: 'world', llmConfigPath: 'a.toml', help: false });
  assert.deepEqual(parseArgv(['node', 'tui', '--llm-config', 'a.toml', 'world']), { worldRoot: 'world', llmConfigPath: 'a.toml', help: false });
  assert.equal(resolveLlmConfigPath(parseArgv(['node', 'tui', '--llm-config', 'cli.toml']), { DAYLOOM_LLM_CONFIG: 'env.toml' }), 'cli.toml');
  assert.equal(resolveLlmConfigPath(parseArgv(['node', 'tui']), { DAYLOOM_LLM_CONFIG: 'env.toml' }), 'env.toml');
  assert.throws(() => resolveLlmConfigPath(parseArgv(['node', 'tui']), {}), /Missing LLM config/);
  assert.throws(() => parseArgv(['node', 'tui', '--llm-config']), /Missing value/);
  assert.throws(() => parseArgv(['node', 'tui', '--llm-config', 'a', '--llm-config', 'b']), /Duplicate/);
  assert.throws(() => parseArgv(['node', 'tui', 'one', 'two']), /Unexpected argument/);
  assert.throws(() => parseArgv(['node', 'tui', '--lang']), /Unknown option/);
  assert.equal(parseArgv(['node', 'tui', '--help']).help, true);
  assert.match(usage(), /--llm-config <path>/);
});

test('tui-cli-help-needs-no-llm-config and production startup rejects missing config before mount', () => {
  const main = path.resolve(import.meta.dirname, '../dist/main.js');
  const help = spawnSync(process.execPath, [main, '--help'], { encoding: 'utf8', env: { ...process.env, DAYLOOM_LLM_CONFIG: '' } });
  assert.equal(help.status, 0); assert.match(help.stdout, /Usage: dayloom-tui/); assert.equal(help.stderr, '');
  const missing = spawnSync(process.execPath, [main], { encoding: 'utf8', env: { ...process.env, DAYLOOM_LLM_CONFIG: '' } });
  assert.equal(missing.status, 1); assert.match(missing.stderr, /Missing LLM config/);
});

test('tui projects Core world states and exact Hub actions', async () => {
  const cases = [
    [new ScriptedDayloomCore(), 'uninitialized', ['init', 'status', 'help', 'quit'], 'init'],
    [new ScriptedDayloomCore({ world: published({ phase: 'idle' }) }), 'published', ['daily', 'revise', 'status', 'help', 'quit'], 'daily'],
    [new ScriptedDayloomCore({ world: published({ phase: 'planned', day: 'day1' }) }), 'published', ['play', 'abandon-day', 'status', 'help', 'quit'], 'play'],
    [new ScriptedDayloomCore({ world: published({ phase: 'awaiting-settle', day: 'day1' }) }), 'published', ['settle', 'abandon-day', 'status', 'help', 'quit'], 'settle'],
    [new ScriptedDayloomCore({ world: invalid('broken') }), 'invalid', ['status', 'help', 'quit'], 'status'],
  ];
  for (const [core, status, actions, selected] of cases) {
    const driver = await driverFor(core);
    assert.equal(driver.getState().world.status, status);
    assert.deepEqual(driver.getState().hubActions.map((action) => action.id), actions);
    assert.equal(driver.getState().selectedHubActionId, selected);
    await driver.dispose();
  }
});

test('tui-daily-maps-to-startSession-planning and all business actions map exactly once', async () => {
  const cases = [
    [new ScriptedDayloomCore(), 'init', ['startSession', 'init']],
    [new ScriptedDayloomCore({ world: published() }), 'daily', ['startSession', 'planning']],
    [new ScriptedDayloomCore({ world: published() }), 'revise', ['startSession', 'revise']],
    [new ScriptedDayloomCore({ world: published({ phase: 'planned', day: 'day1' }) }), 'play', ['startSession', 'play']],
    [new ScriptedDayloomCore({ world: published({ phase: 'awaiting-settle', day: 'day1' }) }), 'settle', ['settle']],
    [new ScriptedDayloomCore({ world: published({ phase: 'planned', day: 'day1' }) }), 'abandon-day', ['abandonDay']],
  ];
  for (const [core, action, expected] of cases) {
    const driver = await driverFor(core); await driver.runHubAction(action);
    assert.deepEqual(core.calls.filter((call) => call[0] !== 'dispose'), [expected]);
    assert.equal('command' in driver.getState().hubActions[0], false);
    await driver.dispose();
  }
});

test('tui-pending-hub-request freezes topology and startSession switches only after result', async () => {
  const gate = deferred();
  const core = new ScriptedDayloomCore({ handlers: {
    async startSession(instance, kind) {
      instance.session = { id: 'pending-session', kind, status: 'ready' };
      instance.changed();
      await gate.promise;
      return success();
    },
  } });
  const driver = await driverFor(core);
  const pending = driver.runHubAction('init');
  assert.equal(driver.getState().page.kind, 'hub');
  assert.equal(driver.getState().page.busy.actionId, 'init');
  assert.deepEqual(driver.getState().hubActions.map((action) => action.id), ['init', 'status', 'help', 'quit']);
  gate.resolve(); await pending;
  assert.equal(driver.getState().page.kind, 'session');
  assert.deepEqual(driver.getState().messages.map((message) => [message.role, message.text]), [['system', '你想从什么样的世界开始？']]);
  await driver.dispose();
});

test('tui-selection-persists-while-visible and falls back to recommendation', async () => {
  const core = new ScriptedDayloomCore({ world: published() });
  const driver = await driverFor(core);
  driver.selectHubAction('revise'); assert.equal(driver.getState().selectedHubActionId, 'revise');
  core.setState({ world: published({ phase: 'planned', day: 'day1' }) });
  assert.equal(driver.getState().selectedHubActionId, 'play');
  await driver.dispose();
});

test('tui-hub-actions-are-noop-outside-hub-page', async () => {
  const core = new ScriptedDayloomCore();
  const driver = await driverFor(core); await driver.runHubAction('init');
  const before = driver.getState();
  assert.equal(await driver.runHubAction('status'), 'continue');
  driver.selectHubAction('status');
  assert.deepEqual(driver.getState(), before);
  assert.deepEqual(core.calls.filter((call) => call[0] !== 'dispose'), [['startSession', 'init']]);
  await driver.dispose();
});

test('tui-dispose-during-hub-request-prevents-late-presentation-write', async () => {
  const gate = deferred();
  const core = new ScriptedDayloomCore({
    world: published({ phase: 'awaiting-settle', day: 'day1' }),
    handlers: { async settle(instance) {
      await gate.promise;
      instance.world = published({ revision: 2, phase: 'idle', day: null, lastSettledDay: 'day1' });
      return success();
    } },
  });
  const driver = await driverFor(core);
  const request = driver.runHubAction('settle');
  const beforeDispose = driver.getState();
  await driver.dispose();
  gate.resolve();
  assert.equal(await request, 'exit');
  assert.deepEqual(driver.getState(), { ...beforeDispose, messages: [] });
});

test('tui-listener-errors-are-isolated-from-hub-actions', async () => {
  const errors = [];
  const diagnostic = {
    enabled: true,
    log() {},
    error(event, error) { errors.push([event, error]); },
    flush() {},
    dispose() {},
  };
  const core = new ScriptedDayloomCore();
  const { createRuntimeDriverFromCoreForTest } = await import(testDriverModule);
  const driver = createRuntimeDriverFromCoreForTest({ worldRoot: path.resolve('test-world'), core, diagnostic });
  let notifications = 0;
  driver.subscribe(() => { notifications += 1; if (notifications > 1) throw new Error('listener failed'); });
  assert.equal(await driver.runHubAction('init'), 'continue');
  assert.deepEqual(core.calls.filter((call) => call[0] !== 'dispose'), [['startSession', 'init']]);
  assert.equal(driver.getState().page.kind, 'session');
  assert.equal(errors.some(([event]) => event === 'driver-listener-error'), true);
  await driver.dispose();
});

test('tui user text, delta aggregation, and send success preserve one transcript', async () => {
  const core = new ScriptedDayloomCore({ sendScript: [{ deltas: ['one', ' two'] }] });
  const driver = await driverFor(core); await driver.runHubAction('init');
  await driver.submitSessionText(' hello ');
  assert.deepEqual(core.calls.filter((call) => call[0] === 'send'), [['send', 'hello']]);
  assert.deepEqual(driver.getState().messages.map((message) => [message.role, message.text, message.status]), [
    ['system', '你想从什么样的世界开始？', 'complete'], ['user', 'hello', 'complete'], ['assistant', 'one two', 'complete'],
  ]);
  assert.equal(driver.getState().session.status, 'ready');
  await driver.dispose();
});

test('tui-partial-output-survives terminal send failure and failed dismiss preserves failure truth', async () => {
  const core = new ScriptedDayloomCore({ sendScript: [{ deltas: ['partial'], failure: { code: 'AGENT_FAILED', message: 'agent failed' } }] });
  const driver = await driverFor(core); await driver.runHubAction('init');
  await driver.submitSessionText('hello');
  assert.equal(driver.getState().session.status, 'failed');
  assert.equal(driver.getState().messages.some((message) => message.role === 'assistant' && message.text === 'partial' && message.status === 'error'), true);
  assert.equal(driver.getState().recent.kind, 'failed');
  const cancelCalls = core.calls.filter((call) => call[0] === 'cancel').length;
  await driver.submitSessionText('/exit');
  assert.equal(driver.getState().page.kind, 'hub');
  assert.equal(driver.getState().recent.kind, 'failed');
  assert.equal(core.calls.filter((call) => call[0] === 'cancel').length, cancelCalls);
  assert.deepEqual(driver.getState().messages, []);
  await driver.dispose();
});

test('tui-nonterminal-send-failure keeps active Session', async () => {
  const core = new ScriptedDayloomCore({ sendScript: [{ deltas: ['partial'], terminal: false, failure: { code: 'CONVERSATION_FAILED', message: 'retry later' } }] });
  const driver = await driverFor(core); await driver.runHubAction('init'); await driver.submitSessionText('hello');
  assert.equal(driver.getState().page.kind, 'session'); assert.equal(driver.getState().session.status, 'ready');
  assert.equal(driver.getState().messages.at(-1).text, 'retry later');
  await driver.dispose();
});

test('tui submit success discards transcript and terminal failure preserves failed presentation', async () => {
  const successCore = new ScriptedDayloomCore(); const successDriver = await driverFor(successCore);
  await successDriver.runHubAction('init'); await successDriver.submitSessionText('/submit');
  assert.equal(successDriver.getState().page.kind, 'hub'); assert.deepEqual(successDriver.getState().messages, []);
  assert.equal(successDriver.getState().recent.kind, 'completed'); await successDriver.dispose();

  const failedCore = new ScriptedDayloomCore({ handlers: { async submit(instance) {
    instance.session = { ...instance.session, status: 'submitting' }; instance.changed();
    instance.session = null; instance.changed(); return failure('SUBMISSION_INVALID', 'invalid submission');
  } } });
  const failedDriver = await driverFor(failedCore); await failedDriver.runHubAction('init'); await failedDriver.submitSessionText('/submit');
  assert.equal(failedDriver.getState().session.status, 'failed');
  assert.equal(failedDriver.getState().messages.at(-1).text, 'invalid submission');
  await failedDriver.dispose();
});

test('tui running cancel suppresses late send ownership and cancel owns Hub transition', async () => {
  const sendGate = deferred();
  const core = new ScriptedDayloomCore({ handlers: {
    async send(instance, text) {
      instance.calls.push(['send-handler', text]); const id = instance.session.id;
      instance.session = { ...instance.session, status: 'running' }; instance.changed();
      instance.delta(id, 'partial'); await sendGate.promise; return failure('CANCELLED', 'cancelled');
    },
    async cancel(instance) { instance.session = null; instance.changed(); sendGate.resolve(); return success(); },
  } });
  const driver = await driverFor(core); await driver.runHubAction('init');
  const sending = driver.submitSessionText('hello'); await waitFor(() => driver.getState().session.status === 'running');
  assert.deepEqual(driver.getState().sessionControls, { input: false, submit: false, cancel: true, dismiss: false });
  await driver.submitSessionText('/exit'); await sending;
  assert.equal(driver.getState().page.kind, 'hub'); assert.equal(driver.getState().recent.kind, 'cancelled');
  assert.equal(driver.getState().recent.label, '会话已取消');
  await driver.dispose();
});

test('tui-running-cancel-failure restores status, suppression, and future delta rendering', async () => {
  const sendGate = deferred();
  const core = new ScriptedDayloomCore({ handlers: {
    async send(instance) {
      const { id } = instance.session; instance.session = { ...instance.session, status: 'running' }; instance.changed();
      instance.delta(id, 'before'); await sendGate.promise; instance.delta(id, ' after');
      instance.session = { ...instance.session, status: 'ready' }; instance.changed(); return success();
    },
    async cancel() { return failure('INTERNAL_ERROR', 'cancel rejected'); },
  } });
  const driver = await driverFor(core); await driver.runHubAction('init');
  const sending = driver.submitSessionText('hello'); await waitFor(() => driver.getState().session.status === 'running');
  await driver.submitSessionText('/cancel');
  assert.equal(driver.getState().session.status, 'running');
  assert.equal(driver.getState().messages.at(-1).text, 'cancel rejected');
  sendGate.resolve(); await sending;
  assert.equal(driver.getState().messages.some((message) => message.role === 'assistant' && message.text === 'before after'), true);
  assert.equal(driver.getState().session.status, 'ready'); await driver.dispose();
});

test('tui running normal text, submit, and unknown slash never enter Core', async () => {
  const gate = deferred();
  const core = new ScriptedDayloomCore({ handlers: { async send(instance) {
    instance.session = { ...instance.session, status: 'running' }; instance.changed(); await gate.promise;
    instance.session = { ...instance.session, status: 'ready' }; instance.changed(); return success();
  } } });
  const driver = await driverFor(core); await driver.runHubAction('init');
  const sending = driver.submitSessionText('first'); await waitFor(() => driver.getState().session.status === 'running');
  await driver.submitSessionText('second'); await driver.submitSessionText('/submit');
  assert.equal(core.calls.filter((call) => call[0] === 'send').length, 1);
  assert.equal(core.calls.filter((call) => call[0] === 'submit').length, 0);
  gate.resolve(); await sending; await driver.submitSessionText('/unknown');
  assert.equal(core.calls.filter((call) => call[0] === 'send').length, 1);
  await driver.dispose();
});

test('tui ViewModel preserves history, scroll choice, controls, and autofocus state inputs', async () => {
  const { createViewModel } = await import('../dist/index.js');
  const core = new ScriptedDayloomCore({ sendScript: [{ deltas: ['ok'] }] });
  const driver = await driverFor(core); const vm = createViewModel(driver);
  await driver.runHubAction('init'); assert.equal(vm.inputEnabled.get(), true);
  vm.inputValue.set('first'); vm.submitTextInput(); await waitFor(() => driver.getState().session.status === 'ready');
  vm.inputValue.set('draft'); vm.navigateInputHistory(-1); assert.equal(vm.inputValue.get(), 'first');
  vm.navigateInputHistory(1); assert.equal(vm.inputValue.get(), 'draft');
  vm.setMessageScrollOffset(3); assert.equal(vm.stickToBottom.get(), false);
  await driver.submitSessionText('/exit'); assert.equal(vm.page.get().kind, 'hub'); assert.equal(vm.messageScrollOffset.get(), 0);
  await vm.dispose(); assert.equal(core.calls.filter((call) => call[0] === 'dispose').length, 1);
});

test('tui-dispose is idempotent, discards transcript, and prevents late presentation writes', async () => {
  const gate = deferred();
  const core = new ScriptedDayloomCore({ handlers: { async send(instance) {
    instance.session = { ...instance.session, status: 'running' }; instance.changed(); await gate.promise; return success();
  } } });
  const driver = await driverFor(core); await driver.runHubAction('init');
  const sending = driver.submitSessionText('hello'); await waitFor(() => driver.getState().session.status === 'running');
  const before = driver.getState(); const first = driver.dispose(); const second = driver.dispose(); gate.resolve();
  await sending; await first; await second;
  assert.equal(core.calls.filter((call) => call[0] === 'dispose').length, 1);
  assert.deepEqual(driver.getState().messages, []); assert.equal(driver.getState().page.kind, before.page.kind);
});

async function waitFor(predicate, timeoutMs = 1000) {
  const started = Date.now();
  while (!predicate()) {
    if (Date.now() - started > timeoutMs) throw new Error('Timed out waiting for predicate.');
    await new Promise((resolve) => setTimeout(resolve, 2));
  }
}
