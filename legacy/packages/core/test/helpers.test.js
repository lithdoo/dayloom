const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const { createArchiveFixture } = require('./helpers/archive-fixture.js');
const { createDeferredTask } = require('./helpers/deferred-task.js');
const {
  createDeterministicIdGenerator,
  createFakeClock,
} = require('./helpers/deterministic-runtime.js');
const { createFailureFilesystem } = require('./helpers/failure-filesystem.js');

test('archive fixture owns and cleans a temporary world directory', () => {
  const fixture = createArchiveFixture('helper');
  fixture.writeJson('nested/value.json', { ok: true });
  assert.deepEqual(fixture.readJson('nested/value.json'), { ok: true });
  fixture.cleanup();
  assert.equal(fs.existsSync(fixture.root), false);
});

test('deferred task exposes deterministic completion controls', async () => {
  const deferred = createDeferredTask();
  deferred.resolve('done');
  assert.equal(await deferred.promise, 'done');
});

test('deterministic runtime helpers provide stable ids and time', () => {
  const ids = createDeterministicIdGenerator();
  const clock = createFakeClock();
  assert.equal(ids.next('operation'), 'operation-1');
  assert.equal(ids.next('operation'), 'operation-2');
  assert.equal(clock.now().toISOString(), '2026-01-01T00:00:00.000Z');
  clock.set('2026-02-03T04:05:06.000Z');
  assert.equal(clock.now().toISOString(), '2026-02-03T04:05:06.000Z');
});

test('failure filesystem injects one failure without mutating its delegate', () => {
  const delegate = { write: (value) => value };
  const injected = createFailureFilesystem(delegate);
  injected.failNext('write');
  assert.throws(() => injected.filesystem.write('first'), /Injected write failure/);
  assert.equal(injected.filesystem.write('second'), 'second');
});
