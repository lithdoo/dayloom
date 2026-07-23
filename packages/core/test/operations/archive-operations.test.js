const test = require('node:test');
const assert = require('node:assert/strict');

const {
  FileArchiveRepository,
  FakeSession,
  NodeCoreFileSystem,
} = require('../../dist/index.js');
const { createDayloomRuntime } = require('../../dist/runtime/index.js');
const { createArchiveFixture } = require('../helpers/archive-fixture.js');
const { createFailureFilesystem } = require('../helpers/failure-filesystem.js');

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

function createClock() {
  let tick = 0;
  return {
    now() {
      const date = new Date('2026-07-22T12:00:00.000Z');
      date.setMilliseconds(tick++);
      return date;
    },
  };
}

function createBusinessSessionFactory() {
  return ({ kind, context }) => {
    const day = context.world.day ?? 'day_0001';
    const results = {
      init: {
        kind: 'init',
        world: { id: 'fake-world', title: 'Fake World' },
        canon: { premise: 'Premise', rules: 'Rules', style: 'Style', userRole: 'Role' },
      },
      planning: {
        kind: 'planning',
        day,
        intent: 'Investigate',
        beats: [{ id: 'beat_0001', intent: 'Find evidence' }],
      },
      play: {
        kind: 'play',
        day,
        summary: 'Evidence found',
        beats: [{ id: 'beat_0001', intent: 'Find evidence', status: 'completed', eventId: 'event_0001' }],
        events: [{
          id: 'event_0001',
          beatId: 'beat_0001',
          userInput: 'Search',
          assistantOutput: 'Found evidence',
        }],
        transcript: [
          { sequence: 1, role: 'user', text: 'Search', messageId: null },
          { sequence: 2, role: 'assistant', text: 'Found evidence', messageId: null },
        ],
      },
      revise: {
        kind: 'revise',
        summary: 'Revised style',
        canon: { premise: 'Premise', rules: 'Rules', style: 'Revised', userRole: 'Role' },
      },
    };
    return new FakeSession({ kind, context, submitResult: results[kind] });
  };
}

async function createRealRuntime(root, filesystem = new NodeCoreFileSystem()) {
  const ids = createIds();
  const clock = createClock();
  const archive = new FileArchiveRepository({
    worldRoot: root,
    filesystem,
    ids,
    clock,
  });
  const runtime = await createDayloomRuntime({
    worldRoot: root,
    archiveRepository: archive,
    sessionFactory: createBusinessSessionFactory(),
    idGenerator: ids,
    clock,
  });
  return { runtime, archive };
}

async function execute(runtime, command) {
  const result = await runtime.executeCommand({ command });
  assert.equal(result.ok, true, `${command}: ${result.error?.message ?? ''}`);
  return result;
}

