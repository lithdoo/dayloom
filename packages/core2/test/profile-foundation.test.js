const assert = require('node:assert/strict');
const test = require('node:test');
const { DAYLOOM_PROFILE_DESCRIPTOR_PATH, parseDayloomProfileDescriptorV1 } = require('../dist/world/profile/descriptor');
const { assertDayloomDocumentPathV1, assertMutationPathAllowedV1, expectedMediaTypeV1 } = require('../dist/world/profile/policy');
const { readPublishedWorld, classifyWorld } = require('../dist/world/read');
const { archiveFixture } = require('./helpers');

test('Profile V1 descriptor is strict and frozen', () => {
  assert.equal(DAYLOOM_PROFILE_DESCRIPTOR_PATH, 'profile/dayloom.json');
  const value = parseDayloomProfileDescriptorV1({ schemaVersion: 1, profile: 'dayloom', profileVersion: 1 });
  assert.equal(Object.isFrozen(value), true);
  assert.throws(() => parseDayloomProfileDescriptorV1({ ...value, extra: true }), /invalid/);
  assert.throws(() => parseDayloomProfileDescriptorV1({ ...value, profileVersion: 2 }), /unsupported/);
});

test('Profile V1 path policy separates business documents from Archive control plane', () => {
  assert.equal(assertDayloomDocumentPathV1('characters/alice/profile.md'), 'characters/alice/profile.md');
  assert.equal(expectedMediaTypeV1('state/world.yaml'), 'application/yaml');
  assert.equal(expectedMediaTypeV1('audit/sessions/s1/transcript.json'), 'application/json');
  for (const path of ['manifest.json', 'current.json', 'objects/blobs/x', 'operations/op/operation.json', 'logs/runtime.log']) {
    assert.throws(() => assertDayloomDocumentPathV1(path), /outside/);
  }
});

test('Profile V1 operation policy protects history and private namespaces', () => {
  assert.equal(assertMutationPathAllowedV1('planning', 'days/day1/plan.json'), 'days/day1/plan.json');
  assert.equal(assertMutationPathAllowedV1('play', 'days/day1/events/event1/result.yaml'), 'days/day1/events/event1/result.yaml');
  assert.equal(assertMutationPathAllowedV1('settle', 'characters/alice/state.yaml'), 'characters/alice/state.yaml');
  assert.equal(assertMutationPathAllowedV1('migration', 'legacy/files/logs/errors.md'), 'legacy/files/logs/errors.md');
  assert.throws(() => assertMutationPathAllowedV1('planning', 'characters/alice/state.yaml'), /cannot mutate/);
  assert.throws(() => assertMutationPathAllowedV1('revise', 'days/day1/summary.md'), /cannot mutate/);
  assert.throws(() => assertMutationPathAllowedV1('settle', 'canon/premise.md'), /cannot mutate/);
  assert.throws(() => assertMutationPathAllowedV1('init', 'legacy/files/unknown.txt'), /cannot mutate/);
});

test('published World dispatches explicitly between Profile V0 and V1', async (t) => {
  const v0 = archiveFixture();
  const v1 = archiveFixture({ profileVersion: 1 });
  const unsupported = archiveFixture({ profileVersion: 2 });
  t.after(() => { v0.cleanup(); v1.cleanup(); unsupported.cleanup(); });
  assert.equal((await readPublishedWorld(v0.root)).profileVersion, 0);
  const rich = await readPublishedWorld(v1.root);
  assert.equal(rich.profileVersion, 1);
  assert.deepEqual(rich.profileV1.characterIds, []);
  assert.equal(rich.profileV1.state.world.title, 'World');
  const classified = await classifyWorld(unsupported.root);
  assert.equal(classified.state.status, 'invalid');
  assert.match(classified.state.error.message, /unsupported/);
});
