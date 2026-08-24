import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
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

test('appendMessage ignores pure whitespace after newline normalization', () => {
  const vm = createViewModel({ worldDir: '.' });

  vm.appendMessage('output', '\n');
  vm.appendMessage('output', '\r\n\r\n');
  vm.appendMessage('output', '\nhello\nworld\n');

  assert.deepEqual(
    vm.messages.get().map((message) => message.text),
    ['hello\nworld'],
  );
});

test('appendMessage merges consecutive display output without merging boundaries', () => {
  const vm = createViewModel({ worldDir: '.' });

  vm.appendMessage('output', 'first line\n');
  vm.appendMessage('output', 'second line');
  vm.appendMessage('user', 'choice');
  vm.appendMessage('output', 'after user');
  vm.appendMessage('system', 'tip');
  vm.appendMessage('system', 'another tip');
  vm.appendMessage('warn', 'careful');
  vm.appendMessage('warn', 'still careful');

  assert.deepEqual(
    vm.messages.get().map((message) => [message.role, message.text]),
    [
      ['output', 'first line\nsecond line'],
      ['user', 'choice'],
      ['output', 'after user'],
      ['system', 'tip'],
      ['system', 'another tip'],
      ['warn', 'careful\nstill careful'],
    ],
  );
});

test('refreshHeader exposes suggested actions without appending messages', () => {
  const worldDir = createPlayingWorld();
  try {
    const vm = createViewModel({ worldDir, locale: 'zh' });

    assert.deepEqual(vm.headerActions.get(), ['Order espresso', 'Leave']);
    assert.deepEqual(vm.messages.get(), []);

    vm.refreshHeader();
    assert.equal(vm.messages.get().length, 0);

    writeEvent(worldDir, ['Leave']);
    vm.refreshHeader();
    assert.deepEqual(vm.headerActions.get(), ['Leave']);
    assert.equal(vm.messages.get().length, 0);

    writeEvent(worldDir, []);
    vm.refreshHeader();
    assert.equal(vm.messages.get().length, 0);
    assert.deepEqual(vm.headerActions.get(), []);
  } finally {
    fs.rmSync(worldDir, { recursive: true, force: true });
  }
});

function createPlayingWorld() {
  const worldDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dayloom-tui-old-actions-'));
  const dayRoot = path.join(worldDir, 'days', 'day_0001');
  fs.mkdirSync(path.join(dayRoot, 'events', 'event_001'), { recursive: true });
  fs.writeFileSync(path.join(worldDir, 'manifest.yaml'), 'id: test_world\n', 'utf8');
  fs.writeFileSync(
    path.join(worldDir, 'current.yaml'),
    'day: day_0001\nphase: playing\nlast_committed_day: null\n',
    'utf8',
  );
  fs.writeFileSync(
    path.join(dayRoot, 'play.state.json'),
    JSON.stringify(
      {
        version: 1,
        day: 'day_0001',
        phase: 'playing',
        next_event_number: 2,
        active_event: 'event_001',
        active_beat: 'beat_01',
        step: 'waiting_user',
        completed_events: [],
      },
      null,
      2,
    ),
    'utf8',
  );
  writeEvent(worldDir, ['Order espresso', 'Leave']);
  return worldDir;
}

function writeEvent(worldDir, suggestedActions) {
  const eventDir = path.join(worldDir, 'days', 'day_0001', 'events', 'event_001');
  fs.writeFileSync(
    path.join(eventDir, 'event.json'),
    JSON.stringify(
      {
        id: 'event_001',
        source_beat: 'beat_01',
        title: 'Morning coffee',
        opening: 'open',
        situation: 'sit',
        suggested_actions: suggestedActions,
      },
      null,
      2,
    ),
    'utf8',
  );
}