test('real Archive Operations complete the full Runtime business flow', async () => {
  const fixture = createArchiveFixture('runtime-archive-operations');
  try {
    const { runtime, archive } = await createRealRuntime(fixture.root);

    await execute(runtime, 'init');
    assert.equal(runtime.getSnapshot().world.phase, 'initializing');
    assert.deepEqual(await archive.readCurrent(), { status: 'uninitialized' });
    await execute(runtime, 'submit');
    let current = await archive.readCurrent();
    assert.equal(current.status, 'ready');
    assert.equal(current.pointer.revision, 1);
    assert.equal(current.commit.world.phase, 'idle');
    assert.equal(current.manifest.worldId, 'fake-world');

    await execute(runtime, 'daily');
    current = await archive.readCurrent();
    assert.equal(current.commit.world.phase, 'planning');
    assert.equal(current.commit.activeSession.kind, 'planning');
    await execute(runtime, 'submit');
    current = await archive.readCurrent();
    assert.equal(current.commit.world.phase, 'planned');
    assert.equal(current.commit.dayHeads.day_0001.status, 'planned');
    const plannedRevision = await archive.readDayRevision(
      'day_0001',
      current.commit.dayHeads.day_0001.revision,
    );
    assert.equal(plannedRevision.plan.intent, 'Investigate');

    await execute(runtime, 'play');
    await execute(runtime, 'submit');
    current = await archive.readCurrent();
    assert.equal(current.commit.world.phase, 'awaiting-settle');
    assert.equal(current.commit.dayHeads.day_0001.status, 'awaiting-settle');

    await execute(runtime, 'settle');
    current = await archive.readCurrent();
    assert.equal(current.commit.world.phase, 'idle');
    assert.equal(current.commit.world.day, 'day_0002');
    assert.equal(current.commit.world.lastSettledDay, 'day_0001');
    assert.equal(current.commit.dayHeads.day_0001.status, 'settled');

    const canonBefore = current.commit.canonRevision;
    await execute(runtime, 'revise');
    await execute(runtime, 'submit');
    current = await archive.readCurrent();
    assert.notEqual(current.commit.canonRevision, canonBefore);
    assert.equal((await archive.readCanonRevision(current.commit.canonRevision)).documents.style, 'Revised');

    await execute(runtime, 'daily');
    await execute(runtime, 'submit');
    await execute(runtime, 'abandon-day');
    current = await archive.readCurrent();
    assert.equal(current.commit.world.phase, 'idle');
    assert.equal(current.commit.world.day, 'day_0001');
    assert.equal(current.commit.dayHeads.day_0002.status, 'abandoned');

    await execute(runtime, 'daily');
    const beforeCancel = await archive.readCurrent();
    await execute(runtime, 'cancel');
    current = await archive.readCurrent();
    assert.equal(current.commit.world.phase, 'idle');
    assert.equal(current.pointer.revision, beforeCancel.pointer.revision + 1);
    assert.equal(current.commit.activeSession, null);
  } finally {
    fixture.cleanup();
  }
});

test('every Archive Operation failure leaves current at its previous publication boundary', async (t) => {
  const cases = [
    { name: 'initialize', setup: ['init'], command: 'submit', sessionActive: true },
    { name: 'start-session', setup: ['init', 'submit'], command: 'daily', sessionActive: false },
    { name: 'submit-planning', setup: ['init', 'submit', 'daily'], command: 'submit', sessionActive: true },
    { name: 'submit-play', setup: ['init', 'submit', 'daily', 'submit', 'play'], command: 'submit', sessionActive: true },
    { name: 'submit-revise', setup: ['init', 'submit', 'revise'], command: 'submit', sessionActive: true },
    { name: 'cancel-session', setup: ['init', 'submit', 'daily'], command: 'cancel', sessionActive: true },
    { name: 'settle-day', setup: ['init', 'submit', 'daily', 'submit', 'play', 'submit'], command: 'settle', sessionActive: false },
    { name: 'abandon-day', setup: ['init', 'submit', 'daily', 'submit'], command: 'abandon-day', sessionActive: false },
  ];

  for (const scenario of cases) {
    await t.test(scenario.name, async () => {
      const fixture = createArchiveFixture(`operation-failure-${scenario.name}`);
      try {
        const injected = createFailureFilesystem(new NodeCoreFileSystem());
        const { runtime, archive } = await createRealRuntime(fixture.root, injected.filesystem);
        for (const command of scenario.setup) await execute(runtime, command);
        const before = await archive.readCurrent();
        injected.failNext(
          'rename',
          new Error(`${scenario.name} current rename failed`),
          (_source, target) => target.endsWith('/current.json'),
        );

        const result = await runtime.executeCommand({ command: scenario.command });
        assert.equal(result.ok, false);
        const after = await archive.readCurrent();
        if (before.status === 'uninitialized') {
          assert.deepEqual(after, before);
        } else {
          assert.equal(after.status, 'ready');
          assert.deepEqual(after.pointer, before.pointer);
        }
        assert.equal(runtime.getSnapshot().session.active, scenario.sessionActive);
      } finally {
        fixture.cleanup();
      }
    });
  }
});

test('cancelling initialization leaves archive uninitialized', async () => {
  const fixture = createArchiveFixture('runtime-cancel-init');
  try {
    const { runtime, archive } = await createRealRuntime(fixture.root);
    await execute(runtime, 'init');
    await execute(runtime, 'cancel');
    assert.equal(runtime.getSnapshot().world.phase, 'uninitialized');
    assert.deepEqual(await archive.readCurrent(), { status: 'uninitialized' });
  } finally {
    fixture.cleanup();
  }
});
