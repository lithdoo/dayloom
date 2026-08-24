const test = require('node:test');
const assert = require('node:assert/strict');

const {
  MessageStore,
  SessionManager,
  createFakeSessionFactory,
  createMemorySessionWorkspace,
} = require('../../dist/index.js');
const { createWorld, waitFor } = require('../helpers/baseline.js');

function createPreparation(sessionId, phase = 'planning', day = 'day_0001') {
  return {
    sessionId,
    world: createWorld({ phase, day, initialized: true }),
    workspace: createMemorySessionWorkspace(),
  };
}

async function prepareAndActivate(manager, kind, sessionId = `session_${kind}`) {
  const phase = { init: 'initializing', planning: 'planning', play: 'playing', revise: 'revising' }[kind];
  const prepared = await manager.prepareSession(kind, createPreparation(sessionId, phase));
  manager.activateSession(prepared);
  return prepared.session;
}

test('prepare buffers start events until activate publishes them in order', async () => {
  const events = [];
  const manager = new SessionManager({
    sessionFactory: createFakeSessionFactory(),
    onEvent: (event) => events.push(event),
  });

  const prepared = await manager.prepareSession('planning', createPreparation('session_prepare'));

  assert.equal(manager.getSnapshot().status, 'none');
  assert.equal(prepared.bufferedEvents.length, 2);
  assert.deepEqual(events, []);

  manager.activateSession(prepared);

  assert.equal(manager.getSnapshot().status, 'waiting-input');
  assert.deepEqual(events.map((event) => event.type), [
    'session-created',
    'session-event',
    'session-event',
  ]);
  assert.equal(events[1].event.type, 'status-changed');
  assert.equal(events[2].event.type, 'input-requested');
});

test('discard drops buffered events and disposes the candidate', async () => {
  const events = [];
  let disposed = 0;
  const manager = new SessionManager({
    sessionFactory: ({ kind, context }) => ({
      id: context.sessionId,
      kind,
      getSnapshot: () => ({
        active: true,
        id: context.sessionId,
        kind,
        status: 'created',
        input: null,
        loading: null,
        error: null,
      }),
      start: async () => context.emit({ type: 'status-changed', status: 'loading' }),
      sendInput: async () => {},
      prepareSubmit: async () => ({
        kind: 'init',
        world: { id: 'unused', title: 'Unused' },
        canon: { premise: '', rules: '', style: '', userRole: '' },
      }),
      completeSubmit: async () => {},
      failSubmit: async () => {},
      cancel: async () => {},
      dispose: async () => { disposed += 1; },
    }),
    onEvent: (event) => events.push(event),
  });

  const prepared = await manager.prepareSession('init', createPreparation('session_discard', 'initializing'));
  await manager.discardPreparedSession(prepared);

  assert.equal(disposed, 1);
  assert.deepEqual(events, []);
  assert.equal(manager.getSnapshot().status, 'none');
  assert.throws(() => manager.activateSession(prepared), { code: 'SESSION_FAILED' });
});

test('start failure disposes the candidate without leaking buffered events', async () => {
  const events = [];
  let disposed = false;
  const manager = new SessionManager({
    sessionFactory: ({ kind, context }) => ({
      id: context.sessionId,
      kind,
      getSnapshot: () => ({ active: true, id: context.sessionId, kind, status: 'created', input: null, loading: null, error: null }),
      start: async () => {
        context.emit({ type: 'status-changed', status: 'loading' });
        throw new Error('start failed');
      },
      sendInput: async () => {},
      prepareSubmit: async () => { throw new Error('unused'); },
      completeSubmit: async () => {},
      failSubmit: async () => {},
      cancel: async () => {},
      dispose: async () => { disposed = true; },
    }),
    onEvent: (event) => events.push(event),
  });

  await assert.rejects(
    () => manager.prepareSession('init', createPreparation('session_failed', 'initializing')),
    { code: 'SESSION_FAILED', message: 'start failed' },
  );
  assert.equal(disposed, true);
  assert.deepEqual(events, []);
});

test('manager allows only one active Session', async () => {
  const manager = new SessionManager({ sessionFactory: createFakeSessionFactory() });
  await prepareAndActivate(manager, 'planning');

  await assert.rejects(
    () => manager.prepareSession('planning', createPreparation('session_second')),
    { code: 'SESSION_ALREADY_ACTIVE' },
  );
});

test('sendInput returns before task completion and aggregates streamed deltas', async () => {
  const store = new MessageStore();
  const manager = new SessionManager({
    sessionFactory: createFakeSessionFactory({ deltas: ['hello', ' ', 'world'], delayMs: 10 }),
    onEvent: (event) => {
      if (event.type === 'session-event') store.applySessionEvent(event.sessionId, event.event);
    },
  });
  const session = await prepareAndActivate(manager, 'play');

  manager.sendInput({ operationId: 'op_input', text: 'go' });
  assert.equal(manager.getSnapshot().status, 'streaming');
  assert.throws(() => manager.sendInput({ text: 'overlap' }), { code: 'RUNTIME_BUSY' });

  await waitFor(() => manager.getSnapshot().status === 'waiting-input');
  assert.deepEqual(
    store.getMessages(session.id).map((message) => [message.role, message.text, message.status]),
    [['user', 'go', 'complete'], ['assistant', 'hello world', 'complete']],
  );
});

