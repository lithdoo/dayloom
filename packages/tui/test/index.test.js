import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';

const world = {
  worldId: 'world1', title: 'Test World', revision: 1, commitId: 'commit1',
  phase: 'planned', day: 'day1', lastSettledDay: null,
};

class FakeCore {
  constructor(options = {}) {
    this.state = makeState(options.phase ?? 'planned');
    this.listeners = new Set();
    this.deltas = options.deltas ?? ['ok'];
    this.sendFailure = options.sendFailure ?? null;
    this.submitFailure = options.submitFailure ?? null;
    this.disposeCalls = 0;
    this.sent = [];
  }
  getState() { return this.state; }
  subscribe(listener) { this.listeners.add(listener); return () => this.listeners.delete(listener); }
  emit(event) { for (const listener of [...this.listeners]) listener(event); }
  change(state) { this.state = state; this.emit({ type: 'state.changed', state }); }
  async startSession() {
    if (!this.state.capabilities.startSessions.includes('play')) return failure('not available');
    this.change(sessionState('session1', 'ready'));
    return { ok: true };
  }
  async send(text) {
    this.sent.push(text);
    this.change(sessionState('session1', 'running'));
    for (const delta of this.deltas) this.emit({ type: 'output.delta', sessionId: 'session1', text: delta });
    if (this.sendFailure) {
      if (this.sendFailure.terminal) this.change(makeState('planned'));
      else this.change(sessionState('session1', 'ready'));
      return failure(this.sendFailure.message);
    }
    this.change(sessionState('session1', 'ready'));
    return { ok: true };
  }
  async submit() {
    this.change(sessionState('session1', 'submitting'));
    if (this.submitFailure) {
      this.change(this.submitFailure.terminal ? makeState('planned') : sessionState('session1', 'ready'));
      return failure(this.submitFailure.message);
    }
    this.change(makeState('awaiting-settle'));
    return { ok: true };
  }
  async cancel() { this.change(makeState('planned')); return { ok: true }; }
  async dispose() { this.disposeCalls += 1; this.listeners.clear(); }
}

test('exports package marker', async () => {
  const publicApi = await import('../dist/index.js');
  const { tuiPackageName } = publicApi;
  assert.equal(tuiPackageName, '@dayloom/tui');
  assert.equal('createRuntimeDriverInternal' in publicApi, false);
});

test('argv resolves explicit and environment LLM config and rejects missing config', async () => {
  const { parseArgv, usage } = await import('../dist/index.js');
  assert.deepEqual(parseArgv(['node', 'tui', './world', '--llm-config', './llm.toml'], '/tmp', {}), {
    worldRoot: './world', llmConfigPath: './llm.toml', help: false,
  });
  assert.equal(parseArgv(['node', 'tui'], '/tmp', { DAYLOOM_LLM_CONFIG: 'env.toml' }).llmConfigPath, 'env.toml');
  assert.equal(parseArgv(['node', 'tui', '--help'], '/tmp', {}).help, true);
  assert.throws(() => parseArgv(['node', 'tui'], '/tmp', {}), /Missing LLM config/);
  assert.match(usage(), /--llm-config/);
});

test('projects only Core2 Play plus local Hub actions and preserves a valid selection', async () => {
  const { projectHubActions } = await import('../dist/index.js');
  const available = projectHubActions(['play'], null);
  assert.deepEqual(available.actions.map((action) => action.id), ['play', 'status', 'help', 'quit']);
  assert.equal(available.selectedId, 'play');
  assert.equal(projectHubActions([], 'play').selectedId, 'status');
  assert.equal(projectHubActions(['play'], 'help').selectedId, 'help');
});

test('driver resolves bootstrap paths and creates Core2 through its internal factory seam', async () => {
  const { createRuntimeDriverInternal } = await import('../dist/runtime-driver/create-runtime-driver.js');
  const core = new FakeCore();
  let received;
  const driver = await createRuntimeDriverInternal(
    { worldRoot: '.', llmConfigPath: './llm.toml' },
    { createCore: async (options) => { received = options; return core; } },
  );
  assert.equal(path.isAbsolute(received.worldRoot), true);
  assert.equal(path.isAbsolute(received.llmConfigPath), true);
  assert.equal(driver.getState().world.worldRoot, received.worldRoot);
  await driver.dispose();
});

test('driver completes Play multi-turn streaming and explicit submit', async () => {
  const { driver, core } = await createDriver({ deltas: ['one', 'two'] });
  await driver.runHubAction('play');
  assert.equal(driver.getState().page.kind, 'session');
  await driver.submitSessionText('  hello  ');
  assert.deepEqual(core.sent, ['hello']);
  assert.deepEqual(driver.getState().messages.map((message) => [message.role, message.text, message.status]), [
    ['user', 'hello', 'complete'], ['assistant', 'onetwo', 'complete'],
  ]);
  await driver.submitSessionText('/submit');
  assert.equal(driver.getState().page.kind, 'hub');
  assert.equal(driver.getState().world.phase, 'awaiting-settle');
  assert.deepEqual(driver.getState().recent, { kind: 'completed', label: '会话已提交', detail: null });
  await driver.dispose();
});

