import assert from 'node:assert/strict';
import test from 'node:test';
import { InitCancelledError } from '@dayloom/core';
import { createTuiSessionIO } from '../dist/session-io.js';
import { createViewModel } from '../dist/view-model.js';

test('readInput returns trimmed text without parsing slash commands', async () => {
  const vm = createViewModel({ worldDir: '.' });
  const io = createTuiSessionIO(vm);
  const promise = io.readInput({
    instruction: 'instruction',
    userPrompt: '>',
    emptyBehavior: 'ignore',
  });

  assert.equal(vm.inputMode.get(), 'text');
  vm.inputValue.set('  /revise now  ');
  vm.submitTextInput();

  assert.equal(await promise, '/revise now');
});

test('readInput ignore returns undefined for empty text', async () => {
  const vm = createViewModel({ worldDir: '.' });
  const io = createTuiSessionIO(vm);
  const promise = io.readInput({
    instruction: 'instruction',
    userPrompt: '>',
    emptyBehavior: 'ignore',
  });

  vm.inputValue.set('   ');
  vm.submitTextInput();

  assert.equal(await promise, undefined);
});

test('readInput ask-save-draft asks confirm before returning undefined', async () => {
  const vm = createViewModel({ worldDir: '.' });
  const io = createTuiSessionIO(vm);
  const promise = io.readInput({
    instruction: 'instruction',
    userPrompt: '>',
    emptyBehavior: 'ask-save-draft',
  });

  vm.inputValue.set('');
  vm.submitTextInput();
  await Promise.resolve();
  assert.equal(vm.inputMode.get(), 'confirm');
  vm.submitConfirm(true);

  assert.equal(await promise, undefined);
});

test('readInput ask-exit throws InitCancelledError when confirmed', async () => {
  const vm = createViewModel({ worldDir: '.' });
  const io = createTuiSessionIO(vm);
  const promise = io.readInput({
    instruction: 'instruction',
    userPrompt: '>',
    emptyBehavior: 'ask-exit',
  });

  vm.inputValue.set('');
  vm.submitTextInput();
  await Promise.resolve();
  assert.equal(vm.inputMode.get(), 'confirm');
  vm.submitConfirm(true);

  await assert.rejects(promise, InitCancelledError);
});

test('withLoading sets and clears loading label', async () => {
  const vm = createViewModel({ worldDir: '.' });
  const io = createTuiSessionIO(vm);

  const result = await io.withLoading('first', async (loading) => {
    assert.equal(vm.loadingLabel.get(), 'first');
    loading.update('second');
    assert.equal(vm.loadingLabel.get(), 'second');
    return 42;
  });

  assert.equal(result, 42);
  assert.equal(vm.loadingLabel.get(), null);
});
