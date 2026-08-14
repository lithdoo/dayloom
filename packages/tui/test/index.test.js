import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

test('exports package marker', async () => {
  const { tuiPackageName } = await import('../dist/index.js');
  assert.equal(tuiPackageName, '@dayloom/tui');
});

test('argv accepts one optional world root and rejects extra arguments', async () => {
  const { parseArgv, usage } = await import('../dist/index.js');

  assert.deepEqual(parseArgv(['node', 'dayloom-tui'], '/tmp/default'), {
    worldRoot: '/tmp/default',
    help: false,
  });
  assert.deepEqual(parseArgv(['node', 'dayloom-tui', './world']), {
    worldRoot: './world',
    help: false,
  });
  assert.equal(parseArgv(['node', 'dayloom-tui', '--help']).help, true);
  assert.throws(
    () => parseArgv(['node', 'dayloom-tui', 'one', 'two']),
    /Unexpected argument: two/,
  );
  assert.throws(
    () => parseArgv(['node', 'dayloom-tui', '--lang']),
    /Unknown option: --lang/,
  );
  assert.match(usage(), /dayloom-tui \[worldRoot\]/);
});

test('projects hub actions from core command availability', async () => {
  const { projectHubActions } = await import('../dist/index.js');
  const { getCommandAvailability } = await import('@dayloom/core');
  const snapshot = {
    worldRoot: '/tmp/world',
    phase: 'idle',
    day: 'day_0001',
    initialized: true,
    invalidReason: null,
  };
  const session = {
    active: false,
    id: null,
    kind: null,
    status: 'none',
    input: null,
    loading: null,
    error: null,
  };

  const projected = projectHubActions(snapshot.phase, getCommandAvailability(snapshot, session), null, 'status');

  assert.deepEqual(projected.actions.map((action) => action.id), [
    'daily',
    'revise',
    'status',
    'help',
    'quit',
  ]);
  assert.equal(projected.selectedId, 'daily');
});

test('runtime driver keeps session open for normal input and submits on /submit', async (t) => {
  const { createRuntimeDriver } = await import('../dist/index.js');
  const { createFakeSessionFactory } = await import('@dayloom/core');
  const worldRoot = createTempWorld(t);
  const driver = await createRuntimeDriver({
    worldRoot,
    sessionFactory: createFakeSessionFactory({ deltas: ['ok'] }),
  });

  await driver.runHubAction('init');
  assert.equal(driver.getState().page.kind, 'session');
  assert.equal(driver.getState().snapshot.world.phase, 'initializing');
  assert.equal(driver.getState().recent, null);

  await driver.submitSessionText('hello');
  await waitFor(() => driver.getState().snapshot.session.status === 'waiting-input');
  assert.equal(driver.getState().page.kind, 'session');
  assert.equal(driver.getState().snapshot.world.phase, 'initializing');
  assert.deepEqual(driver.getState().messages.map((message) => [message.role, message.text]), [
    ['user', 'hello'],
    ['assistant', 'ok'],
  ]);

  await driver.submitSessionText('/submit');
  assert.equal(driver.getState().page.kind, 'hub');
  assert.equal(driver.getState().snapshot.world.phase, 'idle');

  await driver.dispose();
});

test('runtime driver intercepts session-local slash commands', async (t) => {
  const { createRuntimeDriver } = await import('../dist/index.js');
  const { createFakeSessionFactory } = await import('@dayloom/core');
  const worldRoot = createTempWorld(t);
  const driver = await createRuntimeDriver({
    worldRoot,
    sessionFactory: createFakeSessionFactory(),
  });

  await driver.runHubAction('init');
  await driver.submitSessionText('/next');

  assert.equal(driver.getState().page.kind, 'session');
  assert.equal(driver.getState().snapshot.world.phase, 'initializing');
  assert.equal(
    driver.getState().messages.some((message) => message.text.includes('tui 不提供 /next')),
    true,
  );

  await driver.submitSessionText('/exit');
  assert.equal(driver.getState().page.kind, 'hub');
  assert.equal(driver.getState().snapshot.world.phase, 'uninitialized');
  assert.equal(driver.getState().loading, null);
  assert.deepEqual(driver.getState().recent, {
    kind: 'cancelled',
    label: '会话已取消',
    detail: null,
  });

  await driver.dispose();
});

test('view model forwards the Hub quit action to the application lifecycle', async (t) => {
  const { createRuntimeDriver, createViewModel } = await import('../dist/index.js');
  const { createFakeSessionFactory } = await import('@dayloom/core');
  const worldRoot = createTempWorld(t);
  const driver = await createRuntimeDriver({
    worldRoot,
    sessionFactory: createFakeSessionFactory(),
  });
  let exitRequests = 0;
  const vm = createViewModel(driver, {
    onExitRequest: () => {
      exitRequests += 1;
    },
  });

  vm.selectHubAction('quit');
  await vm.submitHubSelection();

  assert.equal(exitRequests, 1);
  await vm.dispose();
});

