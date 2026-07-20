const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  Core2Runtime,
  MessageStore,
  SessionManager,
  core2PackageName,
  createCore2NativeSessionFactory,
  createFakeSessionFactory,
  createHandlerSessionFactory,
  getCommandAvailability,
  transitionSessionCancel,
  transitionSessionSubmit,
  transitionWorldCommand,
} = require('../dist/index.js');

test('exports package marker', () => {
  assert.equal(core2PackageName, '@dayloom/core2');
});

test('session manager creates and starts a fake session', async () => {
  const events = [];
  const manager = new SessionManager({
    worldRoot: '/tmp/world',
    day: 'day_0001',
    sessionFactory: createFakeSessionFactory(),
    onEvent: (event) => events.push(event),
  });

  const session = await manager.createSession('planning');
  const snapshot = manager.getSnapshot();

  assert.equal(session.kind, 'planning');
  assert.equal(snapshot.active, true);
  assert.equal(snapshot.kind, 'planning');
  assert.equal(snapshot.status, 'waiting-input');
  assert.deepEqual(snapshot.input, { id: `${session.id}:input`, prompt: null });
  assert.equal(events[0].type, 'session-created');
  assert.equal(events.some((event) => event.type === 'session-event' && event.event.type === 'input-requested'), true);
});

test('sendInput returns before streaming task finishes and message store aggregates assistant deltas', async () => {
  const store = new MessageStore();
  const manager = new SessionManager({
    worldRoot: '/tmp/world',
    sessionFactory: createFakeSessionFactory({
      deltas: ['hello', ' ', 'world'],
      delayMs: 10,
    }),
    onEvent: (event) => {
      if (event.type === 'session-event') {
        store.applySessionEvent(event.sessionId, event.event);
      }
    },
  });

  const session = await manager.createSession('play');
  manager.sendInput({ operationId: 'op-1', text: 'go' });

  assert.equal(manager.getSnapshot().status, 'streaming');

  await waitFor(() => manager.getSnapshot().status === 'ready-to-submit');
  const messages = store.getMessages(session.id);

  assert.deepEqual(
    messages.map((message) => [message.role, message.text, message.status]),
    [
      ['user', 'go', 'complete'],
      ['assistant', 'hello world', 'complete'],
    ],
  );
});

test('submit requires ready-to-submit and clears active session after completion', async () => {
  const manager = new SessionManager({
    worldRoot: '/tmp/world',
    sessionFactory: createFakeSessionFactory({
      deltas: ['done'],
      submitPayload: { ok: true },
    }),
  });

  await manager.createSession('init');
  await assert.rejects(() => manager.submit(), { code: 'COMMAND_NOT_AVAILABLE' });

  await manager.cancel();
  assert.equal(manager.getSnapshot().status, 'none');

  await manager.createSession('init');
  manager.sendInput({ text: 'hello' });
  await waitFor(() => manager.getSnapshot().status === 'ready-to-submit');

  const result = await manager.submit();
  assert.deepEqual(result, { kind: 'init', payload: { ok: true } });
  assert.equal(manager.getSnapshot().active, false);
  assert.equal(manager.getSnapshot().status, 'none');
});

test('cancel aborts a streaming background task and clears active session', async () => {
  const events = [];
  const manager = new SessionManager({
    worldRoot: '/tmp/world',
    sessionFactory: createFakeSessionFactory({
      deltas: ['a', 'b', 'c'],
      delayMs: 50,
    }),
    onEvent: (event) => events.push(event),
  });

  const session = await manager.createSession('play');
  manager.sendInput({ text: 'start' });
  assert.equal(manager.getSnapshot().status, 'streaming');

  await manager.cancel();

  assert.equal(manager.getSnapshot().status, 'none');
  assert.equal(
    events.some(
      (event) =>
        event.type === 'session-ended' &&
        event.sessionId === session.id &&
        event.status === 'cancelled',
    ),
    true,
  );
});

