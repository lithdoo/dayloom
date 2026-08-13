const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createDayloomCoreInternal } = require('../dist/core');
const { resolvePackagedBoundaries } = require('../dist/promptpile/binaries');
const { publishPlay } = require('../dist/world/publish');
const { archiveFixture, FakeRunner, eventStream } = require('./helpers');

test('a second mutation returns BUSY immediately', async (t) => {
  const fixture = archiveFixture(); t.after(fixture.cleanup); let release;
  const runner = { calls: [], run(bin, args, options) { this.calls.push({ bin, args, options }); return new Promise((resolve) => { release = () => resolve({ code: 0, stdout: '', stderr: '' }); }); } };
  const core = await createDayloomCoreInternal({ worldRoot: fixture.root, llmConfigPath: fixture.config }, { runner, boundaries: await resolvePackagedBoundaries() }); t.after(() => core.dispose());
  const starting = core.startSession('play');
  while (!release) await new Promise((resolve) => setImmediate(resolve));
  assert.equal((await core.cancel()).error.code, 'BUSY'); release(); assert.deepEqual(await starting, { ok: true });
});
test('generic publication I/O failure is INTERNAL_ERROR, not AGENT_FAILED', async (t) => {
  const fixture = archiveFixture(); t.after(fixture.cleanup);
  const submission = JSON.stringify({ version: 1, summary: 'A day', beats: [{ id: 'beat1', status: 'completed', eventId: null }], events: [] });
  const publisher = async () => { const error = new Error('disk I/O failed'); error.code = 'EIO'; throw error; };
  const core = await createDayloomCoreInternal({ worldRoot: fixture.root, llmConfigPath: fixture.config }, { runner: new FakeRunner([submission]), boundaries: await resolvePackagedBoundaries(), publisher }); t.after(() => core.dispose());
  await core.startSession('play'); const result = await core.submit(); assert.equal(result.error.code, 'INTERNAL_ERROR'); assert.equal(core.getState().session, null);
});
test('disposed planned Core exposes no capabilities', async (t) => {
  const fixture = archiveFixture(); t.after(fixture.cleanup);
  const core = await createDayloomCoreInternal({ worldRoot: fixture.root, llmConfigPath: fixture.config }, { runner: new FakeRunner(), boundaries: await resolvePackagedBoundaries() });
  await core.dispose(); assert.deepEqual(core.getState().capabilities, { startSessions: [], send: false, submit: false, cancel: false });
  assert.equal((await core.startSession('play')).error.code, 'DISPOSED');
});
test('Core subscriber receives output.delta before send resolves', async (t) => {
  const fixture = archiveFixture(); t.after(fixture.cleanup); let close;
  const lines = eventStream('live').trimEnd().split('\n');
  const runner = { run: async (_bin, args, options = {}) => {
    if (args[0] === 'conversation') return { code: 0, stdout: '', stderr: '' };
    return new Promise((resolve) => {
      options.onStdout(`${lines[0]}\n${lines[1]}\n`);
      close = () => { options.onStdout(`${lines[2]}\n`); resolve({ code: 0, stdout: eventStream('live'), stderr: '' }); };
    });
  } };
  const core = await createDayloomCoreInternal({ worldRoot: fixture.root, llmConfigPath: fixture.config }, { runner, boundaries: await resolvePackagedBoundaries() }); t.after(() => core.dispose());
  await core.startSession('play'); let delta = '', settled = false; core.subscribe((event) => { if (event.type === 'output.delta') delta += event.text; });
  const sending = core.send('hello').finally(() => { settled = true; }); while (!close) await new Promise((resolve) => setImmediate(resolve));
  assert.equal(delta, 'live'); assert.equal(settled, false); close(); assert.deepEqual(await sending, { ok: true });
});
test('post-current diagnostic failure remains a successful visible publication', async (t) => {
  const fixture = archiveFixture(); t.after(fixture.cleanup);
  const submission = JSON.stringify({ version: 1, summary: 'A day', beats: [{ id: 'beat1', status: 'completed', eventId: null }], events: [] });
  const publisher = (root, pinned, day, documents) => publishPlay(root, pinned, day, documents, { writeDiagnostic: async () => { throw new Error('diagnostic failed'); } });
  const core = await createDayloomCoreInternal({ worldRoot: fixture.root, llmConfigPath: fixture.config }, { runner: new FakeRunner([submission]), boundaries: await resolvePackagedBoundaries(), publisher }); t.after(() => core.dispose());
  await core.startSession('play'); assert.deepEqual(await core.submit(), { ok: true }); assert.equal(core.getState().world.revision, 2);
  const reloaded = await createDayloomCoreInternal({ worldRoot: fixture.root, llmConfigPath: fixture.config }, { runner: new FakeRunner(), boundaries: await resolvePackagedBoundaries() }); t.after(() => reloaded.dispose());
  assert.equal(reloaded.getState().world.revision, 2); assert.equal(reloaded.getState().world.phase, 'awaiting-settle');
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
