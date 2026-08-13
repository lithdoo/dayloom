const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  FileArchiveRepository,
  NodeCoreFileSystem,
} = require('../../dist/index.js');
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
      date.setMilliseconds(date.getMilliseconds() + tick++);
      return date;
    },
  };
}

function createRepository(root, options = {}) {
  return new FileArchiveRepository({
    worldRoot: root,
    filesystem: options.filesystem ?? new NodeCoreFileSystem(),
    ids: options.ids ?? createIds(),
    clock: options.clock ?? createClock(),
    logger: options.logger,
    lockStaleAfterMs: options.lockStaleAfterMs ?? 100,
  });
}

async function initialize(repository) {
  const transaction = await repository.beginOperation('init');
  await transaction.stageManifest({ worldId: 'world-test', title: 'Test World' });
  const canonRevision = await transaction.stageCanon({
    parentRevision: null,
    documents: {
      premise: 'A test world.',
      rules: 'Stay coherent.',
      style: 'Plain.',
      userRole: 'Observer.',
    },
  });
  await transaction.stageCommit({
    world: { phase: 'idle', day: null, lastSettledDay: null },
    canonRevision,
    dayHeads: {},
    activeSession: null,
  });
  return transaction.publish();
}

function plannedDay(day = 'day_0001') {
  return {
    day,
    parentRevision: null,
    status: 'planned',
    plan: {
      day,
      intent: 'Investigate.',
      beats: [{
        id: 'beat_0001',
        intent: 'Find the source.',
        status: 'pending',
        eventId: null,
      }],
    },
  };
}

test('missing current is uninitialized and ignores unpublished files', async () => {
  const fixture = createArchiveFixture('archive-uninitialized');
  try {
    fixture.writeJson('manifest.json', { stale: true });
    fixture.writeJson('operations/op_0001/workspace/commits/commit_0001.json', { stale: true });
    const repository = createRepository(fixture.root);
    assert.deepEqual(await repository.readCurrent(), { status: 'uninitialized' });
  } finally {
    fixture.cleanup();
  }
});

test('initialization publishes manifest, immutable canon, commit, and current pointer', async () => {
  const fixture = createArchiveFixture('archive-init');
  try {
    const repository = createRepository(fixture.root);
    const published = await initialize(repository);
    const current = await repository.readCurrent();

    assert.equal(current.status, 'ready');
    assert.equal(current.manifest.worldId, 'world-test');
    assert.equal(current.pointer.revision, 1);
    assert.equal(current.pointer.commitId, published.commit.id);
    assert.equal(current.commit.world.phase, 'idle');
    assert.equal(fs.existsSync(path.join(fixture.root, 'canon', current.commit.canonRevision, 'premise.md')), true);
    assert.equal(fixture.readJson(`operations/${published.operation.id}/operation.json`).status, 'published');
  } finally {
    fixture.cleanup();
  }
});

test('day revisions are immutable references validated from current', async () => {
  const fixture = createArchiveFixture('archive-day');
  try {
    const repository = createRepository(fixture.root);
    const initial = await initialize(repository);
    const transaction = await repository.beginOperation('submit-session');
    const dayRevision = await transaction.stageDay(plannedDay());
    await transaction.stageCommit({
      world: { phase: 'planned', day: 'day_0001', lastSettledDay: null },
      canonRevision: initial.commit.canonRevision,
      dayHeads: { day_0001: { revision: dayRevision, status: 'planned' } },
      activeSession: null,
    });
    await transaction.publish();

    const current = await repository.readCurrent();
    assert.equal(current.status, 'ready');
    assert.equal(current.commit.world.phase, 'planned');
    assert.equal(current.commit.dayHeads.day_0001.revision, dayRevision);
    const inspection = await repository.inspect();
    assert.deepEqual(inspection.orphanDayRevisions, []);
  } finally {
    fixture.cleanup();
  }
});