test('AI failure marks the session failed and preserves partial assistant text', async () => {
  const store = new MessageStore();
  const manager = new SessionManager({
    worldRoot: '/tmp/world',
    sessionFactory: createFakeSessionFactory({
      deltas: ['partial'],
      failAtDeltaIndex: 1,
    }),
    onEvent: (event) => {
      if (event.type === 'session-event') {
        store.applySessionEvent(event.sessionId, event.event);
      }
    },
  });

  const session = await manager.createSession('planning');
  manager.sendInput({ text: 'go' });

  await waitFor(() => manager.getSnapshot().status === 'failed');

  assert.equal(manager.getSnapshot().error.code, 'AI_CALL_FAILED');
  assert.throws(() => manager.sendInput({ text: 'again' }), { code: 'INPUT_NOT_EXPECTED' });

  const assistant = store.getMessages(session.id).find((message) => message.role === 'assistant');
  assert.equal(assistant.text, 'partial');
  assert.equal(assistant.status, 'error');

  await manager.cancel();
  assert.equal(manager.getSnapshot().status, 'none');
});

test('message store updates assistant messages by id', () => {
  const store = new MessageStore();
  const sessionId = 'session-1';

  store.applySessionEvent(sessionId, { type: 'assistant-message-start', messageId: 'm1' });
  store.applySessionEvent(sessionId, { type: 'assistant-message-start', messageId: 'm1' });
  store.applySessionEvent(sessionId, { type: 'assistant-message-delta', messageId: 'm1', delta: 'a' });
  store.applySessionEvent(sessionId, { type: 'assistant-message-end', messageId: 'm1' });
  store.applySessionEvent(sessionId, { type: 'assistant-message-end', messageId: 'm1' });

  assert.deepEqual(store.getMessages(sessionId), [
    {
      id: 'm1',
      role: 'assistant',
      text: 'a',
      status: 'complete',
      sessionId,
    },
  ]);
});

test('state machine exposes command availability by phase and session status', () => {
  const world = createWorld({ phase: 'idle', initialized: true });
  const session = { active: false, id: null, kind: null, status: 'none', input: null, loading: null, error: null };
  const commands = getCommandAvailability(world, session);

  assert.equal(commands.find((command) => command.name === 'daily').enabled, true);
  assert.equal(commands.find((command) => command.name === 'revise').enabled, true);
  assert.equal(commands.find((command) => command.name === 'init').enabled, false);
  assert.equal(commands.find((command) => command.name === 'submit').enabled, false);
});

test('state machine transitions world commands', () => {
  const emptySession = { active: false, id: null, kind: null, status: 'none', input: null, loading: null, error: null };

  let result = transitionWorldCommand(createWorld({ phase: 'uninitialized' }), emptySession, 'init');
  assert.equal(result.ok, true);
  assert.equal(result.world.phase, 'initializing');
  assert.equal(result.createSessionKind, 'init');

  result = transitionWorldCommand(createWorld({ phase: 'planned', day: 'day_0002' }), emptySession, 'abandon-day');
  assert.equal(result.ok, true);
  assert.equal(result.world.phase, 'idle');
  assert.equal(result.world.day, 'day_0001');

  result = transitionWorldCommand(createWorld({ phase: 'idle' }), emptySession, 'play');
  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'COMMAND_NOT_AVAILABLE');
});

test('state machine transitions submit and cancel', () => {
  let result = transitionSessionSubmit(createWorld({ phase: 'planning' }), {
    kind: 'planning',
    payload: { plan: true },
  });
  assert.equal(result.ok, true);
  assert.equal(result.world.phase, 'planned');

  result = transitionSessionSubmit(createWorld({ phase: 'playing' }), {
    kind: 'planning',
    payload: {},
  });
  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'SESSION_KIND_MISMATCH');

  result = transitionSessionCancel(createWorld({ phase: 'playing' }));
  assert.equal(result.ok, true);
  assert.equal(result.world.phase, 'planned');
});

test('runtime shell forwards session events and returns operation id for input', async () => {
  const events = [];
  const runtime = new Core2Runtime({
    worldRoot: '/tmp/world',
    sessionFactory: createFakeSessionFactory({
      deltas: ['r', 't'],
      delayMs: 5,
    }),
  });
  runtime.subscribe((event) => events.push(event));

  await runtime.executeCommand({ command: 'init' });
  const result = await runtime.sendInput({ operationId: 'input-1', text: 'hello' });

  assert.deepEqual(result, { operationId: 'input-1', ok: true });
  assert.equal(events.some((event) => event.type === 'input-started' && event.operationId === 'input-1'), true);
  assert.equal(events.some((event) => event.type === 'input-succeeded' && event.operationId === 'input-1'), true);

  await waitFor(() => runtime.getSnapshot().session.status === 'ready-to-submit');
  assert.equal(events.some((event) => event.type === 'assistant-message-delta' && event.delta === 'r'), true);
});

