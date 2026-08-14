import assert from 'node:assert/strict';
import test from 'node:test';

import { isCtrlC } from '../dist/app.js';

function key(name, ctrl) {
  return {
    kind: 'key',
    key: name,
    modifiers: { ctrl, alt: false, shift: false, meta: false },
    repeat: 1,
    protocol: 'legacy-vt',
  };
}

test('isCtrlC matches semantic ctrl+c key events only', () => {
  assert.equal(isCtrlC(key('c', true)), true);
  assert.equal(isCtrlC(key('c', false)), false);
  assert.equal(isCtrlC(key('a', true)), false);
  assert.equal(isCtrlC({ kind: 'text', text: 'c', protocol: 'legacy-vt' }), false);
});
