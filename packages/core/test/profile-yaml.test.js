const assert = require('node:assert/strict');
const test = require('node:test');
const { exactObjectV1, parseYamlObjectV1, schemaVersionV1, stringArrayV1 } = require('../dist/world/profile/yaml');

test('Profile YAML parser rejects aliases, duplicate keys, non-objects, and unknown shape', () => {
  assert.deepEqual(parseYamlObjectV1('schemaVersion: 1\nids:\n  - alice\n', 'Index'), { schemaVersion: 1, ids: ['alice'] });
  assert.throws(() => parseYamlObjectV1('id: one\nid: two\n', 'Duplicate'), /invalid YAML/);
  assert.throws(() => parseYamlObjectV1('- one\n', 'Array'), /must be a YAML object/);
  assert.throws(() => parseYamlObjectV1('base: &base { value: x }\ncopy: *base\n', 'Alias'), /invalid YAML/);
  assert.throws(() => exactObjectV1({ schemaVersion: 1, ids: [], extra: true }, ['schemaVersion', 'ids'], 'Index'), /invalid shape/);
  assert.throws(() => schemaVersionV1(2, 'Index'), /must equal 1/);
  assert.throws(() => stringArrayV1(['alice', 'alice'], 'Index.ids'), /unique/);
});