test('runtime listener errors are isolated', async () => {
  const events = [];
  const runtime = new Core2Runtime({
    worldRoot: '/tmp/world',
    sessionFactory: createFakeSessionFactory(),
  });
  runtime.subscribe(() => {
    throw new Error('listener failed');
  });
  runtime.subscribe((event) => events.push(event));

  await runtime.executeCommand({ command: 'init' });

  assert.equal(events.some((event) => event.type === 'session-created'), true);
  assert.equal(runtime.getSnapshot().session.status, 'waiting-input');
});

test('runtime returns RUNTIME_BUSY for overlapping mutations', async () => {
  const runtime = new Core2Runtime({
    worldRoot: '/tmp/world',
    sessionFactory: createSlowStartSessionFactory(),
  });

  const firstStart = runtime.executeCommand({ command: 'init' });
  const busyResult = await runtime.sendInput({ operationId: 'busy-input', text: 'too soon' });
  await firstStart;

  assert.equal(busyResult.operationId, 'busy-input');
  assert.equal(busyResult.ok, false);
  assert.equal(busyResult.error.code, 'RUNTIME_BUSY');
});

test('runtime executeCommand handles submit and cancel session commands', async () => {
  const events = [];
  const runtime = new Core2Runtime({
    worldRoot: '/tmp/world',
    sessionFactory: createFakeSessionFactory({ deltas: ['done'] }),
  });
  runtime.subscribe((event) => events.push(event));

  await runtime.executeCommand({ command: 'init' });
  let result = await runtime.executeCommand({ operationId: 'submit-early', command: 'submit' });
  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'COMMAND_NOT_AVAILABLE');
  assert.equal(
    events.some((event) => event.type === 'command-rejected' && event.operationId === 'submit-early'),
    true,
  );

  result = await runtime.sendInput({ text: 'go' });
  assert.equal(result.ok, true);
  await waitFor(() => runtime.getSnapshot().session.status === 'ready-to-submit');

  result = await runtime.executeCommand({ operationId: 'submit-ok', command: 'submit' });
  assert.equal(result.ok, true);
  assert.equal(runtime.getSnapshot().session.status, 'none');
  assert.equal(
    events.some((event) => event.type === 'command-succeeded' && event.operationId === 'submit-ok'),
    true,
  );
  assert.deepEqual(
    events
      .filter(
        (event) =>
          (event.type === 'world-changed' ||
            event.type === 'session-ended' ||
            event.type === 'command-succeeded') &&
          (event.operationId === 'submit-ok' || event.type === 'session-ended'),
      )
      .slice(-3)
      .map((event) => event.type),
    ['world-changed', 'session-ended', 'command-succeeded'],
  );

  const cancelRuntime = new Core2Runtime({
    worldRoot: '/tmp/world',
    world: { phase: 'planned', initialized: true, day: 'day_0001' },
    sessionFactory: createFakeSessionFactory(),
  });
  await cancelRuntime.executeCommand({ command: 'play' });
  result = await cancelRuntime.executeCommand({ operationId: 'cancel-ok', command: 'cancel' });
  assert.equal(result.ok, true);
  assert.equal(cancelRuntime.getSnapshot().session.status, 'none');
  assert.equal(cancelRuntime.getSnapshot().world.phase, 'planned');
});

test('runtime rejected commands do not emit command-started', async () => {
  const events = [];
  const runtime = new Core2Runtime({
    worldRoot: '/tmp/world',
    sessionFactory: createFakeSessionFactory(),
  });
  runtime.subscribe((event) => events.push(event));

  const result = await runtime.executeCommand({ operationId: 'bad-play', command: 'play' });

  assert.equal(result.ok, false);
  assert.equal(events.some((event) => event.type === 'command-rejected' && event.operationId === 'bad-play'), true);
  assert.equal(events.some((event) => event.type === 'command-started' && event.operationId === 'bad-play'), false);
});