test('stale concurrent transaction cannot overwrite a newer pointer', async () => {
  const fixture = createArchiveFixture('archive-conflict');
  try {
    const repository = createRepository(fixture.root);
    const initial = await initialize(repository);
    const first = await repository.beginOperation('settle-day');
    const second = await repository.beginOperation('settle-day');
    for (const transaction of [first, second]) {
      await transaction.stageCommit({
        world: initial.commit.world,
        canonRevision: initial.commit.canonRevision,
        dayHeads: initial.commit.dayHeads,
        activeSession: null,
      });
    }
    await first.publish();
    await assert.rejects(() => second.publish(), { code: 'ARCHIVE_CONFLICT' });
    const current = await repository.readCurrent();
    assert.equal(current.status, 'ready');
    assert.equal(current.pointer.revision, 2);
  } finally {
    fixture.cleanup();
  }
});

test('live publish lock conflicts while stale dead owner can be reclaimed', async () => {
  const fixture = createArchiveFixture('archive-lock');
  try {
    const repository = createRepository(fixture.root, { lockStaleAfterMs: 1 });
    const transaction = await repository.beginOperation('init');
    await transaction.stageManifest({ worldId: 'world-lock', title: 'Lock' });
    const canon = await transaction.stageCanon({
      parentRevision: null,
      documents: { premise: '', rules: '', style: '', userRole: '' },
    });
    await transaction.stageCommit({
      world: { phase: 'idle', day: null, lastSettledDay: null },
      canonRevision: canon,
      dayHeads: {},
      activeSession: null,
    });
    fixture.writeJson('.locks/publish.lock', {
      ownerToken: 'live', pid: process.pid, createdAt: '2000-01-01T00:00:00.000Z',
    });
    await assert.rejects(() => transaction.publish(), { code: 'ARCHIVE_CONFLICT' });

    fs.rmSync(path.join(fixture.root, '.locks', 'publish.lock'));
    const retry = await repository.beginOperation('init');
    await retry.stageManifest({ worldId: 'world-lock', title: 'Lock' });
    const retryCanon = await retry.stageCanon({
      parentRevision: null,
      documents: { premise: '', rules: '', style: '', userRole: '' },
    });
    await retry.stageCommit({
      world: { phase: 'idle', day: null, lastSettledDay: null },
      canonRevision: retryCanon,
      dayHeads: {},
      activeSession: null,
    });
    fixture.writeJson('.locks/publish.lock', {
      ownerToken: 'dead', pid: 2147483647, createdAt: '2000-01-01T00:00:00.000Z',
    });
    const published = await retry.publish();
    assert.equal(published.pointer.revision, 1);
  } finally {
    fixture.cleanup();
  }
});

test('malformed publish lock is never reclaimed automatically', async () => {
  const fixture = createArchiveFixture('archive-malformed-lock');
  try {
    const repository = createRepository(fixture.root, { lockStaleAfterMs: 1 });
    const transaction = await repository.beginOperation('init');
    await transaction.stageManifest({ worldId: 'world-lock-invalid', title: 'Lock' });
    const canon = await transaction.stageCanon({
      parentRevision: null,
      documents: { premise: '', rules: '', style: '', userRole: '' },
    });
    await transaction.stageCommit({
      world: { phase: 'idle', day: null, lastSettledDay: null },
      canonRevision: canon,
      dayHeads: {},
      activeSession: null,
    });
    fs.mkdirSync(path.join(fixture.root, '.locks'), { recursive: true });
    fs.writeFileSync(path.join(fixture.root, '.locks', 'publish.lock'), '{broken', 'utf8');

    await assert.rejects(() => transaction.publish(), { code: 'ARCHIVE_CONFLICT' });
    assert.equal(fs.existsSync(path.join(fixture.root, '.locks', 'publish.lock')), true);
    assert.equal(fixture.readJson(`operations/${transaction.operationId}/operation.json`).status, 'failed');
  } finally {
    fixture.cleanup();
  }
});

