const test = require('node:test');
const assert = require('node:assert/strict');
const { resolvePackagedBoundaries } = require('../dist/promptpile/binaries');
const { runReact } = require('../dist/promptpile/react-runner');

const PROCESS_ID = `react_${'1'.repeat(32)}`;
const WORK_ID = `work_${'2'.repeat(32)}`;
const WORK_PATH = 'C:\\temp\\promptpile-react-session-test\\work';

function continuationPile(steps, final = 'continued final') {
  const events = [{ schema_version: 1, process_id: PROCESS_ID, type: 'process.started', max_steps: steps.length, work_id: WORK_ID, work_path: WORK_PATH, work_lifecycle: 'cleanup' }];
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
    { schema_version: 1, process_id: PROCESS_ID, type: 'work.ready', work_id: WORK_ID, work_path: WORK_PATH, status: 'checked' },
    { schema_version: 1, process_id: PROCESS_ID, type: 'phase.started', phase: 'final' },
    { schema_version: 1, process_id: PROCESS_ID, type: 'phase.delta', phase: 'final', channel: 'assistant_text', content: final },
    { schema_version: 1, process_id: PROCESS_ID, type: 'phase.completed', phase: 'final' },
    { schema_version: 1, process_id: PROCESS_ID, type: 'process.completed', stop_reason: last.continue ? 'max_step' : 'final', steps_completed: steps.length, final: { status: 'completed', content: final } },
  );
  return events.map((event, sequence) => JSON.stringify({ ...event, sequence })).join('\n') + '\n';
}

async function runContinuationPile(stream, observer) {
  const boundaries = await resolvePackagedBoundaries();
  return runReact({
    runner: { async run(_bin, _args, options) { options.onExtraPipe(stream); return { code: 0, stdout: '', stderr: '' }; } },
    reactBin: 'react', validateProcessPile: boundaries.validateProcessPile,
    config: 'c', context: 'x', conversation: 'y', observer,
  });
}

test('Process Pile v1 projects one operation stream in protocol order', async () => {
  const observed = [];
  const answer = await runContinuationPile(continuationPile([{ unresolved: '<none>', next: '<none>', continue: false }], 'answer'), {
    workStarted: (workPath) => observed.push(['work.started', workPath]),
    workDelta: (phase) => observed.push(['work.delta', phase]),
    workCompleted: () => observed.push(['work.completed']),
    outputStarted: () => observed.push(['output.started']),
    outputDelta: (text) => observed.push(['output.delta', text]),
    outputCompleted: () => observed.push(['output.completed']),
  });
  assert.equal(answer, 'answer');
  assert.equal(observed[0][0], 'work.started');
  assert.equal(observed[0][1], WORK_PATH);
  assert.deepEqual(observed.filter(([type]) => type === 'work.delta').map((entry) => entry[1]), ['thought', 'observe', 'check']);
  assert.equal(observed.at(-1)[0], 'output.completed');
});

test('structured Check decision is the sole loop control and Observe prose is opaque', async () => {
  const stream = continuationPile([
    { unresolved: 'work remains', next: 'arbitrary natural-language plan', continue: true },
    { unresolved: '<none>', next: '<none>', continue: false },
  ]);
  assert.equal(await runContinuationPile(stream), 'continued final');
});