test('runtime executes world commands and emits world-changed events', async () => {
  const events = [];
  const runtime = new Core2Runtime({
    worldRoot: '/tmp/world',
    sessionFactory: createFakeSessionFactory({ deltas: ['done'] }),
  });
  runtime.subscribe((event) => events.push(event));

  let result = await runtime.executeCommand({ operationId: 'init-op', command: 'init' });
  assert.equal(result.ok, true);
  assert.equal(runtime.getSnapshot().world.phase, 'initializing');
  assert.equal(runtime.getSnapshot().session.kind, 'init');
  assert.equal(
    events.some(
      (event) =>
        event.type === 'world-changed' &&
        event.operationId === 'init-op' &&
        event.previous.phase === 'uninitialized' &&
        event.current.phase === 'initializing',
    ),
    true,
  );

  runtime.sendInput({ text: 'init world' });
  await waitFor(() => runtime.getSnapshot().session.status === 'ready-to-submit');
  result = await runtime.executeCommand({ operationId: 'submit-init', command: 'submit' });
  assert.equal(result.ok, true);
  assert.equal(runtime.getSnapshot().world.phase, 'idle');
  assert.equal(runtime.getSnapshot().world.initialized, true);

  result = await runtime.executeCommand({ operationId: 'daily-op', command: 'daily' });
  assert.equal(result.ok, true);
  assert.equal(runtime.getSnapshot().world.phase, 'planning');
  assert.equal(runtime.getSnapshot().session.kind, 'planning');
});

test('runtime rejects invalid world mutations', async () => {
  const runtime = new Core2Runtime({
    worldRoot: '/tmp/world',
    world: { phase: 'invalid', invalidReason: 'bad save' },
    sessionFactory: createFakeSessionFactory(),
  });

  const commands = runtime.getAvailableCommands();
  assert.equal(commands.every((command) => command.enabled === false), true);

  const result = await runtime.executeCommand({ operationId: 'invalid-init', command: 'init' });
  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'WORLD_INVALID');
});

test('handler session connects non-interactive business handlers to runtime', async () => {
  const events = [];
  const store = new MessageStore();
  const runtime = new Core2Runtime({
    worldRoot: '/tmp/world',
    sessionFactory: createHandlerSessionFactory((kind) => ({
      start: async (_context, emit) => {
        emit.system(`started:${kind}`);
      },
      sendInput: async (input, _context, emit, signal) => {
        await emit.stream('handler-assistant', chunks([`echo:${input.text}`]), signal);
      },
      submit: async () => ({ applied: true, kind }),
    })),
  });
  runtime.subscribe((event) => {
    events.push(event);
    if (event.type === 'message-added') {
      store.applySessionEvent(event.message.sessionId, {
        type: 'message-added',
        message: event.message,
      });
    }
    if (
      event.type === 'assistant-message-start' ||
      event.type === 'assistant-message-delta' ||
      event.type === 'assistant-message-end' ||
      event.type === 'assistant-message-error'
    ) {
      store.applySessionEvent(event.sessionId, event);
    }
  });

  let result = await runtime.executeCommand({ command: 'init' });
  assert.equal(result.ok, true);
  result = await runtime.sendInput({ text: 'hello' });
  assert.equal(result.ok, true);
  await waitFor(() => runtime.getSnapshot().session.status === 'ready-to-submit');

  const sessionId = runtime.getSnapshot().session.id;
  assert.equal(
    store.getMessages(sessionId).some((message) => message.text === 'echo:hello' && message.status === 'complete'),
    true,
  );

  result = await runtime.executeCommand({ command: 'submit' });
  assert.equal(result.ok, true);
  assert.equal(runtime.getSnapshot().world.phase, 'idle');
  assert.equal(events.some((event) => event.type === 'session-ended' && event.status === 'completed'), true);
});

test('handler session reports failed business handlers', async () => {
  const runtime = new Core2Runtime({
    worldRoot: '/tmp/world',
    sessionFactory: createHandlerSessionFactory(() => ({
      sendInput: async () => {
        throw new Error('business failed');
      },
      submit: async () => ({}),
    })),
  });

  await runtime.executeCommand({ command: 'init' });
  const result = await runtime.sendInput({ text: 'boom' });

  assert.equal(result.ok, true);
  await waitFor(() => runtime.getSnapshot().session.status === 'failed');
  assert.equal(runtime.getSnapshot().session.error.message, 'business failed');
});

