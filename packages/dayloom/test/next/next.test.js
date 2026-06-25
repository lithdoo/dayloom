const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { formatNextStatus, inspectNextState } = require('../../dist/next/index.js');

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'dayloom-next-'));
}

function createWorld(phase) {
  const root = tempDir();
  fs.writeFileSync(path.join(root, 'manifest.yaml'), 'id: test_world\n', 'utf8');
  fs.writeFileSync(path.join(root, 'current.yaml'), `day: day_0001\nphase: ${phase}\nlast_committed_day: null\n`, 'utf8');
  return root;
}

test('inspectNextState maps missing manifest to init', () => {
  const root = tempDir();
  try {
    const state = inspectNextState(root);
    assert.equal(state.kind, 'uninitialized');
    assert.equal(state.action, 'init');
    assert.match(formatNextStatus(state), /Next action: init/);
    assert.match(formatNextStatus(state), /dayloom init -d /);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('inspectNextState maps current phases to next actions', () => {
  const cases = [
    ['idle', 'daily'],
    ['planned', 'play'],
    ['playing', 'play'],
    ['settling', 'settle'],
  ];

  for (const [phase, action] of cases) {
    const root = createWorld(phase);
    try {
      const state = inspectNextState(root);
      assert.equal(state.kind, 'initialized');
      assert.equal(state.phase, phase);
      assert.equal(state.action, action);
      const status = formatNextStatus(state);
      assert.match(status, new RegExp(`Current: day_0001 / phase=${phase}`));
      assert.match(status, new RegExp(`Next action: ${action}`));
      assert.match(status, new RegExp(`dayloom ${action} -d `));
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  }
});

test('inspectNextState rejects unsupported phases', () => {
  const root = createWorld('archived');
  try {
    assert.throws(() => inspectNextState(root), /Unsupported current phase/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
