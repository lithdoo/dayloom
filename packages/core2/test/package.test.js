const test = require('node:test');
const assert = require('node:assert/strict');
test('public API exports only application contract', () => {
  const api = require('../dist');
  assert.deepEqual(Object.keys(api).sort(), ['CoreInitializationError', 'createDayloomCore']);
});
