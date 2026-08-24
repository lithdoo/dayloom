const test = require('node:test');
const assert = require('node:assert/strict');

const {
  createFakeSessionFactory,
  createMemorySessionWorkspace,
} = require('../../dist/index.js');
const { createDayloomRuntime } = require('../../dist/runtime/index.js');

function createIds() {
  const counters = new Map();
  const next = (kind) => {
    const value = (counters.get(kind) ?? 0) + 1;
    counters.set(kind, value);
    return `${kind}_${String(value).padStart(4, '0')}`;
  };
  return {
    nextOperationId: () => next('op'),
    nextCommitId: () => next('commit'),
    nextCanonRevisionId: () => next('canon'),
    nextDayRevisionId: () => next('dayrev'),
    nextSessionId: () => next('session'),
    nextMessageId: () => next('message'),
    nextEventId: () => next('event'),
  };
}

function readyArchive(phase = 'idle', overrides = {}) {
  const active = phase === 'planning'
    ? { operationId: 'op_active', kind: 'planning', baseCommitId: 'commit_base' }
    : null;
  return {
    status: 'ready',
    manifest: { schemaVersion: 1, worldId: 'world-test', title: 'World', createdAt: '2026-01-01T00:00:00.000Z' },
    pointer: { schemaVersion: 1, revision: 1, commitId: 'commit_current', updatedAt: '2026-01-01T00:00:00.000Z' },
    commit: {
      schemaVersion: 1,
      id: 'commit_current',
      revision: 1,
      parentCommitId: null,
      operationId: 'op_initial',
      createdAt: '2026-01-01T00:00:00.000Z',
      world: {
        phase,
        day: phase === 'planned' || phase === 'playing' || phase === 'awaiting-settle' ? 'day_0001' : null,
        lastSettledDay: null,
      },
      canonRevision: 'canon_0001',
      dayHeads: {},
      activeSession: active,
    },
    ...overrides,
  };
}

function createArchive(readResults = [{ status: 'uninitialized' }]) {
  let index = 0;
  let recoveryCount = 0;
  return {
    readCurrent: async () => readResults[Math.min(index++, readResults.length - 1)],
    recoverInterruptedSession: async () => { recoveryCount += 1; return {}; },
    beginOperation: async () => { throw new Error('not used'); },
    inspect: async () => { throw new Error('not used'); },
    collectGarbage: async () => { throw new Error('not used'); },
    get recoveryCount() { return recoveryCount; },
  };
}

function createRecoveryFailureArchive() {
  const archive = createArchive([readyArchive('planning')]);
  archive.recoverInterruptedSession = async () => { throw new Error('recovery failed'); };
  return archive;
}

function publishTarget(request) {
  const persisted = request.target.phase === 'initializing'
    ? request.target
    : {
      ...request.target,
      revision: request.previous.revision + 1,
      commitId: `commit_${request.operationId}`,
    };
  return { ...persisted };
}

function createOperations() {
  const failures = new Map();
  let startGate = null;
  const fail = (name) => {
    const error = failures.get(name);
    if (error) throw error;
  };
  return {
    failNext(name, error = Object.assign(new Error(`${name} failed`), { code: 'OPERATION_FAILED' })) {
      failures.set(name, error);
    },
    setStartGate(gate) { startGate = gate; },
    async prepareSessionStart(request) {
      fail('start-prepare');
      return {
        workspace: createMemorySessionWorkspace(),
        publish: async () => {
          if (startGate) await startGate;
          fail('start-publish');
          return publishTarget(request);
        },
        abort: async () => {},
      };
    },
    async submitSession(request) {
      fail('submit');
      return publishTarget(request);
    },
    async cancelSession(request) {
      fail('cancel');
      return publishTarget(request);
    },
    async executeStableCommand(request) {
      fail('stable');
      return publishTarget(request);
    },
  };
}

async function createRuntime(options = {}) {
  return createDayloomRuntime({
    worldRoot: '/virtual/world',
    sessionFactory: createFakeSessionFactory(options.session ?? {}),
    archiveRepository: options.archive ?? createArchive(options.readResults),
    operations: options.operations ?? createOperations(),
    idGenerator: options.ids ?? createIds(),
  });
}