for (const failure of [
  {
    name: 'commit promotion',
    method: 'rename',
    predicate: (_source, target) => target.includes(`${path.sep}commits${path.sep}`),
  },
  {
    name: 'current temporary write',
    method: 'writeText',
    predicate: (target) => target.includes('current.json.tmp-'),
  },
  {
    name: 'current rename',
    method: 'rename',
    predicate: (_source, target) => target.endsWith(`${path.sep}current.json`),
  },
]) {
  test(`${failure.name} failure leaves current unpublished`, async () => {
    const fixture = createArchiveFixture(`archive-failure-${failure.method}`);
    try {
      const injected = createFailureFilesystem(new NodeCoreFileSystem());
      const repository = createRepository(fixture.root, { filesystem: injected.filesystem });
      const transaction = await repository.beginOperation('init');
      await transaction.stageManifest({ worldId: 'world-failure', title: 'Failure' });
      const canon = await transaction.stageCanon({
        parentRevision: null,
        documents: { premise: '', rules: '', style: '', userRole: '' },
      });
      await transaction.stageCommit({
        world: { phase: 'idle', day: null, lastSettledDay: null },
        canonRevision: canon,
        dayHeads: {},
        activeSession: null,
      });
      injected.failNext(failure.method, new Error(`Injected ${failure.name}.`), failure.predicate);
      await assert.rejects(() => transaction.publish(), { code: 'OPERATION_FAILED' });
      assert.deepEqual(await repository.readCurrent(), { status: 'uninitialized' });
    } finally {
      fixture.cleanup();
    }
  });
}

test('operation status failure after current rename does not undo publication', async () => {
  const fixture = createArchiveFixture('archive-post-publish');
  const logs = [];
  try {
    const injected = createFailureFilesystem(new NodeCoreFileSystem());
    const repository = createRepository(fixture.root, {
      filesystem: injected.filesystem,
      logger: { debug() {}, info() {}, warn() {}, error(message) { logs.push(message); } },
    });
    const transaction = await repository.beginOperation('init');
    await transaction.stageManifest({ worldId: 'world-post', title: 'Post' });
    const canon = await transaction.stageCanon({
      parentRevision: null,
      documents: { premise: '', rules: '', style: '', userRole: '' },
    });
    await transaction.stageCommit({
      world: { phase: 'idle', day: null, lastSettledDay: null },
      canonRevision: canon,
      dayHeads: {},
      activeSession: null,
    });
    injected.failNext(
      'writeText',
      new Error('operation status failed'),
      (target, content) => target.endsWith('operation.json') && content.includes('"status": "published"'),
    );
    const published = await transaction.publish();
    assert.equal(published.pointer.revision, 1);
    assert.equal((await repository.readCurrent()).status, 'ready');
    assert.equal(fixture.readJson(`operations/${published.operation.id}/operation.json`).status, 'published');
    assert.equal(logs.some((message) => message.includes('status update')), true);
  } finally {
    fixture.cleanup();
  }
});

test('lock release failure does not undo a successful publication', async () => {
  const fixture = createArchiveFixture('archive-lock-release-failure');
  const logs = [];
  try {
    const injected = createFailureFilesystem(new NodeCoreFileSystem());
    const repository = createRepository(fixture.root, {
      filesystem: injected.filesystem,
      logger: { debug() {}, info() {}, warn() {}, error(message) { logs.push(message); } },
    });
    const transaction = await repository.beginOperation('init');
    await transaction.stageManifest({ worldId: 'world-release', title: 'Release' });
    const canon = await transaction.stageCanon({
      parentRevision: null,
      documents: { premise: '', rules: '', style: '', userRole: '' },
    });
    await transaction.stageCommit({
      world: { phase: 'idle', day: null, lastSettledDay: null },
      canonRevision: canon,
      dayHeads: {},
      activeSession: null,
    });
    injected.failNext(
      'remove',
      new Error('lock release failed'),
      (target) => target.endsWith(`${path.sep}.locks${path.sep}publish.lock`),
    );

    const published = await transaction.publish();
    assert.equal(published.pointer.revision, 1);
    assert.equal((await repository.readCurrent()).status, 'ready');
    assert.equal(logs.some((message) => message.includes('lock release')), true);
  } finally {
    fixture.cleanup();
  }
});

test('workspace write failure never creates current', async () => {
  const fixture = createArchiveFixture('archive-workspace-failure');
  try {
    const injected = createFailureFilesystem(new NodeCoreFileSystem());
    const repository = createRepository(fixture.root, { filesystem: injected.filesystem });
    const transaction = await repository.beginOperation('init');
    injected.failNext('writeText', new Error('workspace failed'), (target) => target.endsWith('premise.md'));
    await assert.rejects(() => transaction.stageCanon({
      parentRevision: null,
      documents: { premise: '', rules: '', style: '', userRole: '' },
    }));
    assert.deepEqual(await repository.readCurrent(), { status: 'uninitialized' });
  } finally {
    fixture.cleanup();
  }
});

