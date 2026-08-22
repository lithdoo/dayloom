const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { createDayloomCoreInternal } = require('../dist/core');
const { resolvePackagedBoundaries } = require('../dist/promptpile/binaries');
const { readPublishedWorld, readTextDocument } = require('../dist/world/read');
const { buildLifecycleContext } = require('../dist/session/lifecycle');
const { parsePlanningSubmissionV2 } = require('../dist/session/submission-v2');
const { FakeRunner } = require('./helpers');

const init = JSON.stringify({ version: 2, title: 'World', canon: { premise: 'P', rules: 'R', style: 'S', userRole: 'U' }, worldState: { status: 'active', elapsed: null, variables: {} }, characters: [], locations: [], arcs: [], initialFacts: [], unresolvedThreads: [], storySeeds: [] });
const planningValue = { version: 2, intent: 'Find the bell keeper', knownContext: ['The bell rang alone'], constraints: ['Do not leave the harbor'], openQuestions: ['Who opened the gate?'], maxEvents: 4, beats: [{ key: 'investigate', intent: 'Inspect the bell', priority: 'required', dependsOn: [] }, { key: 'question', intent: 'Question witnesses', priority: 'optional', dependsOn: ['investigate'] }] };

test('Rich Planning publishes PlayPlanV1 and survives restart', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'core2-rich-planning-')), config = path.join(root, 'llm.toml');
  fs.writeFileSync(config, '[[llm_api]]\nname="test"\nmodel="test"\n'); t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const core = await createDayloomCoreInternal({ worldRoot: root, llmConfigPath: config }, { runner: new FakeRunner([init, JSON.stringify(planningValue)]), boundaries: await resolvePackagedBoundaries() }); t.after(() => core.dispose());
  await core.startSession('init'); assert.deepEqual(await core.submit(), { ok: true });
  await core.startSession('planning'); assert.deepEqual(await core.submit(), { ok: true });
  const world = await readPublishedWorld(root);
  assert.equal(world.profileVersion, 1); assert.equal(world.commit.control.phase, 'planned');
  assert.equal(world.playContext.plan.version, 1); assert.equal(world.playContext.plan.maxEvents, 4);
  assert.deepEqual(world.playContext.plan.beats[1].dependsOn, ['beat1']);
  assert.equal(await readTextDocument(root, world.tree, 'days/day1/timeline.md'), '');
  assert.equal(world.tree.entries.some((entry) => entry.path === 'days/day1/events/index.yaml'), true);
  const context = buildLifecycleContext({ kind: 'planning', pinned: world, day: 'day2' });
  assert.match(context, /\[VERIFIED_WORLD_DOCUMENTS\]/); assert.match(context, /state\/world\.yaml/); assert.match(context, /canon\/premise\.md/);
});

test('Rich Planning rejects forward, missing, and cyclic dependencies', () => {
  assert.equal(parsePlanningSubmissionV2(JSON.stringify(planningValue)).beats.length, 2);
  const invalid = structuredClone(planningValue); invalid.beats[0].dependsOn = ['question'];
  assert.throws(() => parsePlanningSubmissionV2(JSON.stringify(invalid)), /earlier beat/);
  invalid.beats[0].dependsOn = ['missing'];
  assert.throws(() => parsePlanningSubmissionV2(JSON.stringify(invalid)), /earlier beat/);
});
