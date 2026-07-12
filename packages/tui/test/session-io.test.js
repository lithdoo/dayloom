import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { InitCancelledError } from '@dayloom/core';
import { STREAM_THROTTLE_MS } from '../dist/components/constants.js';
import { createTuiSessionIO } from '../dist/session-io.js';
import { createViewModel } from '../dist/view-model.js';

function createHarness(worldDir = '.') {
  const vm = createViewModel({ worldDir, locale: 'en' });
  const io = createTuiSessionIO(vm);
  return { vm, io };
}

async function waitFor(predicate, timeoutMs = 1_000) {
  const started = Date.now();
  while (!predicate()) {
    if (Date.now() - started > timeoutMs) {
      throw new Error('Timed out waiting for condition');
    }
    await delay(5);
  }
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function submitWhenReady(vm, value) {
  await waitFor(() => vm.inputMode.get() === 'text');
  vm.inputValue.set(value);
  vm.submitTextInput();
}

async function answerConfirm(vm, answer) {
  await waitFor(() => vm.inputMode.get() === 'confirm');
  vm.submitConfirm(answer);
}

test('readInput returns trimmed non-empty text and clears input mode', async () => {
  const { vm, io } = createHarness();
  const pending = io.readInput({
    instruction: 'type a command',
    userPrompt: '> ',
    emptyBehavior: 'ignore',
  });

  await submitWhenReady(vm, '  /status  ');
  assert.equal(await pending, '/status');
  assert.equal(vm.inputMode.get(), 'hidden');
});

test('readInput echoes non-empty user input into message history', async () => {
  const { vm, io } = createHarness();
  const pending = io.readInput({
    instruction: 'type a command',
    userPrompt: '> ',
    emptyBehavior: 'ignore',
  });

  await submitWhenReady(vm, '  /status  ');
  assert.equal(await pending, '/status');

  const userMessages = vm.messages.get().filter((message) => message.role === 'user');
  assert.equal(userMessages.length, 1);
  assert.equal(userMessages[0].text, '/status');
  assert.equal(vm.stickToBottom.get(), true);
});

test('readInput emptyBehavior ignore returns undefined without user echo', async () => {
  const { vm, io } = createHarness();
  const pending = io.readInput({
    instruction: 'type a command',
    userPrompt: '> ',
    emptyBehavior: 'ignore',
  });

  await submitWhenReady(vm, '   ');
  assert.equal(await pending, undefined);
  assert.equal(vm.inputMode.get(), 'hidden');
  assert.equal(
    vm.messages.get().filter((message) => message.role === 'user').length,
    0,
  );
});

test('readInput preserves inner newlines after trim in user echo', async () => {
  const { vm, io } = createHarness();
  const pending = io.readInput({
    instruction: 'type a command',
    userPrompt: '> ',
    emptyBehavior: 'ignore',
  });

  await submitWhenReady(vm, '  hello\nworld  ');
  assert.equal(await pending, 'hello\nworld');

  const userMessages = vm.messages.get().filter((message) => message.role === 'user');
  assert.equal(userMessages.length, 1);
  assert.equal(userMessages[0].text, 'hello\nworld');
});

test('readInput echoes consecutive user commands in order', async () => {
  const { vm, io } = createHarness();

  const first = io.readInput({
    instruction: 'type a command',
    userPrompt: '> ',
    emptyBehavior: 'ignore',
  });
  await submitWhenReady(vm, '/status');
  assert.equal(await first, '/status');

  const second = io.readInput({
    instruction: 'type a command',
    userPrompt: '> ',
    emptyBehavior: 'ignore',
  });
  await submitWhenReady(vm, '/quit');
  assert.equal(await second, '/quit');

  const userTexts = vm.messages
    .get()
    .filter((message) => message.role === 'user')
    .map((message) => message.text);
  assert.deepEqual(userTexts, ['/status', '/quit']);
});

test('readInput emptyBehavior ask-exit confirms exit with InitCancelledError', async () => {
  const { vm, io } = createHarness();
  const pending = io.readInput({
    instruction: 'init',
    userPrompt: '> ',
    emptyBehavior: 'ask-exit',
  });

  await submitWhenReady(vm, '');
  await answerConfirm(vm, true);

  await assert.rejects(() => pending, (err) => err instanceof InitCancelledError);
  assert.equal(vm.inputMode.get(), 'hidden');
});

test('readInput emptyBehavior ask-exit declines then accepts next input', async () => {
  const { vm, io } = createHarness();
  const pending = io.readInput({
    instruction: 'init',
    userPrompt: '> ',
    emptyBehavior: 'ask-exit',
  });

  await submitWhenReady(vm, '');
  await answerConfirm(vm, false);
  await submitWhenReady(vm, 'continue');

  assert.equal(await pending, 'continue');
  assert.equal(vm.inputMode.get(), 'hidden');
  const userMessages = vm.messages.get().filter((message) => message.role === 'user');
  assert.equal(userMessages.length, 1);
  assert.equal(userMessages[0].text, 'continue');
});

test('readInput emptyBehavior ask-save-draft confirms save as undefined', async () => {
  const { vm, io } = createHarness();
  const pending = io.readInput({
    instruction: 'daily',
    userPrompt: '> ',
    emptyBehavior: 'ask-save-draft',
  });

  await submitWhenReady(vm, '');
  await answerConfirm(vm, true);

  assert.equal(await pending, undefined);
  assert.equal(vm.inputMode.get(), 'hidden');
});

test('readInput emptyBehavior ask-save-draft declines then accepts next input', async () => {
  const { vm, io } = createHarness();
  const pending = io.readInput({
    instruction: 'daily',
    userPrompt: '> ',
    emptyBehavior: 'ask-save-draft',
  });

  await submitWhenReady(vm, '');
  await answerConfirm(vm, false);
  await submitWhenReady(vm, 'keep going');

  assert.equal(await pending, 'keep going');
});

test('confirm resolves boolean answers', async () => {
  const { vm, io } = createHarness();
  const yes = io.confirm('Proceed?');
  await answerConfirm(vm, true);
  assert.equal(await yes, true);

  const no = io.confirm('Proceed again?');
  await answerConfirm(vm, false);
  assert.equal(await no, false);
  assert.equal(vm.inputMode.get(), 'hidden');
});

test('withLoading sets label, supports update, and clears afterward', async () => {
  const { vm, io } = createHarness();
  const labels = [];

  const result = await io.withLoading('working', async (loading) => {
    labels.push(vm.loadingLabel.get());
    loading.update('almost');
    labels.push(vm.loadingLabel.get());
    return 42;
  });

  assert.equal(result, 42);
  assert.deepEqual(labels, ['working', 'almost']);
  assert.equal(vm.loadingLabel.get(), null);
});

test('withLoading clears label when task throws', async () => {
  const { vm, io } = createHarness();

  await assert.rejects(
    () =>
      io.withLoading('boom', async () => {
        assert.equal(vm.loadingLabel.get(), 'boom');
        throw new Error('task failed');
      }),
    /task failed/,
  );
  assert.equal(vm.loadingLabel.get(), null);
});

test('write warn error append messages and flush stream first', async () => {
  const { vm, io } = createHarness();
  vm.appendStream('partial');
  io.write('done\n');
  io.warn('careful');
  io.error('bad');

  const roles = vm.messages.get().map((message) => message.role);
  const texts = vm.messages.get().map((message) => message.text);
  assert.deepEqual(roles, ['output', 'output', 'warn', 'error']);
  assert.ok(texts.includes('partial'));
  assert.ok(texts.includes('done'));
  assert.ok(texts.includes('careful'));
  assert.ok(texts.includes('bad'));
  assert.equal(vm.streamBuffer.get(), '');
});

test('createStreamWriter routes filtered chunks into stream buffer', async () => {
  const { vm, io } = createHarness();
  const writer = io.createStreamWriter({ hiddenBlocks: ['secret'] });
  writer.push('hello\n');
  writer.push('```secret\n');
  writer.push('hidden payload\n');
  writer.push('```\n');
  writer.push('world');
  writer.flush();

  await delay(STREAM_THROTTLE_MS + 20);

  assert.match(vm.streamBuffer.get(), /hello/);
  assert.match(vm.streamBuffer.get(), /world/);
  assert.doesNotMatch(vm.streamBuffer.get(), /hidden payload/);
});

test('refreshHeader uses inspectTuiHeader for a real world dir', async () => {
  const worldDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dayloom-tui-header-'));
  try {
    const { vm } = createHarness(worldDir);
    assert.match(vm.headerPrimary.get(), /World:/);
    assert.ok(Array.isArray(vm.headerActions.get()));
  } finally {
    fs.rmSync(worldDir, { recursive: true, force: true });
  }
});
