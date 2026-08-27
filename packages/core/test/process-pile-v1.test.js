const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { resolvePackagedBoundaries } = require('../dist/promptpile/binaries');
const { runReact } = require('../dist/promptpile/react-runner');

const PROCESS_ID = `react_${'1'.repeat(32)}`;
const WORK_ID = `work_${'2'.repeat(32)}`;
function continuationPile(steps, workPath, final = 'continued final') {
  const events = [{ schema_version: 1, process_id: PROCESS_ID, type: 'process.started', max_steps: steps.length, work_id: WORK_ID, work_path: workPath, work_lifecycle: 'caller' }];
  for (const [stepIndex, step] of steps.entries()) {
    events.push(
      { schema_version: 1, process_id: PROCESS_ID, type: 'phase.started', phase: 'thought', step_index: stepIndex },
      { schema_version: 1, process_id: PROCESS_ID, type: 'phase.delta', phase: 'thought', step_index: stepIndex, channel: 'assistant_text', content: `think-${stepIndex}` },
      { schema_version: 1, process_id: PROCESS_ID, type: 'phase.completed', phase: 'thought', step_index: stepIndex },
      { schema_version: 1, process_id: PROCESS_ID, type: 'phase.started', phase: 'observe', step_index: stepIndex },
      { schema_version: 1, process_id: PROCESS_ID, type: 'phase.delta', phase: 'observe', step_index: stepIndex, channel: 'assistant_text', content: `[EVIDENCE]\n<none>\n[UNRESOLVED]\n${step.unresolved}\n[NEXT_TOOL_ACTION]\n${step.next}` },
      { schema_version: 1, process_id: PROCESS_ID, type: 'phase.completed', phase: 'observe', step_index: stepIndex },
      { schema_version: 1, process_id: PROCESS_ID, type: 'phase.started', phase: 'check', step_index: stepIndex },
      { schema_version: 1, process_id: PROCESS_ID, type: 'phase.delta', phase: 'check', step_index: stepIndex, channel: 'assistant_text', content: `check-${stepIndex}` },
      { schema_version: 1, process_id: PROCESS_ID, type: 'phase.completed', phase: 'check', step_index: stepIndex, continue: step.continue },
    );
  }
  const last = steps.at(-1);
  events.push(
    { schema_version: 1, process_id: PROCESS_ID, type: 'work.ready', work_id: WORK_ID, work_path: workPath, status: 'checked' },
    { schema_version: 1, process_id: PROCESS_ID, type: 'phase.started', phase: 'final' },
    { schema_version: 1, process_id: PROCESS_ID, type: 'phase.delta', phase: 'final', channel: 'assistant_text', content: final },
    { schema_version: 1, process_id: PROCESS_ID, type: 'phase.completed', phase: 'final' },
    { schema_version: 1, process_id: PROCESS_ID, type: 'process.completed', stop_reason: last.continue ? 'max_step' : 'final', steps_completed: steps.length, final: { status: 'completed', content: final } },
  );
  return events.map((event, sequence) => JSON.stringify({ ...event, sequence })).join('\n') + '\n';
}

async function runContinuationPile(stream, observer, assertBeforeFinal) {
  const boundaries = await resolvePackagedBoundaries();
  const operationRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'react-runner-'));
  const workRoot = path.join(operationRoot, 'react-work');
  const workPath = path.join(workRoot, 'session', 'work');
  const pile = typeof stream === 'function' ? stream(workPath) : stream;
  try {
    return await runReact({
      runner: { async run(_bin, args, options) {
        assert.deepEqual(args.slice(args.indexOf('--work-root'), args.indexOf('--work-root') + 4), ['--work-root', workRoot, '--work-lifecycle', 'caller']);
        fs.mkdirSync(workPath, { recursive: true });
        options.onExtraPipe(pile);
        return { code: 0, stdout: '', stderr: '' };
      } },
      reactBin: 'react', validateProcessPile: boundaries.validateProcessPile,
      config: path.join(operationRoot, 'react', 'config.toml'), context: 'x', conversation: 'y', workRoot, observer, assertBeforeFinal,
    });
  } finally {
    assert.equal(fs.existsSync(workRoot), false);
    fs.rmSync(operationRoot, { recursive: true, force: true });
  }
}

test('Process Pile v1 projects one operation stream in protocol order', async () => {
  const observed = [];
  const answer = await runContinuationPile((workPath)=>continuationPile([{ unresolved: '<none>', next: '<none>', continue: false }], workPath, 'answer'), {
    workStarted: (workPath) => observed.push(['work.started', workPath]),
    workDelta: (phase) => observed.push(['work.delta', phase]),
    workCompleted: () => observed.push(['work.completed']),
    outputStarted: () => observed.push(['output.started']),
    outputDelta: (text) => observed.push(['output.delta', text]),
    outputCompleted: () => observed.push(['output.completed']),
  });
  assert.equal(answer, 'answer');
  assert.equal(observed[0][0], 'work.started');
  assert.match(observed[0][1], /session[\\/]work$/);
  assert.deepEqual(observed.filter(([type]) => type === 'work.delta').map((entry) => entry[1]), ['thought', 'observe', 'check']);
  assert.equal(observed.at(-1)[0], 'output.completed');
});

test('structured Check decision is the sole loop control and Observe prose is opaque', async () => {
  const stream = (workPath)=>continuationPile([
    { unresolved: 'work remains', next: 'arbitrary natural-language plan', continue: true },
    { unresolved: '<none>', next: '<none>', continue: false },
  ],workPath);
  assert.equal(await runContinuationPile(stream), 'continued final');
});

test('caller-owned work remains readable through the final gate and is then cleaned', async () => {
  let checked = false;
  await runContinuationPile(
    (workPath) => continuationPile([{ unresolved: '<none>', next: '<none>', continue: false }], workPath),
    undefined,
    (workPath) => {
      assert.equal(fs.statSync(workPath).isDirectory(), true);
      checked = true;
    },
  );
  assert.equal(checked, true);
});

test('Process Pile rejects a work path outside the operation-owned root', async () => {
  await assert.rejects(
    runContinuationPile((workPath) => continuationPile(
      [{ unresolved: '<none>', next: '<none>', continue: false }],
      path.join(path.dirname(path.dirname(path.dirname(workPath))), 'foreign-work'),
    )),
    /work ownership is invalid/,
  );
});
