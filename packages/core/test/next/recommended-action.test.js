const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { runRecommendedAction } = require('../../dist/next/recommended-action.js');
const { runNext } = require('../../dist/next/index.js');

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'dayloom-next-action-'));
}

function createMockIO(inputs, writes = []) {
  let i = 0;
  return {
    write: (text) => writes.push(text),
    warn: () => {},
    error: () => {},
    createStreamWriter: () => ({ push() {}, flush() {} }),
    readInput: async () => inputs[i++],
    confirm: async () => true,
    withLoading: async (_, task) => task({ update() {} }),
  };
}

test('runRecommendedAction quick init completes uninitialized world', async () => {
  const root = tempDir();
  const writes = [];
  const io = createMockIO([], writes);
  try {
    const exit = await runRecommendedAction(
      { kind: 'uninitialized', worldRoot: root, action: 'init' },
      { io, quick: true },
    );
    assert.equal(exit.kind, 'completed');
    assert.equal(exit.result.worldRoot, path.resolve(root));
    assert.ok(fs.existsSync(path.join(root, 'manifest.yaml')));
    assert.match(writes.join(''), /Initialized World save:/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('runNext statusOnly does not execute recommended action', async () => {
  const root = tempDir();
  const writes = [];
  const io = createMockIO([], writes);
  try {
    const result = await runNext(root, { io, statusOnly: true });
    assert.equal(result.executed, false);
    assert.equal(result.action, 'init');
    assert.match(writes.join(''), /Next action: init/);
    assert.equal(result.exit, undefined);
    assert.equal(fs.existsSync(path.join(root, 'manifest.yaml')), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
