const { test } = require('node:test');
const assert = require('node:assert/strict');
const { handleShellCommand } = require('../../dist/shell/routing.js');

test('handleShellCommand quit returns without throwing', async () => {
  const writes = [];
  const io = {
    write: (text) => writes.push(text),
    warn: () => {},
    error: () => {},
    createStreamWriter: () => ({ push() {}, flush() {} }),
    readInput: async () => undefined,
    confirm: async () => true,
    withLoading: async (_, task) => task({ update() {} }),
  };

  await handleShellCommand(
    { kind: 'shell-command', command: 'quit', raw: '/quit' },
    {
      worldDir: '/tmp/world',
      actionOpts: { io },
      t: (key) => key,
    },
  );
  assert.equal(writes.length, 0);
});

test('parseShellWaitInput distinguishes status from shell commands', () => {
  const { parseShellWaitInput } = require('../../dist/shell/routing.js');
  assert.equal(parseShellWaitInput('/status'), 'status');
  assert.equal(parseShellWaitInput('/help'), 'help');
  assert.equal(parseShellWaitInput('/revise'), 'revise');
  assert.equal(parseShellWaitInput('/next'), 'next');
  assert.equal(parseShellWaitInput('/quit'), 'quit');
  assert.equal(parseShellWaitInput('hello'), undefined);
});
