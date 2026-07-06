const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { runGameShell } = require('../../dist/shell/index.js');

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'dayloom-shell-'));
}

function createWorld(phase) {
  const root = tempDir();
  fs.writeFileSync(path.join(root, 'manifest.yaml'), 'id: test_world\n', 'utf8');
  fs.writeFileSync(path.join(root, 'current.yaml'), `day: day_0001\nphase: ${phase}\nlast_committed_day: null\n`, 'utf8');
  return root;
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

test('runGameShell /status writes world overview', async () => {
  const root = createWorld('idle');
  const writes = [];
  const io = createMockIO(['/status', '/quit'], writes);
  try {
    await runGameShell({ worldDir: root, io });
    const output = writes.join('');
    assert.match(output, /Next action: daily/);
    assert.match(output, /phase=idle/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('runGameShell /help lists shell commands', async () => {
  const root = tempDir();
  const writes = [];
  const io = createMockIO(['/help', '/quit'], writes);
  try {
    await runGameShell({ worldDir: root, io });
    const output = writes.join('');
    assert.match(output, /\/status/);
    assert.match(output, /\/next/);
    assert.match(output, /\/revise/);
    assert.match(output, /\/quit/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('runGameShell unknown input writes unknown command message', async () => {
  const root = tempDir();
  const writes = [];
  const io = createMockIO(['hello', '/quit'], writes);
  try {
    await runGameShell({ worldDir: root, io });
    assert.match(writes.join(''), /Unknown shell command: hello/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('runGameShell /next with quick init initializes world', async () => {
  const root = tempDir();
  const writes = [];
  const io = createMockIO(['/next', '/quit'], writes);
  try {
    await runGameShell({ worldDir: root, io, quick: true });
    assert.ok(fs.existsSync(path.join(root, 'manifest.yaml')));
    assert.match(writes.join(''), /Initialized World save:/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('runGameShell autoStart runs recommended action before prompt', async () => {
  const root = tempDir();
  const writes = [];
  const io = createMockIO(['/quit'], writes);
  try {
    await runGameShell({ worldDir: root, io, quick: true, autoStart: true });
    assert.ok(fs.existsSync(path.join(root, 'manifest.yaml')));
    assert.match(writes.join(''), /Initialized World save:/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
