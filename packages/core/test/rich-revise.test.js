const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { createDayloomCoreInternal } = require('../dist/core');
const { resolvePackagedBoundaries } = require('../dist/promptpile/binaries');
const { readPublishedWorld } = require('../dist/world/read');
const { FakeRunner } = require('./helpers');

const init = JSON.stringify({ version: 2, title: 'World', canon: { premise: 'Old', rules: 'R', style: 'S', userRole: 'U' }, worldState: { status: 'active', elapsed: null, variables: { mood: 'calm' } }, characters: [{ key: 'hero', profile: 'Hero', relationships: [], status: 'ready', locationKey: null, tags: [] }], locations: [], arcs: [], initialFacts: [], unresolvedThreads: [], storySeeds: [{ text: 'Old seed' }] });
const revise = JSON.stringify({ version: 2, operations: [{ op: 'replace-canon', field: 'premise', expected: 'Old', value: 'New' }, { op: 'set-world-variable', key: 'mood', expected: 'calm', value: 'focused' }, { op: 'replace-character-profile', characterId: 'character1', expected: 'Hero', value: 'Changed hero' }, { op: 'remove-story-seed', seedId: 'seed1', expectedText: 'Old seed' }, { op: 'add-story-seed', text: 'New seed' }, { op: 'create-location', profile: 'Harbor', status: 'open', tags: ['public'], triggers: [{ condition: 'night', effect: 'fog' }] }, { op: 'create-character', profile: 'Guide', status: 'ready', locationId: 'location1', tags: [], relationships: [{ characterId: 'character1', relation: 'ally', status: 'trusted' }] }, { op: 'create-arc', profile: 'Mystery', status: 'active', stage: 'opening' }] });

test('Profile V1 typed Revise applies semantic operations while preserving history namespaces', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'core-rich-revise-')), config = path.join(root, 'llm.toml'); fs.writeFileSync(config, '[[llm_api]]\nname="test"\nmodel="test"\n'); t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const core = await createDayloomCoreInternal({ worldRoot: root, llmConfigPath: config }, { runner: new FakeRunner([init, revise]), boundaries: await resolvePackagedBoundaries() }); t.after(() => core.dispose());
  await core.startSession('init'); await core.submit(); const before = await readPublishedWorld(root);
  await core.startSession('revise'); assert.deepEqual(await core.submit(), { ok: true });
  const after = await readPublishedWorld(root); assert.equal(after.canon.premise, 'New'); assert.equal(after.profileV1.state.variables.mood, 'focused'); assert.equal(after.profileV1.contextDocuments['characters/character1/profile.md'], 'Changed hero'); assert.match(after.profileV1.contextDocuments['story-seeds/active.yaml'], /New seed/);
  assert.deepEqual(after.profileV1.characterIds, ['character1', 'character2']); assert.deepEqual(after.profileV1.locationIds, ['location1']); assert.deepEqual(after.profileV1.arcIds, ['arc1']); assert.deepEqual(after.profileV1.state.progress.activeArcIds, ['arc1']);
  const oldDays = before.tree.entries.filter((entry) => entry.path.startsWith('days/')); const newDays = after.tree.entries.filter((entry) => entry.path.startsWith('days/')); assert.deepEqual(newDays, oldDays);
  assert.equal(after.tree.entries.some((entry) => entry.path.startsWith('audit/sessions/')), true);
});

test('Profile V1 typed Revise rejects dangling references without publishing', async (t) => {
  const bad = JSON.stringify({ version: 2, operations: [{ op: 'move-character', characterId: 'character1', expectedLocationId: null, locationId: 'location999' }] });
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'core-bad-revise-')), config = path.join(root, 'llm.toml'); fs.writeFileSync(config, '[[llm_api]]\nname="test"\nmodel="test"\n'); t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const core = await createDayloomCoreInternal({ worldRoot: root, llmConfigPath: config }, { runner: new FakeRunner([init, bad]), boundaries: await resolvePackagedBoundaries() }); t.after(() => core.dispose());
  await core.startSession('init'); await core.submit(); const before = (await readPublishedWorld(root)).commit.id; await core.startSession('revise'); const result = await core.submit(); assert.equal(result.ok, false); assert.equal((await readPublishedWorld(root)).commit.id, before);
});
