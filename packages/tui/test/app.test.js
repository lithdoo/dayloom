import assert from 'node:assert/strict';
import test from 'node:test';
import path from 'node:path';
import { ScriptedDayloomCore } from './support/scripted-core.mjs';

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

test('Hub/Session autofocus follows presentation page transitions', async () => {
  const { mountAutofocus } = await import('../dist/app.js');
  const { HUB_SELECT_ID, TEXTAREA_ID } = await import('../dist/components/constants.js');
  const { createRuntimeDriverFromCoreForTest } = await import('../dist/runtime-driver/create-runtime-driver-from-core-for-test.js');
  const { createViewModel } = await import('../dist/view-model.js');
  const core = new ScriptedDayloomCore();
  const driver = createRuntimeDriverFromCoreForTest({ worldRoot: path.resolve('focus-world'), core });
  const vm = createViewModel(driver); const scheduled = [], focused = [];
  const stop = mountAutofocus(vm, { focus(id) { focused.push(id); return { handled: true, dirtyNodes: [] }; } }, (callback) => scheduled.push(callback));
  drain(scheduled); assert.equal(focused.at(-1), HUB_SELECT_ID);
  await driver.runHubAction('init'); drain(scheduled); assert.equal(focused.at(-1), TEXTAREA_ID);
  await driver.submitSessionText('/exit'); drain(scheduled); assert.equal(focused.at(-1), HUB_SELECT_ID);
  stop(); await vm.dispose();
});

function drain(callbacks) { while (callbacks.length) callbacks.shift()(); }
