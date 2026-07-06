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

function createSettlingWorld() {
  const root = tempDir();
  const dayRoot = path.join(root, 'days', 'day_0001');
  fs.mkdirSync(path.join(dayRoot, 'events', 'event_001'), { recursive: true });
  fs.mkdirSync(path.join(root, 'logs'), { recursive: true });
  fs.mkdirSync(path.join(root, 'state'), { recursive: true });
  fs.mkdirSync(path.join(root, 'memory'), { recursive: true });
  fs.mkdirSync(path.join(root, 'characters', 'char_alice'), { recursive: true });
  fs.writeFileSync(path.join(root, 'manifest.yaml'), 'id: test_world\n');
  fs.writeFileSync(path.join(root, 'current.yaml'), 'day: day_0001\nphase: settling\nlast_committed_day: null\n');
  fs.writeFileSync(path.join(dayRoot, 'meta.yaml'), 'day: day_0001\nphase: settling\n');
  fs.writeFileSync(path.join(dayRoot, 'plan.current.json'), JSON.stringify({
    day: 'day_0001',
    user_intent: 'test',
    revision: 1,
    max_events: 1,
    beats: [{ id: 'beat_01', intent: 'finish', priority: 'required', status: 'completed' }],
  }, null, 2));
  fs.writeFileSync(path.join(dayRoot, 'play.state.json'), JSON.stringify({
    version: 1,
    day: 'day_0001',
    phase: 'settling',
    next_event_number: 2,
    active_event: null,
    active_beat: null,
    step: 'complete',
    completed_events: ['event_001'],
  }, null, 2));
  fs.writeFileSync(path.join(dayRoot, 'events', 'event_001', 'result.json'), '{}\n');
  fs.writeFileSync(path.join(root, 'state', 'variables.yaml'), 'water: running\n');
  fs.writeFileSync(path.join(root, 'state', 'world.yaml'), 'weather: clear\n');
  fs.writeFileSync(path.join(root, 'state', 'calendar.yaml'), 'day: 1\n');
  fs.writeFileSync(path.join(root, 'state', 'progress.yaml'), 'chapter: 1\n');
  fs.writeFileSync(path.join(root, 'memory', 'facts.yaml'), 'facts: []\n');
  fs.writeFileSync(path.join(root, 'memory', 'important_events.yaml'), 'events: []\n');
  fs.writeFileSync(path.join(root, 'memory', 'unresolved_threads.yaml'), 'threads: []\n');
  fs.writeFileSync(path.join(root, 'memory', 'short_term.md'), '# Recent\n');
  fs.writeFileSync(path.join(root, 'characters', 'char_alice', 'timeline.md'), '# Timeline\n');
  return root;
}

test('runGameShell recovers from session errors and returns to shell', async () => {
  const root = createSettlingWorld();
  const writes = [];
  const errors = [];
  const previousKey = process.env.DEEPSEEK_API_KEY;
  delete process.env.DEEPSEEK_API_KEY;
  const io = {
    write: (text) => writes.push(text),
    warn: () => {},
    error: (text) => errors.push(text),
    createStreamWriter: () => ({ push() {}, flush() {} }),
    readInput: (() => {
      let index = 0;
      return async () => ['/next', '/quit'][index++];
    })(),
    confirm: async () => true,
    withLoading: async (_, task) => task({ update() {} }),
  };
  try {
    await runGameShell({ worldDir: root, io });
    assert.ok(errors.some((line) => line.includes('DEEPSEEK_API_KEY')));
  } finally {
    if (previousKey === undefined) delete process.env.DEEPSEEK_API_KEY;
    else process.env.DEEPSEEK_API_KEY = previousKey;
    fs.rmSync(root, { recursive: true, force: true });
  }
});