test('async Runtime creation maps uninitialized and invalid archives', async () => {
  let runtime = await createRuntime();
  assert.deepEqual(runtime.getSnapshot().world, {
    phase: 'uninitialized',
    worldRoot: '/virtual/world',
    worldId: null,
    revision: 0,
    commitId: null,
    day: null,
    lastSettledDay: null,
    initialized: false,
    invalid: null,
    invalidReason: null,
  });

  const error = { code: 'ARCHIVE_POINTER_INVALID', message: 'Broken pointer.' };
  runtime = await createRuntime({ readResults: [{ status: 'invalid', error }] });
  assert.equal(runtime.getSnapshot().world.phase, 'invalid');
  assert.deepEqual(runtime.getSnapshot().world.invalid, error);
  assert.equal(runtime.getAvailableCommands().every((command) => !command.enabled), true);
});

test('async Runtime creation recovers an interrupted Session before exposure', async () => {
  const archive = createArchive([readyArchive('planning'), readyArchive('idle')]);
  const runtime = await createRuntime({ archive });
  assert.equal(archive.recoveryCount, 1);
  assert.equal(runtime.getSnapshot().world.phase, 'idle');
  assert.equal(runtime.getSnapshot().session.active, false);
});

test('recovery failure creates a readable invalid Runtime', async () => {
  const runtime = await createRuntime({ archive: createRecoveryFailureArchive() });
  assert.equal(runtime.getSnapshot().world.phase, 'invalid');
  assert.equal(runtime.getSnapshot().world.invalid.code, 'ARCHIVE_SESSION_RECOVERY_FAILED');
  const result = await runtime.executeCommand({ command: 'daily' });
  assert.equal(result.error.code, 'WORLD_INVALID');
});

test('Session start commits world before lifecycle events with one operation id', async () => {
  const runtime = await createRuntime();
  const events = [];
  runtime.subscribe((event) => events.push(event));
  const result = await runtime.executeCommand({ operationId: 'op_start', command: 'init' });

  assert.equal(result.ok, true);
  assert.equal(runtime.getSnapshot().world.phase, 'initializing');
  assert.equal(runtime.getSnapshot().session.kind, 'init');
  assert.deepEqual(
    events.filter((event) => ['world-changed', 'session-created', 'command-succeeded'].includes(event.type))
      .map((event) => [event.type, event.operationId]),
    [['world-changed', 'op_start'], ['session-created', 'op_start'], ['command-succeeded', 'op_start']],
  );
});

test('Session start publication failure discards the candidate and keeps world unchanged', async () => {
  const operations = createOperations();
  operations.failNext('start-publish');
  const runtime = await createRuntime({ operations });
  const result = await runtime.executeCommand({ command: 'init' });
  assert.equal(result.ok, false);
  assert.equal(runtime.getSnapshot().world.phase, 'uninitialized');
  assert.equal(runtime.getSnapshot().session.active, false);
});

test('submit and cancel publication failures preserve the active Session boundary', async () => {
  for (const command of ['submit', 'cancel']) {
    const operations = createOperations();
    const runtime = await createRuntime({ operations });
    await runtime.executeCommand({ command: 'init' });
    operations.failNext(command);
    const result = await runtime.executeCommand({ command });
    assert.equal(result.ok, false, command);
    assert.equal(runtime.getSnapshot().world.phase, 'initializing', command);
    assert.equal(runtime.getSnapshot().session.active, true, command);
  }
});

test('read APIs never observe a Session start before its publication boundary', async () => {
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const operations = createOperations();
  operations.setStartGate(gate);
  const runtime = await createRuntime({ operations });
  const pending = runtime.executeCommand({ command: 'init' });
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(runtime.getSnapshot().world.phase, 'uninitialized');
  assert.equal(runtime.getSnapshot().session.active, false);
  release();
  assert.equal((await pending).ok, true);
});

