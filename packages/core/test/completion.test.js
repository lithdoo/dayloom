const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createDayloomCoreInternal } = require('../dist/core');
const { resolvePackagedBoundaries } = require('../dist/promptpile/binaries');
const { classifyWorld, nextDay } = require('../dist/world/read');
const { publishMutation } = require('../dist/world/publish');
const { parseInitSubmissionV2, parsePlanningSubmissionV2, parseReviseSubmissionV2 } = require('../dist/session/submission-v2');
const { buildInitMutationV1 } = require('../dist/world/builders/init');
const { archiveFixture, FakeRunner } = require('./helpers');

const init = JSON.stringify({ version: 2, title: '  New World  ', canon: { premise: 'Premise', rules: '', style: 'Style', userRole: 'User' }, worldState: { status: 'active', elapsed: null, variables: {} }, characters: [], locations: [], arcs: [], initialFacts: [], unresolvedThreads: [], storySeeds: [] });
const planning = (intent = 'Day intent') => JSON.stringify({ version: 2, intent, knownContext: [], constraints: [], openQuestions: [], maxEvents: 1, beats: [{ key: 'begin', intent: 'Begin', priority: 'required', dependsOn: [] }] });
const play = JSON.stringify({ version: 2, events: [{ beatId: 'beat1', title: 'Begin', locationId: null, participantIds: [], scene: 'The day begins.', dialogue: '', userAction: 'Act', result: { summary: 'Day summary', learnedFacts: [], timeAdvanced: null, completedBeatIds: ['beat1'], skippedBeatIds: [], endDay: true }, proposedPatch: [] }] });
const revise = JSON.stringify({ version: 2, operations: [{ op: 'replace-canon', field: 'premise', expected: 'Premise', value: 'Revised' }] });

async function emptyCore(t, finals) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'core-completion-'));
  const config = path.join(root, 'llm.toml');
  fs.writeFileSync(config, '[[llm_api]]\nname="test"\nmodel="test"\n');
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const core = await createDayloomCoreInternal({ worldRoot: root, llmConfigPath: config }, { runner: new FakeRunner(finals), boundaries: await resolvePackagedBoundaries() });
  t.after(() => core.dispose());
  return { core, root };
}

test('empty and housekeeping-only roots are uninitialized while durable residue is invalid', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'core-classify-')); t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  assert.equal((await classifyWorld(root)).state.status, 'uninitialized');
  for (const relative of ['commits', 'objects', 'operations', '.locks', 'logs']) fs.mkdirSync(path.join(root, relative), { recursive: true });
  assert.equal((await classifyWorld(root)).state.status, 'uninitialized');
  fs.writeFileSync(path.join(root, 'operations', 'residue.json'), '{}');
  assert.equal((await classifyWorld(root)).state.status, 'invalid');
});

test('submission parsers are exact and Core owns day and beat identity', () => {
  assert.equal(parseInitSubmissionV2(init).title, '  New World  ');
  assert.equal(parsePlanningSubmissionV2(planning()).beats[0].intent, 'Begin');
  assert.equal(parseReviseSubmissionV2(revise).operations[0].value, 'Revised');
  assert.throws(() => parsePlanningSubmissionV2(JSON.stringify({ version: 1, intent: 'x', beats: [] })));
  assert.equal(nextDay(null), 'day1'); assert.equal(nextDay('day1'), 'day2');
  assert.equal(nextDay('day9007199254740992'), 'day9007199254740993');
});

test('idle Profile rejects visible next-day documents before Planning can overwrite them', async (t) => {
  const fixture = archiveFixture({ phase: 'idle' }); t.after(fixture.cleanup);
  const classified = await classifyWorld(fixture.root);
  assert.equal(classified.state.status, 'invalid');
  assert.match(classified.state.error.message, /Future Core-owned day document/);
});

test('publication primitive rejects duplicate business paths before filesystem mutation', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'core-duplicate-change-')); t.after(() => fs.rmSync(root, { recursive: true, force: true }));
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
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'core-init-cleanup-')); t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  await assert.rejects(() => publishMutation(root, {
    operationType: 'init', base: null, initialManifest: { worldId: 'world1', title: 'World' },
    changes: buildInitMutationV1(parseInitSubmissionV2(init)),
    control: { phase: 'idle', day: null, lastSettledDay: null },
  }, { writeCurrent: async () => { throw new Error('current write failed'); } }), /current write failed/);
  assert.equal((await classifyWorld(root)).state.status, 'uninitialized');
  assert.equal(fs.existsSync(path.join(root, 'manifest.json')), false);
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