test('core2 native init session writes core2 world files', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dayloom-core2-native-init-'));
  const runtime = new Core2Runtime({
    worldRoot: root,
    sessionFactory: createCore2NativeSessionFactory({ worldRoot: root }),
  });

  let result = await runtime.executeCommand({ command: 'init' });
  assert.equal(result.ok, true);
  result = await runtime.sendInput({
    text: JSON.stringify({
      id: 'native_world',
      title: 'Native World',
      premise: 'A fresh core2 world.',
    }),
  });
  assert.equal(result.ok, true);
  await waitFor(() => runtime.getSnapshot().session.status === 'ready-to-submit');
  result = await runtime.executeCommand({ command: 'submit' });

  assert.equal(result.ok, true);
  assert.equal(runtime.getSnapshot().world.phase, 'idle');
  assert.equal(JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8')).id, 'native_world');
  assert.equal(JSON.parse(fs.readFileSync(path.join(root, 'current.json'), 'utf8')).phase, 'idle');
  assert.equal(fs.readFileSync(path.join(root, 'canon', 'premise.md'), 'utf8'), 'A fresh core2 world.');
  fs.rmSync(root, { recursive: true, force: true });
});

test('core2 native planning session writes core2 plan files', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dayloom-core2-native-plan-'));
  const runtime = new Core2Runtime({
    worldRoot: root,
    world: { phase: 'idle', initialized: true, day: 'day_0001' },
    sessionFactory: createCore2NativeSessionFactory({ worldRoot: root }),
  });

  let result = await runtime.executeCommand({ command: 'daily' });
  assert.equal(result.ok, true);
  result = await runtime.sendInput({
    text: JSON.stringify({
      day: 'day_0001',
      intent: 'Visit the market.',
      beats: [{ id: 'beat_01', intent: 'Reach the market.' }],
    }),
  });
  assert.equal(result.ok, true);
  await waitFor(() => runtime.getSnapshot().session.status === 'ready-to-submit');
  result = await runtime.executeCommand({ command: 'submit' });

  assert.equal(result.ok, true);
  assert.equal(runtime.getSnapshot().world.phase, 'planned');
  assert.equal(runtime.getSnapshot().world.day, 'day_0001');
  assert.equal(
    JSON.parse(fs.readFileSync(path.join(root, 'days', 'day_0001', 'plan.initial.json'), 'utf8')).intent,
    'Visit the market.',
  );
  assert.equal(JSON.parse(fs.readFileSync(path.join(root, 'current.json'), 'utf8')).phase, 'planned');
  fs.rmSync(root, { recursive: true, force: true });
});

test('core2 native settle operation advances to next idle day', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dayloom-core2-native-settle-'));
  fs.mkdirSync(path.join(root, 'days', 'day_0001'), { recursive: true });
  const runtime = new Core2Runtime({
    worldRoot: root,
    world: { phase: 'awaiting-settle', initialized: true, day: 'day_0001' },
    sessionFactory: createCore2NativeSessionFactory({ worldRoot: root }),
  });

  const result = await runtime.executeCommand({ operationId: 'settle-day', command: 'settle' });

  assert.equal(result.ok, true);
  assert.equal(runtime.getSnapshot().world.phase, 'idle');
  assert.equal(runtime.getSnapshot().world.day, 'day_0002');
  assert.equal(JSON.parse(fs.readFileSync(path.join(root, 'days', 'day_0001', 'meta.json'), 'utf8')).phase, 'settled');
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(root, 'current.json'), 'utf8')), {
    day: 'day_0002',
    phase: 'idle',
    lastCommittedDay: 'day_0001',
  });
  assert.match(fs.readFileSync(path.join(root, 'logs', 'state-changes.jsonl'), 'utf8'), /day_settled/);
  fs.rmSync(root, { recursive: true, force: true });
});

test('core2 native abandon-day operation marks day abandoned', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dayloom-core2-native-abandon-'));
  fs.mkdirSync(path.join(root, 'days', 'day_0002'), { recursive: true });
  const runtime = new Core2Runtime({
    worldRoot: root,
    world: { phase: 'planned', initialized: true, day: 'day_0002' },
    sessionFactory: createCore2NativeSessionFactory({ worldRoot: root }),
  });

  const result = await runtime.executeCommand({ operationId: 'abandon-day', command: 'abandon-day' });

  assert.equal(result.ok, true);
  assert.equal(runtime.getSnapshot().world.phase, 'idle');
  assert.equal(runtime.getSnapshot().world.day, 'day_0001');
  assert.equal(JSON.parse(fs.readFileSync(path.join(root, 'days', 'day_0002', 'abandoned.json'), 'utf8')).day, 'day_0002');
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(root, 'current.json'), 'utf8')), {
    day: 'day_0001',
    phase: 'idle',
    lastCommittedDay: 'day_0001',
  });
  assert.match(fs.readFileSync(path.join(root, 'logs', 'state-changes.jsonl'), 'utf8'), /day_abandoned/);
  fs.rmSync(root, { recursive: true, force: true });
});