test('canon and day staging failures never change the published pointer', async () => {
  const fixture = createArchiveFixture('archive-staging-failures');
  try {
    const injected = createFailureFilesystem(new NodeCoreFileSystem());
    const repository = createRepository(fixture.root, { filesystem: injected.filesystem });
    const initial = await initialize(repository);

    const canonTransaction = await repository.beginOperation('submit-session');
    injected.failNext('writeText', new Error('canon staging failed'), (target) => target.endsWith('style.md'));
    await assert.rejects(() => canonTransaction.stageCanon({
      parentRevision: initial.commit.canonRevision,
      documents: { premise: '', rules: '', style: '', userRole: '' },
    }));

    const dayTransaction = await repository.beginOperation('submit-session');
    injected.failNext('writeText', new Error('day staging failed'), (target) => target.endsWith('plan.json'));
    await assert.rejects(() => dayTransaction.stageDay(plannedDay()));

    const current = await repository.readCurrent();
    assert.equal(current.status, 'ready');
    assert.deepEqual(current.pointer, initial.pointer);
  } finally {
    fixture.cleanup();
  }
});

test('commit staging failure never changes the published pointer', async () => {
  const fixture = createArchiveFixture('archive-commit-stage-failure');
  try {
    const injected = createFailureFilesystem(new NodeCoreFileSystem());
    const repository = createRepository(fixture.root, { filesystem: injected.filesystem });
    const initial = await initialize(repository);
    const transaction = await repository.beginOperation('settle-day');
    injected.failNext(
      'writeText',
      new Error('commit staging failed'),
      (target) => target.includes(`${path.sep}workspace${path.sep}commits${path.sep}`),
    );
    await assert.rejects(() => transaction.stageCommit({
      world: initial.commit.world,
      canonRevision: initial.commit.canonRevision,
      dayHeads: initial.commit.dayHeads,
      activeSession: null,
    }));
    assert.deepEqual((await repository.readCurrent()).pointer, initial.pointer);
  } finally {
    fixture.cleanup();
  }
});

test('day draft rejects inconsistent document and event references', async () => {
  const fixture = createArchiveFixture('archive-day-cross-reference');
  try {
    const repository = createRepository(fixture.root);
    await initialize(repository);
    const transaction = await repository.beginOperation('submit-session');
    await assert.rejects(() => transaction.stageDay({
      ...plannedDay(),
      status: 'awaiting-settle',
      play: { day: 'day_0001', summary: 'Done.', eventIds: ['event_0001'] },
      events: [],
      transcript: [],
    }), { code: 'SUBMISSION_INVALID' });
    assert.equal((await repository.readCurrent()).pointer.revision, 1);
  } finally {
    fixture.cleanup();
  }
});

test('reader reports structured pointer, commit, and reference corruption', async () => {
  const fixture = createArchiveFixture('archive-corruption');
  try {
    let repository = createRepository(fixture.root);
    const initialized = await initialize(repository);
    fs.writeFileSync(path.join(fixture.root, 'current.json'), '{bad json', 'utf8');
    let current = await repository.readCurrent();
    assert.equal(current.status, 'invalid');
    assert.equal(current.error.code, 'ARCHIVE_POINTER_INVALID');

    fixture.writeJson('current.json', initialized.pointer);
    fs.rmSync(path.join(fixture.root, 'commits', `${initialized.commit.id}.json`));
    current = await repository.readCurrent();
    assert.equal(current.error.code, 'ARCHIVE_COMMIT_MISSING');
    assert.equal(current.error.details.commitId, initialized.commit.id);
    assert.equal(current.error.details.path, `commits/${initialized.commit.id}.json`);
    assert.equal(path.isAbsolute(current.error.details.path), false);

    fixture.writeJson(`commits/${initialized.commit.id}.json`, initialized.commit);
    fs.rmSync(path.join(fixture.root, 'canon', initialized.commit.canonRevision, 'premise.md'));
    current = await repository.readCurrent();
    assert.equal(current.error.code, 'ARCHIVE_REFERENCE_MISSING');
    assert.equal(path.isAbsolute(current.error.details.path), false);
    assert.equal(current.error.details.revision, initialized.commit.canonRevision);
  } finally {
    fixture.cleanup();
  }
});

