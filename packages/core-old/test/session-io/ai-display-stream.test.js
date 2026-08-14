const { test } = require('node:test');
const assert = require('node:assert/strict');

const {
  createAiDisplayStream,
  runWithAiDisplayStream,
} = require('../../dist/session-io/ai-display-stream.js');

function createIoHarness() {
  const calls = [];
  const io = {
    write(text) {
      calls.push(['write', text]);
    },
    warn(text) {
      calls.push(['warn', text]);
    },
    error(text) {
      calls.push(['error', text]);
    },
    createStreamWriter(options) {
      calls.push(['createStreamWriter', options]);
      return {
        push(text) {
          calls.push(['push', text]);
        },
        flush() {
          calls.push(['flush']);
        },
      };
    },
    readInput() {
      throw new Error('not implemented');
    },
    confirm() {
      throw new Error('not implemented');
    },
    withLoading(_label, task) {
      return task({ update() {} });
    },
  };
  return { io, calls };
}

test('createAiDisplayStream routes deltas through SessionIO stream writer', () => {
  const { io, calls } = createIoHarness();
  const stream = createAiDisplayStream(io, {
    hiddenBlocks: ['daily-status'],
  });

  stream.push('hello');
  stream.flush();

  assert.deepEqual(calls, [
    ['createStreamWriter', { hiddenBlocks: ['daily-status'] }],
    ['push', 'hello'],
    ['flush'],
  ]);
});

test('runWithAiDisplayStream flushes after task completion', async () => {
  const { io, calls } = createIoHarness();

  const result = await runWithAiDisplayStream(
    io,
    { hiddenBlocks: ['init-status'] },
    async (stream) => {
      stream.push('chunk');
      return 'ok';
    },
  );

  assert.equal(result, 'ok');
  assert.deepEqual(calls, [
    ['createStreamWriter', { hiddenBlocks: ['init-status'] }],
    ['push', 'chunk'],
    ['flush'],
  ]);
});
