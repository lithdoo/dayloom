const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createDayloomCoreInternal } = require('../dist/core');
const { resolvePackagedBoundaries } = require('../dist/promptpile/binaries');
const { runReact } = require('../dist/promptpile/react-runner');
const { archiveFixture } = require('./helpers');

const PROCESS_ID = `react_${'1'.repeat(32)}`;
const WORK_ID = `work_${'2'.repeat(32)}`;
const WORK_PATH = 'C:\\temp\\promptpile-react-session-test\\work';

function processPile(final = 'visible final') {
  return [
    { schema_version: 1, process_id: PROCESS_ID, sequence: 0, type: 'process.started', max_steps: 1, work_id: WORK_ID, work_path: WORK_PATH, work_lifecycle: 'cleanup' },
    { schema_version: 1, process_id: PROCESS_ID, sequence: 1, type: 'phase.started', phase: 'thought', step_index: 0 },
    { schema_version: 1, process_id: PROCESS_ID, sequence: 2, type: 'phase.delta', phase: 'thought', step_index: 0, channel: 'assistant_text', content: 'think' },
    { schema_version: 1, process_id: PROCESS_ID, sequence: 3, type: 'phase.completed', phase: 'thought', step_index: 0 },
    { schema_version: 1, process_id: PROCESS_ID, sequence: 4, type: 'phase.started', phase: 'observe', step_index: 0 },
    { schema_version: 1, process_id: PROCESS_ID, sequence: 5, type: 'phase.delta', phase: 'observe', step_index: 0, channel: 'assistant_text', content: 'observe' },
    { schema_version: 1, process_id: PROCESS_ID, sequence: 6, type: 'phase.completed', phase: 'observe', step_index: 0 },
    { schema_version: 1, process_id: PROCESS_ID, sequence: 7, type: 'phase.started', phase: 'check', step_index: 0 },
    { schema_version: 1, process_id: PROCESS_ID, sequence: 8, type: 'phase.delta', phase: 'check', step_index: 0, channel: 'assistant_text', content: 'check' },
    { schema_version: 1, process_id: PROCESS_ID, sequence: 9, type: 'phase.completed', phase: 'check', step_index: 0, continue: false },
    { schema_version: 1, process_id: PROCESS_ID, sequence: 10, type: 'work.ready', work_id: WORK_ID, work_path: WORK_PATH, status: 'checked' },
    { schema_version: 1, process_id: PROCESS_ID, sequence: 11, type: 'phase.started', phase: 'final' },
    { schema_version: 1, process_id: PROCESS_ID, sequence: 12, type: 'phase.delta', phase: 'final', channel: 'assistant_text', content: final },
    { schema_version: 1, process_id: PROCESS_ID, sequence: 13, type: 'phase.completed', phase: 'final' },
    { schema_version: 1, process_id: PROCESS_ID, sequence: 14, type: 'process.completed', stop_reason: 'final', steps_completed: 1, final: { status: 'completed', content: final } },
  ].map(JSON.stringify).join('\n') + '\n';
}

test('Process Pile v2 streams work and delays output.completed until child settlement', async () => {
  const boundaries = await resolvePackagedBoundaries();
  const stream = processPile('answer'); let release; const observed = [];
  const runner = { run: async (_bin, args, options) => new Promise((resolve) => {
    assert.equal(args.includes('--process-pile-fd'), true);
    assert.equal(args.includes('--work-root'), false);
    options.onExtraPipe(stream);
    release = () => resolve({ code: 0, stdout: 'ignored stdout', stderr: '' });
  }) };
  const running = runReact({
    runner, reactBin: 'react', validate: boundaries.validateAgentEvent, validateProcessPile: boundaries.validateProcessPile,
    eventProtocol: 'core-event-v2', config: 'c', context: 'x', conversation: 'y', observer: {
      workStarted: (path) => observed.push(['work.started', path]),
      workDelta: (phase, step, text) => observed.push(['work.delta', phase, step, text]),
      workCompleted: (path) => observed.push(['work.completed', path]),
      outputStarted: () => observed.push(['output.started']),
      outputDelta: (text) => observed.push(['output.delta', text]),
      outputCompleted: () => observed.push(['output.completed']),
    },
  });
  while (!release) await new Promise((resolve) => setImmediate(resolve));
  assert.equal(observed.some(([type]) => type === 'output.delta'), true);
  assert.equal(observed.some(([type]) => type === 'output.completed'), false);
  release(); assert.equal(await running, 'answer');
  assert.equal(observed.at(-1)[0], 'output.completed');
  assert.deepEqual(observed.filter(([type]) => type === 'work.delta').map((entry) => entry[1]), ['thought', 'observe', 'check']);
  assert.equal(observed.find(([type]) => type === 'work.started')[1], WORK_PATH);
});

