const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { createDayloomCoreInternal } = require('../dist/core');
const { resolvePackagedBoundaries } = require('../dist/promptpile/binaries');
const { readPublishedWorld } = require('../dist/world/read');
const { readStructuredDayEventsV1 } = require('../dist/world/profile/events');
const { FakeRunner } = require('./helpers');

const init = JSON.stringify({ version: 2, title: 'World', canon: { premise: 'P', rules: 'R', style: 'S', userRole: 'U' }, worldState: { status: 'active', elapsed: null, variables: { mood: 'calm' } }, characters: [], locations: [], arcs: [], initialFacts: [], unresolvedThreads: [], storySeeds: [] });
const planning = JSON.stringify({ version: 2, intent: 'Investigate', knownContext: [], constraints: [], openQuestions: [], maxEvents: 2, beats: [{ key: 'look', intent: 'Look around', priority: 'required', dependsOn: [] }] });
const play = JSON.stringify({ version: 2, events: [{ beatId: 'beat1', title: 'The bell', locationId: null, participantIds: [], scene: 'The bell moves.', dialogue: '', userAction: 'Inspect the rope.', result: { summary: 'The rope was cut.', learnedFacts: ['Someone cut the rope.'], timeAdvanced: '10m', completedBeatIds: ['beat1'], skippedBeatIds: [], endDay: true }, proposedPatch: [{ op: 'set-world-variable', key: 'mood', expected: 'calm', value: 'alarmed' }] }] });

test('Profile V1 Play publishes structured event facts without applying proposed state', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'core2-rich-play-')), config = path.join(root, 'llm.toml'); fs.writeFileSync(config, '[[llm_api]]\nname="test"\nmodel="test"\n'); t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const core = await createDayloomCoreInternal({ worldRoot: root, llmConfigPath: config }, { runner: new FakeRunner([init, planning, play]), boundaries: await resolvePackagedBoundaries() }); t.after(() => core.dispose());
  await core.startSession('init'); await core.submit(); await core.startSession('planning'); await core.submit(); await core.startSession('play');
  assert.deepEqual(await core.submit(), { ok: true });
  const world = await readPublishedWorld(root); assert.equal(world.commit.control.phase, 'awaiting-settle');
  assert.equal(world.profileV1.state.variables.mood, 'calm', 'Play records but does not apply state patches');
  assert.equal(world.tree.entries.some((entry) => entry.path === 'days/day1/play.json'), false);
  assert.equal(world.tree.entries.some((entry) => entry.path === 'days/day1/events/event1/result.yaml'), true);
  const events = await readStructuredDayEventsV1(root, world.tree, 'day1', { version: 1, intent: 'Investigate', knownContext: [], constraints: [], openQuestions: [], maxEvents: 2, beats: [{ id: 'beat1', intent: 'Look around', priority: 'required', dependsOn: [] }] }, world.profileV1);
  assert.equal(events[0].summary, 'The rope was cut.'); assert.equal(events[0].patches[0].op, 'set-world-variable');
  assert.deepEqual(await core.abandonDay(), { ok: true });
  const abandoned = await readPublishedWorld(root); assert.equal(abandoned.commit.control.phase, 'idle');
  assert.equal(abandoned.tree.entries.some((entry) => entry.path.startsWith('days/day1/')), false);
});
