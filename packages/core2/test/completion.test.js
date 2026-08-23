const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createDayloomCoreInternal } = require('../dist/core');
const { resolvePackagedBoundaries } = require('../dist/promptpile/binaries');
const { classifyWorld, nextDay, parsePersistedPlayV1 } = require('../dist/world/read');
const { publishMutation } = require('../dist/world/publish');
const { parseInitSubmissionV1, parsePlanningSubmissionV1, parseReviseSubmissionV1 } = require('../dist/session/submission');
const { archiveFixture, FakeRunner } = require('./helpers');

const init = JSON.stringify({ version: 1, title: '  New World  ', canon: { premise: 'Premise', rules: '', style: 'Style', userRole: 'User' } });
const planning = (intent = 'Day intent') => JSON.stringify({ version: 1, intent, beats: [{ intent: 'Begin' }] });
const play = JSON.stringify({ version: 1, summary: 'Day summary', beats: [{ id: 'beat1', status: 'completed', eventId: 'event1' }], events: [{ id: 'event1', beatId: 'beat1', userInput: 'Act', assistantOutput: 'Done' }] });
const revise = JSON.stringify({ version: 1, canon: { premise: 'Revised', rules: '', style: 'Style 2', userRole: 'User 2' } });

async function emptyCore(t, finals) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'core2-completion-'));
  const config = path.join(root, 'llm.toml');
  fs.writeFileSync(config, '[[llm_api]]\nname="test"\nmodel="test"\n');
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const core = await createDayloomCoreInternal({ worldRoot: root, llmConfigPath: config }, { runner: new FakeRunner(finals), boundaries: await resolvePackagedBoundaries() });
  t.after(() => core.dispose());
  return { core, root };
}

test('empty and housekeeping-only roots are uninitialized while durable residue is invalid', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'core2-classify-')); t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  assert.equal((await classifyWorld(root)).state.status, 'uninitialized');
  for (const relative of ['commits', 'objects', 'operations', '.locks', 'logs']) fs.mkdirSync(path.join(root, relative), { recursive: true });
  assert.equal((await classifyWorld(root)).state.status, 'uninitialized');
  fs.writeFileSync(path.join(root, 'operations', 'residue.json'), '{}');
  assert.equal((await classifyWorld(root)).state.status, 'invalid');
});

test('submission parsers are exact and Core owns day and beat identity', () => {
  assert.equal(parseInitSubmissionV1(init).title, '  New World  ');
  assert.deepEqual(parsePlanningSubmissionV1(planning()).beats, [{ intent: 'Begin' }]);
  assert.equal(parseReviseSubmissionV1(revise).canon.premise, 'Revised');
  assert.throws(() => parsePlanningSubmissionV1(JSON.stringify({ version: 1, intent: 'x', beats: [], day: 'day9' })));
  assert.equal(nextDay(null), 'day1'); assert.equal(nextDay('day1'), 'day2');
  assert.equal(nextDay('day9007199254740992'), 'day9007199254740993');
});

test('idle Profile rejects visible next-day documents before Planning can overwrite them', async (t) => {
  const fixture = archiveFixture({ phase: 'idle' }); t.after(fixture.cleanup);
  const classified = await classifyWorld(fixture.root);
  assert.equal(classified.state.status, 'invalid');
  assert.match(classified.state.error.message, /Future Core2-owned day document/);
});

test('publication primitive rejects duplicate business paths before filesystem mutation', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'core2-duplicate-change-')); t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  await assert.rejects(() => publishMutation(root, {
    operationType: 'init', base: null, initialManifest: { worldId: 'world1', title: 'World' },
    changes: [
      { op: 'put', path: 'canon/premise.md', mediaType: 'text/markdown', bytes: Buffer.from('a') },
      { op: 'put', path: 'canon/premise.md', mediaType: 'text/markdown', bytes: Buffer.from('b') },
    ],
    control: { phase: 'idle', day: null, lastSettledDay: null },
  }), /duplicated/);
  assert.equal(fs.existsSync(path.join(root, 'current.json')), false);
});