test('operation audit log failure does not undo an archive publication', async () => {
  const fixture = createArchiveFixture('archive-log-failure');
  const logs = [];
  try {
    const injected = createFailureFilesystem(new NodeCoreFileSystem());
    const repository = createRepository(fixture.root, {
      filesystem: injected.filesystem,
      logger: { debug() {}, info() {}, warn() {}, error(message) { logs.push(message); } },
    });
    const transaction = await repository.beginOperation('init');
    await transaction.stageManifest({ worldId: 'world-log', title: 'Log' });
    const canon = await transaction.stageCanon({
      parentRevision: null,
      documents: { premise: '', rules: '', style: '', userRole: '' },
    });
    await transaction.stageCommit({
      world: { phase: 'idle', day: null, lastSettledDay: null },
      canonRevision: canon,
      dayHeads: {},
      activeSession: null,
    });
    injected.failNext('writeText', new Error('audit unavailable'), (target) => target.endsWith('operations.jsonl'));

    const published = await transaction.publish();
    const current = await repository.readCurrent();
    assert.equal(current.status, 'ready');
    assert.equal(current.pointer.commitId, published.commit.id);
    assert.equal(logs.some((message) => message.includes('operation log')), true);
  } finally {
    fixture.cleanup();
  }
});

test('reader rejects cross-file day and active Session base inconsistencies', async () => {
  const fixture = createArchiveFixture('archive-cross-reference-corruption');
  try {
    const repository = createRepository(fixture.root);
    const initial = await initialize(repository);
    const planning = await repository.beginOperation('start-session');
    await planning.stageCommit({
      world: { ...initial.commit.world, phase: 'planning' },
      canonRevision: initial.commit.canonRevision,
      dayHeads: {},
      activeSession: { kind: 'planning', baseCommitId: initial.commit.id },
    });
    await planning.publish();

    const basePath = `commits/${initial.commit.id}.json`;
    fixture.writeJson(basePath, {
      ...initial.commit,
      world: { phase: 'planned', day: null, lastSettledDay: null },
    });
    let current = await repository.readCurrent();
    assert.equal(current.status, 'invalid');
    assert.equal(current.error.code, 'ARCHIVE_REFERENCE_INVALID');

    fixture.writeJson(basePath, initial.commit);
    current = await repository.readCurrent();
    assert.equal(current.status, 'ready');
  } finally {
    fixture.cleanup();
  }
});

test('reader rejects a day document whose identity differs from its revision', async () => {
  const fixture = createArchiveFixture('archive-day-identity-corruption');
  try {
    const repository = createRepository(fixture.root);
    const initial = await initialize(repository);
    const transaction = await repository.beginOperation('submit-session');
    const dayRevision = await transaction.stageDay(plannedDay());
    await transaction.stageCommit({
      world: { phase: 'planned', day: 'day_0001', lastSettledDay: null },
      canonRevision: initial.commit.canonRevision,
      dayHeads: { day_0001: { revision: dayRevision, status: 'planned' } },
      activeSession: null,
    });
    await transaction.publish();
    const planPath = `days/day_0001/revisions/${dayRevision}/plan.json`;
    fixture.writeJson(planPath, { ...fixture.readJson(planPath), day: 'day_0002' });

    const current = await repository.readCurrent();
    assert.equal(current.status, 'invalid');
    assert.equal(current.error.code, 'ARCHIVE_REFERENCE_INVALID');
  } finally {
    fixture.cleanup();
  }
});

test('inspection reports orphan objects and garbage collection is dry-run by default', async () => {
  const fixture = createArchiveFixture('archive-orphan');
  try {
    const repository = createRepository(fixture.root);
    await initialize(repository);
    fixture.writeJson('commits/commit_orphan.json', { orphan: true });
    fixture.writeJson('canon/canon_orphan/manifest.json', { orphan: true });
    const inspection = await repository.inspect();
    assert.equal(inspection.orphanCommits.includes('commit_orphan'), true);
    assert.equal(inspection.orphanCanonRevisions.includes('canon_orphan'), true);

    const result = await repository.collectGarbage();
    assert.equal(result.deleted.length, 0);
    assert.equal(fs.existsSync(path.join(fixture.root, 'commits', 'commit_orphan.json')), true);
  } finally {
    fixture.cleanup();
  }
});

