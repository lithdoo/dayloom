const test = require('node:test');
const assert = require('node:assert/strict');
const core = require('../dist/index.js');

test('exports package marker', () => {
  assert.equal(core.corePackageName, '@dayloom/core');
  assert.equal(typeof core.coreStateMachine.transitionWorld, 'function');
  assert.equal(typeof core.createDayloomRuntime, 'function');
  assert.equal('CoreRuntime' in core, false);
  assert.equal('WorldStore' in core, false);
  assert.equal('createCoreNativeSessionFactory' in core, false);
  assert.doesNotThrow(() => JSON.stringify({
    code: 'ARCHIVE_CONFLICT',
    message: 'conflict',
    details: { revision: 1 },
  }));
});