test('output delta is visible before send resolves and stale deltas are ignored', async () => {
  const core = new FakeCore({ deltas: [] });
  let resolveSend;
  core.send = async (text) => {
    core.sent.push(text); core.change(sessionState('session1', 'running'));
    core.emit({ type: 'output.delta', sessionId: 'old-session', text: 'stale' });
    core.emit({ type: 'output.delta', sessionId: 'session1', text: 'live' });
    await new Promise((resolve) => { resolveSend = resolve; });
    core.change(sessionState('session1', 'ready')); return { ok: true };
  };
  const { driver } = await createDriverWithCore(core);
  await driver.runHubAction('play');
  const pending = driver.submitSessionText('hello');
  await waitFor(() => driver.getState().messages.some((message) => message.text === 'live'));
  assert.equal(driver.getState().messages.some((message) => message.text.includes('stale')), false);
  assert.equal(driver.getState().messages.at(-1).status, 'streaming');
  resolveSend(); await pending;
  assert.equal(driver.getState().messages.at(-1).status, 'complete');
  await driver.dispose();
});

test('terminal failures use Hub recent while non-terminal failures stay in Session', async () => {
  const terminal = await createDriver({ sendFailure: { terminal: true, message: 'provider failed' }, deltas: ['partial'] });
  await terminal.driver.runHubAction('play'); await terminal.driver.submitSessionText('hello');
  assert.equal(terminal.driver.getState().page.kind, 'hub');
  assert.deepEqual(terminal.driver.getState().recent, { kind: 'failed', label: '发送失败', detail: 'provider failed' });
  assert.equal(terminal.driver.getState().messages.some((message) => message.role === 'system'), false);
  await terminal.driver.dispose();

  const nonterminal = await createDriver({ sendFailure: { terminal: false, message: 'try again' }, deltas: [] });
  await nonterminal.driver.runHubAction('play'); await nonterminal.driver.submitSessionText('hello');
  assert.equal(nonterminal.driver.getState().page.kind, 'session');
  assert.equal(nonterminal.driver.getState().messages.at(-1).status, 'error');
  assert.equal(nonterminal.driver.getState().recent, null);
  await nonterminal.driver.dispose();
});

test('slash commands remain local or call legal Core2 mutations', async () => {
  const { driver } = await createDriver(); await driver.runHubAction('play');
  await driver.submitSessionText('/next');
  assert.match(driver.getState().messages.at(-1).text, /不提供 \/next/);
  await driver.submitSessionText('/exit');
  assert.equal(driver.getState().page.kind, 'hub');
  assert.equal(driver.getState().recent.kind, 'cancelled');
  await driver.dispose();
});

test('view model preserves input history, loading projection, focus lifecycle and quit', async () => {
  const { createViewModel } = await import('../dist/index.js');
  const { mountAutofocus } = await import('../dist/app.js');
  const { HUB_SELECT_ID, TEXTAREA_ID } = await import('../dist/components/constants.js');
  const { driver } = await createDriver(); let exitRequests = 0;
  const vm = createViewModel(driver, { onExitRequest: () => { exitRequests += 1; } });
  const scheduled = [], focused = [];
  const stop = mountAutofocus(vm, { focus(id) { focused.push(id); return { handled: true, dirtyNodes: [] }; } }, (fn) => scheduled.push(fn));
  drain(scheduled); assert.equal(focused.at(-1), HUB_SELECT_ID);
  await driver.runHubAction('play'); drain(scheduled); assert.equal(focused.at(-1), TEXTAREA_ID);
  vm.inputValue.set('first'); vm.submitTextInput(); await waitFor(() => vm.inputEnabled.get());
  vm.inputValue.set('draft'); vm.navigateInputHistory(-1); assert.equal(vm.inputValue.get(), 'first');
  vm.navigateInputHistory(1); assert.equal(vm.inputValue.get(), 'draft');
  await driver.submitSessionText('/exit'); drain(scheduled); assert.equal(focused.at(-1), HUB_SELECT_ID);
  vm.selectHubAction('quit'); await vm.submitHubSelection(); assert.equal(exitRequests, 1);
  stop(); await vm.dispose();
});

test('dispose is idempotent, unsubscribes, and prevents later emissions', async () => {
  const { driver, core } = await createDriver(); let emissions = 0;
  driver.subscribe(() => { emissions += 1; });
  await driver.dispose(); await driver.dispose();
  const before = emissions;
  core.emit({ type: 'state.changed', state: makeState('planned') });
  assert.equal(emissions, before); assert.equal(core.disposeCalls, 1); assert.equal(core.listeners.size, 0);
});

async function createDriver(options = {}) { return createDriverWithCore(new FakeCore(options)); }
async function createDriverWithCore(core) {
  const { createRuntimeDriverInternal } = await import('../dist/runtime-driver/create-runtime-driver.js');
  return { driver: await createRuntimeDriverInternal({ worldRoot: '.', llmConfigPath: './llm.toml' }, { core }), core };
}
function makeState(phase) {
  return { world: { ...world, phase }, session: null, capabilities: { startSessions: phase === 'planned' ? ['play'] : [], send: false, submit: false, cancel: false } };
}
function sessionState(id, status) {
  const ready = status === 'ready';
  return { world: { ...world }, session: { id, kind: 'play', status }, capabilities: { startSessions: [], send: ready, submit: ready, cancel: ready } };
}
function failure(message) { return { ok: false, error: { code: 'INTERNAL_ERROR', message } }; }
async function waitFor(predicate, timeout = 1000) { const start = Date.now(); while (!predicate()) { if (Date.now() - start > timeout) throw new Error('timeout'); await new Promise((r) => setTimeout(r, 5)); } }
function drain(callbacks) { while (callbacks.length) callbacks.shift()(); }