test('failed initial publication cleans its own pre-current durable files back to uninitialized', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'core2-init-cleanup-')); t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const markdown = (documentPath, value) => ({ op: 'put', path: documentPath, mediaType: 'text/markdown', bytes: Buffer.from(value) });
  await assert.rejects(() => publishMutation(root, {
    operationType: 'init', base: null, initialManifest: { worldId: 'world1', title: 'World' },
    changes: [markdown('canon/premise.md', 'p'), markdown('canon/rules.md', 'r'), markdown('canon/style.md', 's'), markdown('canon/user-role.md', 'u')],
    control: { phase: 'idle', day: null, lastSettledDay: null },
  }, { writeCurrent: async () => { throw new Error('current write failed'); } }), /current write failed/);
  assert.equal((await classifyWorld(root)).state.status, 'uninitialized');
  assert.equal(fs.existsSync(path.join(root, 'manifest.json')), false);
});

test('PersistedPlayV1 parser enforces pinned plan relations', () => {
  const plan = { intent: 'x', beats: [{ id: 'beat1', intent: 'begin' }] };
  const valid = { version: 1, beats: [{ id: 'beat1', intent: 'begin', status: 'completed', eventId: 'e1' }], events: [{ id: 'e1', beatId: 'beat1', userInput: 'u', assistantOutput: 'a' }] };
  assert.equal(parsePersistedPlayV1(valid, plan).events[0].id, 'e1');
  assert.throws(() => parsePersistedPlayV1({ ...valid, beats: [{ ...valid.beats[0], intent: 'changed' }] }, plan));
});

test('full headless lifecycle reaches day2 planned without a stable dead end', async (t) => {
  const { core } = await emptyCore(t, ['init-visible', init, 'planning-visible', planning(), 'play-visible', play, 'revise-visible', revise, planning('Second day')]);
  const deltas = []; core.subscribe((event) => { if (event.type === 'output.delta') deltas.push(event.text); });
  assert.equal(core.getState().world.status, 'uninitialized');
  assert.deepEqual(core.getState().capabilities.startSessions, ['init']);
  assert.deepEqual(await core.startSession('init'), { ok: true }); await core.send('create'); assert.deepEqual(await core.submit(), { ok: true });
  assert.equal(core.getState().world.phase, 'idle'); assert.equal(core.getState().world.title, 'New World');
  assert.deepEqual(core.getState().capabilities.startSessions, ['planning', 'revise']);
  await core.startSession('planning'); await core.send('plan'); await core.submit();
  assert.equal(core.getState().world.day, 'day1'); assert.deepEqual(core.getState().capabilities.startSessions, ['play']);
  await core.startSession('play'); await core.send('act'); await core.submit();
  assert.equal(core.getState().world.phase, 'awaiting-settle'); assert.equal(core.getState().capabilities.settle, true);
  assert.deepEqual(await core.settle(), { ok: true }); assert.equal(core.getState().world.lastSettledDay, 'day1');
  await core.startSession('revise'); await core.send('revise'); await core.submit(); assert.equal(core.getState().world.phase, 'idle');
  await core.startSession('planning'); await core.submit();
  assert.equal(core.getState().world.day, 'day2'); assert.equal(core.getState().world.revision, 6);
  assert.deepEqual(deltas, ['init-visible', init, 'planning-visible', planning(), 'play-visible', play, 'revise-visible', revise, planning('Second day')]);
});

test('abandon from planned and awaiting-settle removes visible current day and reuses identity', async (t) => {
  const { core } = await emptyCore(t, [init, planning('first'), planning('second'), play, planning('third')]);
  await core.startSession('init'); await core.submit();
  await core.startSession('planning'); await core.submit(); assert.equal(core.getState().world.day, 'day1');
  assert.deepEqual(await core.abandonDay(), { ok: true }); assert.equal(core.getState().world.phase, 'idle');
  await core.startSession('planning'); await core.submit(); assert.equal(core.getState().world.day, 'day1');
  await core.startSession('play'); await core.submit(); assert.equal(core.getState().world.phase, 'awaiting-settle');
  assert.deepEqual(await core.abandonDay(), { ok: true });
  await core.startSession('planning'); await core.submit(); assert.equal(core.getState().world.day, 'day1');
});
