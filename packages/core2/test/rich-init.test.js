const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { createDayloomCoreInternal } = require('../dist/core');
const { resolvePackagedBoundaries } = require('../dist/promptpile/binaries');
const { readPublishedWorld, readTextDocument } = require('../dist/world/read');
const { parseInitSubmissionV2 } = require('../dist/session/submission-v2');
const { FakeRunner } = require('./helpers');

const richInit = {
  version: 2,
  title: 'Harbor of Glass',
  canon: { premise: 'A tidal city remembers promises.', rules: 'Memory has a cost.', style: 'Quiet fantasy.', userRole: 'The new archivist.' },
  worldState: { status: 'uneasy-peace', elapsed: null, variables: { tide: 3, gateOpen: false } },
  characters: [
    { key: 'mira', profile: '# Mira\n\nHarbor pilot.', relationships: [{ characterKey: 'oren', relation: 'sibling', status: 'strained' }], status: 'active', locationKey: 'harbor', tags: ['pilot'] },
    { key: 'oren', profile: '# Oren\n\nGlasswright.', relationships: [{ characterKey: 'mira', relation: 'sibling', status: 'strained' }], status: 'active', locationKey: 'workshop', tags: ['artisan'] },
  ],
  locations: [
    { key: 'harbor', profile: '# Harbor', status: 'flooded', tags: ['public'], triggers: [{ condition: 'tide rises', effect: 'lower streets close' }] },
    { key: 'workshop', profile: '# Workshop', status: 'open', tags: ['private'], triggers: [] },
  ],
  arcs: [{ key: 'broken-promise', profile: '# Broken Promise', status: 'active', stage: 'discovery' }],
  initialFacts: [{ text: 'The bell rang without a keeper.' }],
  unresolvedThreads: [{ text: 'Who opened the sea gate?' }],
  storySeeds: [{ text: 'Inspect the drowned archive.' }],
};

test('Rich Init V2 publishes a complete restart-safe World Profile V1', async (t) => {
  assert.equal(parseInitSubmissionV2(JSON.stringify(richInit)).characters.length, 2);
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'core2-rich-init-'));
  const config = path.join(root, 'llm.toml'); fs.writeFileSync(config, '[[llm_api]]\nname="test"\nmodel="test"\n');
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const core = await createDayloomCoreInternal({ worldRoot: root, llmConfigPath: config }, { runner: new FakeRunner([JSON.stringify(richInit)]), boundaries: await resolvePackagedBoundaries() });
  t.after(() => core.dispose());
  assert.deepEqual(await core.startSession('init'), { ok: true });
  assert.deepEqual(await core.submit(), { ok: true });
  await core.dispose();
  const restarted = await createDayloomCoreInternal({ worldRoot: root, llmConfigPath: config }, { runner: new FakeRunner(), boundaries: await resolvePackagedBoundaries() });
  t.after(() => restarted.dispose());
  const published = await readPublishedWorld(root);
  assert.equal(published.profileVersion, 1);
  assert.deepEqual(published.profileV1.characterIds, ['character1', 'character2']);
  assert.deepEqual(published.profileV1.locationIds, ['location1', 'location2']);
  assert.deepEqual(published.profileV1.arcIds, ['arc1']);
  assert.equal(published.profileV1.state.variables.tide, 3);
  assert.match(await readTextDocument(root, published.tree, 'characters/character1/profile.md'), /Mira/);
  assert.equal(restarted.getState().world.status, 'published');
  assert.deepEqual(restarted.getState().capabilities.startSessions, ['planning', 'revise']);
});

test('Rich Init rejects dangling entity references before publication', () => {
  const invalid = structuredClone(richInit); invalid.characters[0].locationKey = 'missing';
  assert.throws(() => parseInitSubmissionV2(JSON.stringify(invalid)), /location reference/);
});