test('prepareSubmit keeps Session active until completeSubmit', async () => {
  const events = [];
  const manager = new SessionManager({
    sessionFactory: createFakeSessionFactory(),
    onEvent: (event) => events.push(event),
  });
  await prepareAndActivate(manager, 'planning');

  const prepared = await manager.prepareSubmit();
  assert.equal(prepared.result.kind, 'planning');
  assert.equal(manager.getSnapshot().active, true);
  assert.equal(manager.getSnapshot().status, 'submitting');
  assert.equal(events.some((event) => event.type === 'session-ended'), false);

  await manager.completeSubmit(prepared);
  assert.equal(manager.getSnapshot().status, 'none');
  assert.equal(events.some((event) => event.type === 'session-ended' && event.status === 'completed'), true);
});

test('failSubmit preserves active Session and distinguishes retryable errors', async () => {
  const manager = new SessionManager({ sessionFactory: createFakeSessionFactory() });
  await prepareAndActivate(manager, 'planning');

  let prepared = await manager.prepareSubmit();
  await manager.failSubmit(prepared, { code: 'ARCHIVE_CONFLICT', message: 'retry' });
  assert.equal(manager.getSnapshot().active, true);
  assert.equal(manager.getSnapshot().status, 'waiting-input');

  prepared = await manager.prepareSubmit();
  await manager.failSubmit(prepared, { code: 'SUBMISSION_INVALID', message: 'broken' });
  assert.equal(manager.getSnapshot().active, true);
  assert.equal(manager.getSnapshot().status, 'failed');
});

test('invalid submission fails prepareSubmit without clearing active Session', async () => {
  const manager = new SessionManager({
    sessionFactory: createFakeSessionFactory({ submitResult: { kind: 'planning', day: 'bad' } }),
  });
  await prepareAndActivate(manager, 'planning');

  await assert.rejects(() => manager.prepareSubmit(), { code: 'SUBMISSION_INVALID' });
  assert.equal(manager.getSnapshot().active, true);
  assert.equal(manager.getSnapshot().status, 'failed');
});

test('cancel aborts and waits for the active input task before ending Session', async () => {
  const events = [];
  const manager = new SessionManager({
    sessionFactory: createFakeSessionFactory({ deltas: ['a', 'b'], delayMs: 100 }),
    onEvent: (event) => events.push(event),
  });
  const session = await prepareAndActivate(manager, 'play');
  manager.sendInput({ text: 'start' });

  const preparedCancel = await manager.prepareCancel();
  assert.equal(preparedCancel, session);
  assert.equal(manager.getSnapshot().active, true);
  await manager.completeCancel(preparedCancel);

  assert.equal(manager.getSnapshot().status, 'none');
  assert.equal(events.some((event) => event.type === 'session-ended' && event.status === 'cancelled'), true);
});

test('AI failure preserves partial text and leaves Session cancellable', async () => {
  const store = new MessageStore();
  const manager = new SessionManager({
    sessionFactory: createFakeSessionFactory({ deltas: ['partial'], failAtDeltaIndex: 1 }),
    onEvent: (event) => {
      if (event.type === 'session-event') store.applySessionEvent(event.sessionId, event.event);
    },
  });
  const session = await prepareAndActivate(manager, 'planning');
  manager.sendInput({ text: 'go' });
  await waitFor(() => manager.getSnapshot().status === 'failed');

  const assistant = store.getMessages(session.id).find((message) => message.role === 'assistant');
  assert.equal(assistant.text, 'partial');
  assert.equal(assistant.status, 'error');
  await manager.cancel();
  assert.equal(manager.getSnapshot().status, 'none');
});

test('listener failures are logged and do not block other listeners', async () => {
  const received = [];
  const logged = [];
  const manager = new SessionManager({
    sessionFactory: createFakeSessionFactory(),
    logger: {
      debug() {}, info() {}, warn() {},
      error(message) { logged.push(message); },
    },
  });
  manager.subscribe(() => { throw new Error('listener failed'); });
  manager.subscribe((event) => received.push(event.type));

  await prepareAndActivate(manager, 'planning');
  assert.equal(received.includes('session-created'), true);
  assert.equal(logged.length > 0, true);
});

test('dispose is idempotent and closes the manager', async () => {
  const manager = new SessionManager({
    sessionFactory: createFakeSessionFactory({ delayMs: 100 }),
  });
  await prepareAndActivate(manager, 'play');
  manager.sendInput({ text: 'start' });

  await manager.dispose();
  await manager.dispose();
  assert.equal(manager.getSnapshot().status, 'none');
  await assert.rejects(
    () => manager.prepareSession('play', createPreparation('session_closed', 'playing')),
    { code: 'RUNTIME_CLOSED' },
  );
});

test('memory workspace clones checkpoint and transcript values', async () => {
  const workspace = createMemorySessionWorkspace();
  const checkpoint = { step: 1, values: ['a'] };
  await workspace.writeCheckpoint(checkpoint);
  checkpoint.values.push('mutated');
  assert.deepEqual(await workspace.readCheckpoint(), { step: 1, values: ['a'] });

  const entry = { sequence: 1, role: 'user', text: 'hello', messageId: null };
  await workspace.appendTranscript(entry);
  entry.text = 'mutated';
  assert.deepEqual(workspace.getTranscript(), [
    { sequence: 1, role: 'user', text: 'hello', messageId: null },
  ]);
});
