import assert from 'node:assert/strict';
import test from 'node:test';

import { STREAM_THROTTLE_MS } from '../dist/components/constants.js';
import { createViewModel } from '../dist/view-model.js';

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

test('appendStream publishes leading chunk immediately and enables stickToBottom', () => {
  const vm = createViewModel({ worldDir: '.' });
  vm.setStickToBottom(false);

  vm.appendStream('hello');

  assert.equal(vm.streamBuffer.get(), 'hello');
  assert.equal(vm.stickToBottom.get(), true);
});

test('appendStream coalesces rapid chunks until throttle window ends', async () => {
  const vm = createViewModel({ worldDir: '.' });
  const updates = [];
  const unsubscribe = vm.streamBuffer.subscribe((value) => {
    updates.push(value);
  });

  vm.appendStream('a');
  vm.appendStream('b');
  vm.appendStream('c');

  assert.equal(vm.streamBuffer.get(), 'a');
  assert.deepEqual(updates, ['a']);

  await delay(STREAM_THROTTLE_MS + 20);

  assert.equal(vm.streamBuffer.get(), 'abc');
  assert.deepEqual(updates, ['a', 'abc']);
  unsubscribe();
});

test('flushStream publishes pending chunks immediately into messages', async () => {
  const vm = createViewModel({ worldDir: '.' });

  vm.appendStream('one');
  vm.appendStream('two');
  assert.equal(vm.streamBuffer.get(), 'one');

  vm.flushStream();

  assert.equal(vm.streamBuffer.get(), '');
  assert.deepEqual(
    vm.messages.get().map((message) => message.text),
    ['onetwo'],
  );

  // Trailing timer must not resurrect flushed content.
  await delay(STREAM_THROTTLE_MS + 20);
  assert.equal(vm.streamBuffer.get(), '');
  assert.equal(vm.messages.get().length, 1);
});

test('empty appendStream chunks are ignored', () => {
  const vm = createViewModel({ worldDir: '.' });
  vm.appendStream('');
  assert.equal(vm.streamBuffer.get(), '');
});