test('garbage collection removes only orphan objects, stale terminal workspaces, and current temp files', async () => {
  const fixture = createArchiveFixture('archive-gc-complete');
  try {
    const repository = createRepository(fixture.root);
    const initialized = await initialize(repository);
    const active = await repository.beginOperation('start-session');
    fixture.writeJson('commits/commit_orphan.json', { orphan: true });
    fixture.writeJson('canon/canon_orphan/manifest.json', { orphan: true });
    fixture.writeJson('days/day_9999/revisions/dayrev_orphan/meta.json', { orphan: true });
    fixture.writeJson('current.json.tmp-op_stale', { stale: true });

    const before = await repository.readCurrent();
    await new Promise((resolve) => setTimeout(resolve, 2));
    const dryRun = await repository.collectGarbage({ operationRetentionMs: 0 });
    assert.equal(dryRun.deleted.length, 0);
    assert.equal(dryRun.candidates.includes('commits/commit_orphan.json'), true);
    assert.equal(dryRun.candidates.includes('canon/canon_orphan'), true);
    assert.equal(dryRun.candidates.includes('days/day_9999/revisions/dayrev_orphan'), true);
    assert.equal(dryRun.candidates.includes(`operations/${initialized.operation.id}/workspace`), true);
    assert.equal(dryRun.candidates.includes('current.json.tmp-op_stale'), true);
    assert.equal(dryRun.candidates.includes(`operations/${active.operationId}/workspace`), false);

    const result = await repository.collectGarbage({ delete: true, operationRetentionMs: 0 });
    assert.deepEqual(await repository.readCurrent(), before);
    assert.equal(result.deleted.length, dryRun.candidates.length);
    assert.equal(fs.existsSync(path.join(fixture.root, 'commits', initialized.commit.id + '.json')), true);
    assert.equal(fs.existsSync(path.join(fixture.root, 'canon', initialized.commit.canonRevision)), true);
    assert.equal(fs.existsSync(path.join(fixture.root, 'operations', initialized.operation.id, 'operation.json')), true);
    assert.equal(fs.existsSync(path.join(fixture.root, 'operations', active.operationId, 'workspace')), true);
    assert.equal(fs.existsSync(path.join(fixture.root, 'current.json.tmp-op_stale')), false);
    await active.abort();
  } finally {
    fixture.cleanup();
  }
});

test('garbage collection deletion respects the live publish lock', async () => {
  const fixture = createArchiveFixture('archive-gc-lock');
  try {
    const repository = createRepository(fixture.root);
    await initialize(repository);
    fixture.writeJson('commits/commit_orphan.json', { orphan: true });
    fixture.writeJson('.locks/publish.lock', {
      ownerToken: 'live-owner',
      pid: process.pid,
      createdAt: new Date().toISOString(),
    });
    await assert.rejects(
      repository.collectGarbage({ delete: true, operationRetentionMs: 0 }),
      { code: 'ARCHIVE_CONFLICT' },
    );
    assert.equal(fs.existsSync(path.join(fixture.root, 'commits', 'commit_orphan.json')), true);
  } finally {
    fixture.cleanup();
  }
});

test('inspection reports malformed operation directories instead of throwing', async () => {
  const fixture = createArchiveFixture('archive-operation-inspection');
  try {
    const repository = createRepository(fixture.root);
    await initialize(repository);
    fixture.writeJson('operations/not-an-operation/operation.json', { invalid: true });
    const inspection = await repository.inspect();
    const malformed = inspection.operations.find((entry) => entry.id === 'not-an-operation');
    assert.equal(malformed.operation, null);
    assert.equal(malformed.error.code, 'ARCHIVE_REFERENCE_INVALID');
  } finally {
    fixture.cleanup();
  }
});