test('listener reentry and overlapping mutation return RUNTIME_BUSY', async () => {
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const operations = createOperations();
  operations.setStartGate(gate);
  const runtime = await createRuntime({ operations });
  const first = runtime.executeCommand({ command: 'init' });
  await new Promise((resolve) => setImmediate(resolve));
  const overlap = await runtime.executeCommand({ command: 'init' });
  assert.equal(overlap.error.code, 'RUNTIME_BUSY');
  release();
  await first;

  let reentry;
  const second = await createRuntime();
  second.subscribe((event) => {
    if (event.type === 'world-changed') reentry = second.executeCommand({ command: 'cancel' });
  });
  await second.executeCommand({ command: 'init' });
  assert.equal((await reentry).error.code, 'RUNTIME_BUSY');
});

test('stable command failure pairs loading events and keeps committed snapshot', async () => {
  const operations = createOperations();
  operations.failNext('stable');
  const runtime = await createRuntime({ operations, readResults: [readyArchive('awaiting-settle')] });
  const events = [];
  runtime.subscribe((event) => events.push(event));
  const result = await runtime.executeCommand({ operationId: 'op_settle', command: 'settle' });

  assert.equal(result.ok, false);
  assert.equal(runtime.getSnapshot().world.phase, 'awaiting-settle');
  assert.deepEqual(
    events.filter((event) => event.type.startsWith('loading-')).map((event) => [event.type, event.operationId]),
    [['loading-started', 'op_settle'], ['loading-ended', 'op_settle']],
  );
});

test('stable command closes loading before reporting success', async () => {
  const runtime = await createRuntime({ readResults: [readyArchive('awaiting-settle')] });
  const events = [];
  runtime.subscribe((event) => events.push(event));
  const result = await runtime.executeCommand({ operationId: 'op_settle_ok', command: 'settle' });
  assert.equal(result.ok, true);
  assert.deepEqual(
    events.filter((event) => ['world-changed', 'loading-ended', 'command-succeeded'].includes(event.type))
      .map((event) => event.type),
    ['world-changed', 'loading-ended', 'command-succeeded'],
  );
});

test('archive conflict is returned unchanged and does not expose a half state', async () => {
  const operations = createOperations();
  operations.failNext('start-publish', { code: 'ARCHIVE_CONFLICT', message: 'Pointer changed.' });
  const runtime = await createRuntime({ operations });
  const result = await runtime.executeCommand({ command: 'init' });
  assert.equal(result.error.code, 'ARCHIVE_CONFLICT');
  assert.equal(runtime.getSnapshot().world.phase, 'uninitialized');
  assert.equal(runtime.getSnapshot().session.active, false);
});

test('returned snapshots do not permit mutation of Runtime error details', async () => {
  const error = {
    code: 'ARCHIVE_POINTER_INVALID',
    message: 'Broken pointer.',
    details: { nested: { path: 'current.json' } },
  };
  const runtime = await createRuntime({ readResults: [{ status: 'invalid', error }] });
  const snapshot = runtime.getSnapshot();
  snapshot.world.invalid.details.nested.path = 'changed';
  assert.equal(runtime.getSnapshot().world.invalid.details.nested.path, 'current.json');
});

test('dispose is idempotent and closed Runtime rejects mutations', async () => {
  const runtime = await createRuntime();
  await runtime.dispose();
  await runtime.dispose();
  assert.equal(runtime.getSnapshot().session.active, false);
  assert.equal(runtime.getAvailableCommands().every((command) => command.reasonCode === 'RUNTIME_CLOSED'), true);
  const result = await runtime.executeCommand({ command: 'init' });
  assert.equal(result.error.code, 'RUNTIME_CLOSED');
});

test('dispose overlapping a mutation is rejected as RUNTIME_BUSY', async () => {
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const operations = createOperations();
  operations.setStartGate(gate);
  const runtime = await createRuntime({ operations });
  const pending = runtime.executeCommand({ command: 'init' });
  await new Promise((resolve) => setImmediate(resolve));
  await assert.rejects(() => runtime.dispose(), { code: 'RUNTIME_BUSY' });
  release();
  await pending;
});