class ProcessPileRunner {
  constructor(finals) { this.finals = [...finals]; this.calls = []; }
  async run(bin, args, options = {}) {
    this.calls.push({ bin, args: [...args] });
    if (args[0] === 'conversation') return { code: 0, stdout: '', stderr: '' };
    options.onExtraPipe(processPile(this.finals.shift() ?? 'answer'));
    return { code: 0, stdout: '', stderr: '' };
  }
}

test('CoreEvent v2 isolates consecutive operations and only forwards workPath as metadata', async (t) => {
  const fixture = archiveFixture(); t.after(fixture.cleanup);
  const before = fs.readFileSync(path.join(fixture.root, 'current.json'), 'utf8');
  const runner = new ProcessPileRunner(['first', 'second']);
  const core = await createDayloomCoreInternal(
    { worldRoot: fixture.root, llmConfigPath: fixture.config, eventProtocol: 'core-event-v2' },
    { runner, boundaries: await resolvePackagedBoundaries() },
  );
  t.after(() => core.dispose());
  const events = []; core.subscribe((event) => events.push(event));
  assert.deepEqual(await core.startSession('play'), { ok: true });
  assert.deepEqual(await core.send('one'), { ok: true });
  assert.deepEqual(await core.send('two'), { ok: true });
  const started = events.filter((event) => event.type === 'work.started');
  assert.equal(started.length, 2);
  assert.notEqual(started[0].operationId, started[1].operationId);
  assert.equal(started.every((event) => event.workPath === WORK_PATH), true);
  for (const operation of started) {
    const own = events.filter((event) => event.operationId === operation.operationId);
    assert.deepEqual(own.filter((event) => event.type === 'work.delta').map((event) => event.phase), ['thought', 'observe', 'check']);
    assert.equal(own.filter((event) => event.type === 'output.started').length, 1);
    assert.equal(own.filter((event) => event.type === 'output.completed').length, 1);
  }
  assert.equal(fs.readFileSync(path.join(fixture.root, 'current.json'), 'utf8'), before);
});

test('Process Pile validation failure fails closed and never completes output', async (t) => {
  const fixture = archiveFixture(); t.after(fixture.cleanup);
  const bad = processPile().replace('"sequence":2', '"sequence":3');
  const runner = { async run(_bin, args, options = {}) {
    if (args[0] === 'conversation') return { code: 0, stdout: '', stderr: '' };
    options.onExtraPipe(bad); return { code: 0, stdout: '', stderr: '' };
  } };
  const core = await createDayloomCoreInternal(
    { worldRoot: fixture.root, llmConfigPath: fixture.config, eventProtocol: 'core-event-v2' },
    { runner, boundaries: await resolvePackagedBoundaries() },
  );
  t.after(() => core.dispose()); const events = []; core.subscribe((event) => events.push(event));
  await core.startSession('play'); const result = await core.send('bad stream');
  assert.equal(result.error.code, 'AGENT_FAILED');
  assert.equal(events.filter((event) => event.type === 'work.failed').length, 1);
  assert.equal(events.some((event) => event.type === 'output.completed'), false);
  assert.equal(core.getState().session, null);
});

test('CoreEvent v2 cancel emits one terminal presentation event and suppresses late deltas', async (t) => {
  const fixture = archiveFixture(); t.after(fixture.cleanup);
  const lines = processPile('late final').split('\n'); let release;
  const runner = { async run(_bin, args, options = {}) {
    if (args[0] === 'conversation') return { code: 0, stdout: '', stderr: '' };
    options.onExtraPipe(`${lines.slice(0, 3).join('\n')}\n`);
    return new Promise((resolve) => { release = () => { options.onExtraPipe(`${lines.slice(3).join('\n')}`); resolve({ code: 0, stdout: '', stderr: '' }); }; });
  } };
  const core = await createDayloomCoreInternal(
    { worldRoot: fixture.root, llmConfigPath: fixture.config, eventProtocol: 'core-event-v2' },
    { runner, boundaries: await resolvePackagedBoundaries() },
  );
  t.after(() => core.dispose()); const events = []; core.subscribe((event) => events.push(event));
  await core.startSession('play'); const sending = core.send('cancel me');
  while (!release) await new Promise((resolve) => setImmediate(resolve));
  const cancelling = core.cancel(); release();
  assert.equal((await sending).error.code, 'CANCELLED');
  assert.deepEqual(await cancelling, { ok: true });
  assert.equal(events.filter((event) => event.type === 'work.failed' && event.status === 'cancelled').length, 1);
  assert.equal(events.some((event) => event.type === 'output.started'), false);
  assert.deepEqual(events.filter((event) => event.type === 'work.delta').map((event) => event.phase), ['thought']);
});
