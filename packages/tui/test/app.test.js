import assert from 'node:assert/strict';
import test from 'node:test';

import { isCtrlC } from '../dist/app.js';

test('isCtrlC matches legacy control sequence and kitty-style ctrl+c', () => {
  assert.equal(isCtrlC({ input: 'c', name: 'c', ctrl: true }), true);
  assert.equal(isCtrlC({ input: '\x03', name: 'c', ctrl: true }), true);
  assert.equal(isCtrlC({ input: 'c', ctrl: true }), true);
  assert.equal(isCtrlC({ input: 'c', name: 'c', ctrl: false }), false);
  assert.equal(isCtrlC({ input: 'a', name: 'a', ctrl: true }), false);
});