test('interrupted Session recovery publishes a new stable commit', async () => {
  const fixture = createArchiveFixture('archive-recovery');
  try {
    const repository = createRepository(fixture.root);
    const initial = await initialize(repository);
    const start = await repository.beginOperation('start-session');
    await start.stageCommit({
      world: { ...initial.commit.world, phase: 'planning' },
      canonRevision: initial.commit.canonRevision,
      dayHeads: initial.commit.dayHeads,
      activeSession: { kind: 'planning', baseCommitId: initial.commit.id },
    });
    const active = await start.publish();
    assert.equal(active.commit.world.phase, 'planning');

    const recovered = await repository.recoverInterruptedSession();
    assert.equal(recovered.pointer.revision, 3);
    assert.equal(recovered.commit.world.phase, 'idle');
    assert.equal(recovered.commit.activeSession, null);
    assert.equal(fixture.readJson(`operations/${start.operationId}/operation.json`).sessionOutcome, 'interrupted');
  } finally {
    fixture.cleanup();
  }
});

test('interrupted revising and playing Sessions recover to their exact stable base commits', async () => {
  for (const kind of ['revising', 'playing']) {
    const fixture = createArchiveFixture(`archive-recovery-${kind}`);
    try {
      const repository = createRepository(fixture.root);
      const initial = await initialize(repository);
      let base = initial;
      if (kind === 'playing') {
        const planning = await repository.beginOperation('submit-session');
        const dayRevision = await planning.stageDay(plannedDay());
        await planning.stageCommit({
          world: { phase: 'planned', day: 'day_0001', lastSettledDay: null },
          canonRevision: initial.commit.canonRevision,
          dayHeads: { day_0001: { revision: dayRevision, status: 'planned' } },
          activeSession: null,
        });
        base = await planning.publish();
      }
      const start = await repository.beginOperation('start-session');
      await start.stageCommit({
        world: { ...base.commit.world, phase: kind },
        canonRevision: base.commit.canonRevision,
        dayHeads: base.commit.dayHeads,
        activeSession: {
          kind: kind === 'playing' ? 'play' : 'revise',
          baseCommitId: base.commit.id,
        },
      });
      await start.publish();

      const recovered = await repository.recoverInterruptedSession();
      assert.equal(recovered.commit.world.phase, kind === 'playing' ? 'planned' : 'idle');
      assert.equal(recovered.commit.canonRevision, base.commit.canonRevision);
      assert.deepEqual(recovered.commit.dayHeads, base.commit.dayHeads);
      assert.equal(recovered.commit.activeSession, null);
      assert.equal(fixture.readJson(`operations/${start.operationId}/operation.json`).sessionOutcome, 'interrupted');
    } finally {
      fixture.cleanup();
    }
  }
});

test('interrupted Session recovery failure preserves the published Session boundary', async () => {
  const fixture = createArchiveFixture('archive-recovery-failure');
  try {
    const injected = createFailureFilesystem(new NodeCoreFileSystem());
    const repository = createRepository(fixture.root, { filesystem: injected.filesystem });
    const initial = await initialize(repository);
    const start = await repository.beginOperation('start-session');
    await start.stageCommit({
      world: { ...initial.commit.world, phase: 'planning' },
      canonRevision: initial.commit.canonRevision,
      dayHeads: initial.commit.dayHeads,
      activeSession: { kind: 'planning', baseCommitId: initial.commit.id },
    });
    const active = await start.publish();
    injected.failNext('rename', new Error('recovery pointer failed'), (source) => source.includes('current.json.tmp-'));

    await assert.rejects(repository.recoverInterruptedSession());
    const current = await repository.readCurrent();
    assert.equal(current.status, 'ready');
    assert.equal(current.pointer.commitId, active.pointer.commitId);
    assert.equal(current.commit.world.phase, 'planning');
  } finally {
    fixture.cleanup();
  }
});

test('an interrupted initialization without current remains uninitialized', async () => {
  const fixture = createArchiveFixture('archive-recovery-init');
  try {
    const repository = createRepository(fixture.root);
    const transaction = await repository.beginOperation('init');
    await transaction.stageManifest({ worldId: 'unfinished', title: 'Unfinished' });
    assert.deepEqual(await createRepository(fixture.root).readCurrent(), { status: 'uninitialized' });
    await transaction.abort();
  } finally {
    fixture.cleanup();
  }
});