test('runtime driver clears Hub busy state after an unexpected command failure', async () => {
  const { createRuntimeDriver } = await import('../dist/index.js');
  const { getCommandAvailability } = await import('@dayloom/core');
  const world = {
    worldRoot: '/tmp/world',
    phase: 'awaiting-settle',
    day: 'day_0001',
    initialized: true,
    invalidReason: null,
  };
  const session = {
    active: false,
    id: null,
    kind: null,
    status: 'none',
    input: null,
    loading: null,
    error: null,
  };
  let disposeCalls = 0;
  const runtime = {
    getSnapshot: () => ({ world, session }),
    getAvailableCommands: () => getCommandAvailability(world, session),
    sendInput: async () => {
      throw new Error('not used');
    },
    executeCommand: async () => {
      throw new Error('disk unavailable');
    },
    subscribe: () => () => {},
    dispose: async () => {
      disposeCalls += 1;
    },
  };
  const driver = await createRuntimeDriver({ worldRoot: world.worldRoot, runtime });

  assert.equal(driver.getState().selectedHubActionId, 'settle');
  await driver.runHubAction('settle');

  assert.equal(driver.getState().loading, null);
  assert.equal(driver.getState().page.kind, 'hub');
  assert.equal(driver.getState().page.busy, null);
  assert.deepEqual(driver.getState().recent, {
    kind: 'failed',
    label: '操作失败',
    detail: 'disk unavailable',
  });

  await driver.dispose();
  await driver.dispose();
  assert.equal(disposeCalls, 1);
});

test('view model disables input while streaming without forcing a scrolled message list to bottom', async (t) => {
  const { createRuntimeDriver, createViewModel } = await import('../dist/index.js');
  const { createFakeSessionFactory } = await import('@dayloom/core');
  const worldRoot = createTempWorld(t);
  const driver = await createRuntimeDriver({
    worldRoot,
    sessionFactory: createFakeSessionFactory({
      deltas: ['one', 'two'],
      delayMs: 20,
    }),
  });
  const vm = createViewModel(driver);

  await driver.runHubAction('init');
  assert.equal(vm.inputEnabled.get(), true);
  vm.setMessageScrollOffset(3);
  assert.equal(vm.stickToBottom.get(), false);

  await driver.submitSessionText('hello');
  assert.equal(vm.inputEnabled.get(), false);
  assert.equal(vm.loadingLabel.get(), 'AI 正在回复...');
  assert.equal(vm.stickToBottom.get(), false);

  await waitFor(() => driver.getState().snapshot.session.status === 'waiting-input');
  assert.equal(vm.inputEnabled.get(), true);
  assert.equal(vm.loadingLabel.get(), null);
  assert.equal(vm.stickToBottom.get(), false);

  await vm.dispose();
});

test('view model exposes a cancel recovery hint after an AI failure', async (t) => {
  const { createRuntimeDriver, createViewModel } = await import('../dist/index.js');
  const { createFakeSessionFactory } = await import('@dayloom/core');
  const worldRoot = createTempWorld(t);
  const driver = await createRuntimeDriver({
    worldRoot,
    sessionFactory: createFakeSessionFactory({
      deltas: ['partial'],
      failAtDeltaIndex: 1,
    }),
  });
  const vm = createViewModel(driver);

  await driver.runHubAction('init');
  await driver.submitSessionText('hello');
  await waitFor(() => driver.getState().snapshot.session.status === 'failed');

  assert.equal(vm.inputEnabled.get(), false);
  assert.equal(vm.inputControlEnabled.get(), true);
  assert.equal(vm.inputHint.get(), '/exit 或 /cancel 返回 Hub');
  assert.equal(driver.getState().messages.some((message) => message.status === 'error'), true);

  await vm.dispose();
});

test('view model keeps input history without losing the current draft', async (t) => {
  const { createRuntimeDriver, createViewModel } = await import('../dist/index.js');
  const { createFakeSessionFactory } = await import('@dayloom/core');
  const worldRoot = createTempWorld(t);
  const driver = await createRuntimeDriver({
    worldRoot,
    sessionFactory: createFakeSessionFactory({ deltas: ['ok'] }),
  });
  const vm = createViewModel(driver);
  await driver.runHubAction('init');

  vm.inputValue.set('first message');
  vm.submitTextInput();
  await waitFor(() => driver.getState().snapshot.session.status === 'waiting-input');
  vm.inputValue.set('unfinished draft');
  vm.navigateInputHistory(-1);
  assert.equal(vm.inputValue.get(), 'first message');
  vm.navigateInputHistory(1);
  assert.equal(vm.inputValue.get(), 'unfinished draft');

  await vm.dispose();
});

test('autofocus follows Hub and Session page transitions', async (t) => {
  const { mountAutofocus } = await import('../dist/app.js');
  const { HUB_SELECT_ID, TEXTAREA_ID } = await import('../dist/components/constants.js');
  const { createRuntimeDriver, createViewModel } = await import('../dist/index.js');
  const { createFakeSessionFactory } = await import('@dayloom/core');
  const worldRoot = createTempWorld(t);
  const driver = await createRuntimeDriver({
    worldRoot,
    sessionFactory: createFakeSessionFactory(),
  });
  const vm = createViewModel(driver);
  const scheduled = [];
  const focused = [];
  const stop = mountAutofocus(
    vm,
    {
      focus(id) {
        focused.push(id);
        return { handled: true, dirtyNodes: [] };
      },
    },
    (callback) => scheduled.push(callback),
  );

  drainCallbacks(scheduled);
  assert.equal(focused.at(-1), HUB_SELECT_ID);

  await driver.runHubAction('init');
  drainCallbacks(scheduled);
  assert.equal(focused.at(-1), TEXTAREA_ID);

  await driver.submitSessionText('/exit');
  drainCallbacks(scheduled);
  assert.equal(focused.at(-1), HUB_SELECT_ID);

  stop();
  await vm.dispose();
});

async function waitFor(predicate, timeoutMs = 1000) {
  const startedAt = Date.now();
  while (!predicate()) {
    if (Date.now() - startedAt > timeoutMs) {
      throw new Error('Timed out waiting for predicate.');
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

function drainCallbacks(callbacks) {
  while (callbacks.length > 0) {
    callbacks.shift()();
  }
}

function createTempWorld(t) {
  const worldRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'dayloom-tui-driver-'));
  t.after(() => fs.rmSync(worldRoot, { recursive: true, force: true }));
  return worldRoot;
}