test('core2 runtime reads existing current snapshot from world store', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dayloom-core2-read-snapshot-'));
  fs.writeFileSync(path.join(root, 'manifest.json'), JSON.stringify({ version: 1, id: 'w', title: 'W' }));
  fs.writeFileSync(
    path.join(root, 'current.json'),
    JSON.stringify({ day: 'day_0002', phase: 'planned', lastCommittedDay: 'day_0001' }),
  );

  const runtime = new Core2Runtime({
    worldRoot: root,
    sessionFactory: createFakeSessionFactory(),
  });

  assert.equal(runtime.getSnapshot().world.phase, 'planned');
  assert.equal(runtime.getSnapshot().world.day, 'day_0002');
  assert.equal(runtime.getSnapshot().world.initialized, true);
  fs.rmSync(root, { recursive: true, force: true });
});

test('core2 native revise session writes safe document updates', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dayloom-core2-native-revise-'));
  const runtime = new Core2Runtime({
    worldRoot: root,
    world: { phase: 'idle', initialized: true },
    sessionFactory: createCore2NativeSessionFactory({ worldRoot: root }),
  });

  let result = await runtime.executeCommand({ command: 'revise' });
  assert.equal(result.ok, true);
  result = await runtime.sendInput({
    text: JSON.stringify({
      summary: 'Update style',
      documents: [{ path: 'canon/style.md', content: 'Plain prose.' }],
    }),
  });
  assert.equal(result.ok, true);
  await waitFor(() => runtime.getSnapshot().session.status === 'ready-to-submit');
  result = await runtime.executeCommand({ command: 'submit' });

  assert.equal(result.ok, true);
  assert.equal(runtime.getSnapshot().world.phase, 'idle');
  assert.equal(fs.readFileSync(path.join(root, 'canon', 'style.md'), 'utf8'), 'Plain prose.');
  fs.rmSync(root, { recursive: true, force: true });
});

test('runtime dispose aborts active session task', async () => {
  const runtime = new Core2Runtime({
    worldRoot: '/tmp/world',
    world: { phase: 'planned', initialized: true, day: 'day_0001' },
    sessionFactory: createFakeSessionFactory({
      deltas: ['a', 'b'],
      delayMs: 50,
    }),
  });

  await runtime.executeCommand({ command: 'play' });
  const result = await runtime.sendInput({ text: 'go' });
  assert.equal(result.ok, true);
  assert.equal(runtime.getSnapshot().session.status, 'streaming');

  await runtime.dispose();

  assert.equal(runtime.getSnapshot().session.status, 'none');
  const afterDispose = await runtime.sendInput({ operationId: 'closed-input', text: 'again' });
  assert.equal(afterDispose.ok, false);
  assert.equal(afterDispose.error.code, 'RUNTIME_CLOSED');
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

function createWorld(overrides = {}) {
  return {
    phase: 'uninitialized',
    worldRoot: '/tmp/world',
    day: null,
    initialized: false,
    invalidReason: null,
    ...overrides,
  };
}

async function* chunks(values) {
  for (const value of values) {
    yield value;
  }
}

function createSlowStartSessionFactory() {
  return ({ kind, context }) => ({
    id: 'slow-start-session',
    kind,
    getSnapshot: () => ({
      active: true,
      id: 'slow-start-session',
      kind,
      status: 'waiting-input',
      input: { id: 'slow-start-session:input', prompt: null },
      loading: null,
      error: null,
    }),
    start: async () => {
      await new Promise((resolve) => setTimeout(resolve, 30));
      context.emit({ type: 'input-requested', request: { id: 'slow-start-session:input', prompt: null } });
    },
    sendInput: async () => {},
    submit: async () => ({ kind, payload: {} }),
    cancel: async () => {},
    dispose: async () => {},
  });
}
