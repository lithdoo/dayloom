const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { createDayloomCoreInternal } = require('../dist/core');
const { resolvePackagedBoundaries } = require('../dist/promptpile/binaries');
const { readPublishedWorld } = require('../dist/world/read');
const { FakeRunner } = require('./helpers');

const init = JSON.stringify({ version: 2, title: 'World', canon: { premise: 'P', rules: 'R', style: 'S', userRole: 'U' }, worldState: { status: 'active', elapsed: null, variables: { mood: 'calm' } }, characters: [], locations: [], arcs: [], initialFacts: [], unresolvedThreads: [], storySeeds: [] });
const planning = JSON.stringify({ version: 2, intent: 'Investigate', knownContext: [], constraints: [], openQuestions: [], maxEvents: 1, beats: [{ key: 'look', intent: 'Look around', priority: 'required', dependsOn: [] }] });
const play = JSON.stringify({ version: 2, events: [{ beatId: 'beat1', title: 'The bell', locationId: null, participantIds: [], scene: 'The bell moves.', dialogue: '', userAction: 'Inspect the rope.', result: { summary: 'The rope was cut.', learnedFacts: ['Someone cut the rope.'], timeAdvanced: '10m', completedBeatIds: ['beat1'], skippedBeatIds: [], endDay: true }, proposedPatch: [{ op: 'set-world-variable', key: 'mood', expected: 'calm', value: 'alarmed' }] }] });

test('Profile V1 settlement atomically applies event facts and survives restart into next Planning', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'core-rich-settle-')), config = path.join(root, 'llm.toml');
  fs.writeFileSync(config, '[[llm_api]]\nname="test"\nmodel="test"\n'); t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const boundaries = await resolvePackagedBoundaries();
  const core = await createDayloomCoreInternal({ worldRoot: root, llmConfigPath: config }, { runner: new FakeRunner([init, planning, play]), boundaries });
  await core.startSession('init'); await core.submit(); await core.startSession('planning'); await core.submit(); await core.startSession('play'); await core.submit();
  assert.deepEqual(await core.settle(), { ok: true });
  let world = await readPublishedWorld(root);
  assert.equal(world.commit.control.phase, 'idle'); assert.equal(world.commit.control.lastSettledDay, 'day1');
  assert.equal(world.profileV1.state.variables.mood, 'alarmed'); assert.equal(world.profileV1.state.calendar.elapsed, '10m');
  assert.match(world.profileV1.contextDocuments['memory/facts.yaml'], /Someone cut the rope/);
  for (const documentPath of ['days/day1/summary.md', 'days/day1/diary.md', 'days/day1/settlement.yaml', 'days/day1/next-day-seed.yaml']) assert.equal(world.tree.entries.some((entry) => entry.path === documentPath), true, documentPath);
  await core.dispose();

  const restarted = await createDayloomCoreInternal({ worldRoot: root, llmConfigPath: config }, { runner: new FakeRunner([planning]), boundaries }); t.after(() => restarted.dispose());
  assert.deepEqual(await restarted.startSession('planning'), { ok: true });
  assert.deepEqual(await restarted.submit(), { ok: true });
  world = await readPublishedWorld(root); assert.equal(world.commit.control.day, 'day2'); assert.equal(world.commit.control.phase, 'planned');
});
