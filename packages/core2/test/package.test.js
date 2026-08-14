const test = require('node:test');
const assert = require('node:assert/strict');
const corePackage = require('../package.json');

test('public API exports only application contract', () => {
  const api = require('../dist');
  assert.deepEqual(Object.keys(api).sort(), ['CoreInitializationError', 'createDayloomCore']);
});

test('core2 pins the frozen promptpile-compress release', () => {
  assert.equal(corePackage.dependencies['promptpile-compress'], '0.1.0-beta.2');
});

test('core2 package describes the complete product lifecycle', () => {
  assert.doesNotMatch(corePackage.description, /play-only|minimal.*play runtime/i);
});
