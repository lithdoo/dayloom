const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createDayloomCoreInternal } = require('../dist/core');
const { resolvePackagedBoundaries } = require('../dist/promptpile/binaries');
const { archiveFixture, FakeRunner } = require('./helpers');

test('a second mutation returns BUSY immediately', async (t) => {
  const fixture = archiveFixture(); t.after(fixture.cleanup); let release;
  const runner = { calls: [], run(bin, args, stdin) { this.calls.push({ bin, args, stdin }); return new Promise((resolve) => { release = () => resolve({ code: 0, stdout: '', stderr: '' }); }); } };
  const core = await createDayloomCoreInternal({ worldRoot: fixture.root, llmConfigPath: fixture.config }, { runner, boundaries: await resolvePackagedBoundaries() }); t.after(() => core.dispose());
  const starting = core.startSession('play');
  while (!release) await new Promise((resolve) => setImmediate(resolve));
  assert.equal((await core.cancel()).error.code, 'BUSY'); release(); assert.deepEqual(await starting, { ok: true });
});
test('publish lock conflicts fail closed and leave current unchanged', async (t) => {
  const fixture = archiveFixture(); t.after(fixture.cleanup);
  const submission = JSON.stringify({ version: 1, summary: 'A day', beats: [{ id: 'beat1', status: 'completed', eventId: null }], events: [] });
  const core = await createDayloomCoreInternal({ worldRoot: fixture.root, llmConfigPath: fixture.config }, { runner: new FakeRunner([submission]), boundaries: await resolvePackagedBoundaries() }); t.after(() => core.dispose());
  await core.startSession('play'); const before = fs.readFileSync(path.join(fixture.root, 'current.json'), 'utf8');
  fs.mkdirSync(path.join(fixture.root, '.locks'), { recursive: true }); fs.writeFileSync(path.join(fixture.root, '.locks', 'publish.lock'), 'held');
  const result = await core.submit(); assert.equal(result.error.code, 'WORLD_CONFLICT'); assert.equal(fs.readFileSync(path.join(fixture.root, 'current.json'), 'utf8'), before); assert.equal(core.getState().session, null);
});
test('cancel leaves World unchanged and invalid input preserves ready Session', async (t) => {
  const fixture = archiveFixture(); t.after(fixture.cleanup); const core = await createDayloomCoreInternal({ worldRoot: fixture.root, llmConfigPath: fixture.config }, { runner: new FakeRunner(), boundaries: await resolvePackagedBoundaries() }); t.after(() => core.dispose());
  const before = fs.readFileSync(path.join(fixture.root, 'current.json'), 'utf8'); await core.startSession('play');
  assert.equal((await core.send('  ')).error.code, 'INVALID_INPUT'); assert.equal(core.getState().session.status, 'ready');
  assert.deepEqual(await core.cancel(), { ok: true }); assert.equal(fs.readFileSync(path.join(fixture.root, 'current.json'), 'utf8'), before);
});
test('a changed pinned base conflicts before publication', async (t) => {
  const fixture = archiveFixture(); t.after(fixture.cleanup);
  const submission = JSON.stringify({ version: 1, summary: 'A day', beats: [{ id: 'beat1', status: 'completed', eventId: null }], events: [] });
  const runner = new FakeRunner([submission]); const core = await createDayloomCoreInternal({ worldRoot: fixture.root, llmConfigPath: fixture.config }, { runner, boundaries: await resolvePackagedBoundaries() }); t.after(() => core.dispose());
  await core.startSession('play');
  const currentPath = path.join(fixture.root, 'current.json'), before = JSON.parse(fs.readFileSync(currentPath, 'utf8'));
  fs.writeFileSync(currentPath, JSON.stringify({ ...before, updatedAt: '2026-08-13T00:00:01.000Z', revision: 2 }));
  const result = await core.submit(); assert.equal(result.error.code, 'WORLD_CONFLICT'); assert.equal(core.getState().session, null);
  assert.equal(fs.existsSync(path.join(fixture.root, `days/day1/play.json`)), false);
});
