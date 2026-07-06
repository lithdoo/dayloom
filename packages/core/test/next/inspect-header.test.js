const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { inspectTuiHeader } = require('../../dist/next/index.js');

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'dayloom-header-'));
}

test('inspectTuiHeader returns uninitialized snapshot', () => {
  const root = tempDir();
  try {
    const snapshot = inspectTuiHeader(root);
    assert.equal(snapshot.worldRoot, path.resolve(root));
    assert.deepEqual(snapshot.suggestedActions, []);
    assert.equal(snapshot.day, undefined);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('inspectTuiHeader returns day and phase for idle world', () => {
  const root = tempDir();
  try {
    fs.writeFileSync(path.join(root, 'manifest.yaml'), 'id: test_world\n', 'utf8');
    fs.writeFileSync(path.join(root, 'current.yaml'), 'day: day_0001\nphase: idle\nlast_committed_day: null\n', 'utf8');
    const snapshot = inspectTuiHeader(root);
    assert.equal(snapshot.day, 'day_0001');
    assert.equal(snapshot.phase, 'idle');
    assert.equal(snapshot.eventTitle, undefined);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('inspectTuiHeader includes active event title and suggested actions', () => {
  const root = tempDir();
  const dayRoot = path.join(root, 'days', 'day_0001');
  const eventDir = path.join(dayRoot, 'events', 'event_001');
  try {
    fs.mkdirSync(eventDir, { recursive: true });
    fs.writeFileSync(path.join(root, 'manifest.yaml'), 'id: test_world\n', 'utf8');
    fs.writeFileSync(path.join(root, 'current.yaml'), 'day: day_0001\nphase: playing\nlast_committed_day: null\n', 'utf8');
    fs.writeFileSync(path.join(dayRoot, 'play.state.json'), JSON.stringify({
      version: 1,
      day: 'day_0001',
      phase: 'playing',
      next_event_number: 2,
      active_event: 'event_001',
      active_beat: 'beat_01',
      step: 'waiting_user',
      completed_events: [],
    }, null, 2));
    fs.writeFileSync(path.join(eventDir, 'event.json'), JSON.stringify({
      id: 'event_001',
      source_beat: 'beat_01',
      title: 'Morning coffee',
      opening: 'open',
      situation: 'sit',
      suggested_actions: ['Order espresso', 'Leave'],
    }, null, 2));

    const snapshot = inspectTuiHeader(root);
    assert.equal(snapshot.phase, 'playing');
    assert.equal(snapshot.eventTitle, 'Morning coffee');
    assert.deepEqual(snapshot.suggestedActions, ['Order espresso', 'Leave']);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
