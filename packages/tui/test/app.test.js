import assert from 'node:assert/strict';
import test from 'node:test';

import { isCtrlC, mountInputAutofocus } from '../dist/app.js';
import { CONFIRM_ID, TEXTAREA_ID } from '../dist/components/constants.js';
import { createViewModel } from '../dist/view-model.js';

test('isCtrlC matches legacy control sequence and kitty-style ctrl+c', () => {
  assert.equal(isCtrlC({ input: 'c', name: 'c', ctrl: true }), true);
  assert.equal(isCtrlC({ input: '\x03', name: 'c', ctrl: true }), true);
  assert.equal(isCtrlC({ input: 'c', ctrl: true }), true);
  assert.equal(isCtrlC({ input: 'c', name: 'c', ctrl: false }), false);
  assert.equal(isCtrlC({ input: 'a', name: 'a', ctrl: true }), false);
});

test('mountInputAutofocus focuses Textarea and confirm after input mode changes', () => {
  const vm = createViewModel({ worldDir: process.cwd() });
  const focused = [];
  const scheduled = [];
  const dispose = mountInputAutofocus(
    vm,
    {
      focus(target) {
        focused.push(target);
        return { handled: true, dirtyNodes: [] };
      },
    },
    (callback) => scheduled.push(callback),
  );

  vm.inputMode.set('text');
  assert.deepEqual(focused, []);
  scheduled.shift()();
  assert.deepEqual(focused, [TEXTAREA_ID]);

  vm.inputMode.set('confirm');
  scheduled.shift()();
  assert.deepEqual(focused, [TEXTAREA_ID, CONFIRM_ID]);

  dispose();
});

test('mountInputAutofocus ignores repeated modes and cancels pending focus on dispose', () => {
  const vm = createViewModel({ worldDir: process.cwd() });
  const focused = [];
  const scheduled = [];
  const dispose = mountInputAutofocus(
    vm,
    {
      focus(target) {
        focused.push(target);
        return { handled: true, dirtyNodes: [] };
      },
    },
    (callback) => scheduled.push(callback),
  );

  vm.inputMode.set('text');
  scheduled.shift()();
  assert.deepEqual(focused, [TEXTAREA_ID]);

  vm.inputMode.set('text');
  assert.equal(scheduled.length, 0);

  vm.inputMode.set('confirm');
  assert.equal(scheduled.length, 1);
  dispose();
  scheduled.shift()();
  assert.deepEqual(focused, [TEXTAREA_ID]);
});
