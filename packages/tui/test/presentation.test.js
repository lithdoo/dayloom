import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { ScriptedDayloomCore, deferred, failure, success } from './support/scripted-core.mjs';

const reducerModule = new URL('../dist/runtime-driver/presentation-reducer.js', import.meta.url);
const driverModule = new URL('../dist/runtime-driver/create-runtime-driver-from-core-for-test.js', import.meta.url);

const base = () => ({ items: [], operation: { sessionId: 'session-1', operationId: null, closed: false } });
const started = { type: 'work.started', sessionId: 'session-1', operationId: 'operation-1', workPath: 'C:\\temp\\work-1' };

test('presentation reducer keeps work separate, folds its body to a path, then streams an independent Final', async () => {
  const { reducePresentation, isWorking } = await import(reducerModule);
  let state = reducePresentation(base(), started);
  for (const [phase, text] of [['thought', '思考'], ['observe', '观察'], ['check', '检查']]) {
    state = reducePresentation(state, { type: 'work.delta', sessionId: 'session-1', operationId: 'operation-1', phase, stepIndex: 0, text });
  }
  assert.equal(state.items.length, 1); assert.equal(state.items[0].text, '思考观察检查'); assert.equal(state.items[0].phase, 'check');
  state = reducePresentation(state, { type: 'work.completed', sessionId: 'session-1', operationId: 'operation-1', workPath: started.workPath });
  assert.deepEqual({ status: state.items[0].status, text: state.items[0].text, pathStatus: state.items[0].pathStatus }, { status: 'completed', text: '', pathStatus: 'live' });
  state = reducePresentation(state, { type: 'output.started', sessionId: 'session-1', operationId: 'operation-1', messageId: 'message-1' });
  state = reducePresentation(state, { type: 'output.delta', sessionId: 'session-1', operationId: 'operation-1', messageId: 'message-1', text: '最终回答' });
  state = reducePresentation(state, { type: 'output.completed', sessionId: 'session-1', operationId: 'operation-1', messageId: 'message-1' });
  assert.equal(state.items.filter(isWorking).length, 1);
  assert.deepEqual(state.items.map((item) => [item.id, item.status]), [[`operation:session-1:operation-1`, 'completed'], ['message-1', 'complete']]);
  assert.equal(state.items[0].pathStatus, 'expired'); assert.equal(state.items[1].text, '最终回答'); assert.equal(state.operation.closed, true);
});

test('presentation reducer caps work memory and ignores duplicate, foreign, and terminal-late events', async () => {
  const { reducePresentation } = await import(reducerModule);
  let state = reducePresentation(base(), started);
  state = reducePresentation(state, { type: 'work.delta', sessionId: 'session-1', operationId: 'operation-1', phase: 'thought', stepIndex: 0, text: 'x'.repeat(70_000) });
  assert.equal(state.items[0].text.length, 64_000); assert.equal(state.items[0].truncated, true);
  const duplicate = reducePresentation(state, started); assert.strictEqual(duplicate, state);
  const foreign = reducePresentation(state, { type: 'work.delta', sessionId: 'session-1', operationId: 'other', phase: 'thought', stepIndex: 0, text: 'foreign' });
  assert.strictEqual(foreign, state);
  state = reducePresentation(state, { type: 'work.failed', sessionId: 'session-1', operationId: 'operation-1', status: 'cancelled', message: 'cancelled', workPath: started.workPath });
  const late = reducePresentation(state, { type: 'work.delta', sessionId: 'session-1', operationId: 'operation-1', phase: 'observe', stepIndex: 0, text: 'late' });
  assert.strictEqual(late, state); assert.deepEqual({ status: state.items[0].status, detail: state.items[0].detail, text: state.items[0].text }, { status: 'cancelled', detail: '工作过程已取消', text: '' });
});

test('presentation reducer closes a completed work item on pre-Final failure and rejects invalid or duplicate Final starts', async () => {
  const { reducePresentation } = await import(reducerModule);
  let state = reducePresentation(base(), started);
  const earlyFinal = reducePresentation(state, { type: 'output.started', sessionId: 'session-1', operationId: 'operation-1', messageId: 'early' });
  assert.strictEqual(earlyFinal, state);
  state = reducePresentation(state, { type: 'work.completed', sessionId: 'session-1', operationId: 'operation-1', workPath: started.workPath });
  state = reducePresentation(state, { type: 'output.started', sessionId: 'session-1', operationId: 'operation-1', messageId: 'message-1' });
  const duplicateFinal = reducePresentation(state, { type: 'output.started', sessionId: 'session-1', operationId: 'operation-1', messageId: 'message-2' });
  assert.strictEqual(duplicateFinal, state);

  let failed = reducePresentation(base(), started);
  failed = reducePresentation(failed, { type: 'work.completed', sessionId: 'session-1', operationId: 'operation-1', workPath: started.workPath });
  failed = reducePresentation(failed, { type: 'work.failed', sessionId: 'session-1', operationId: 'operation-1', status: 'failed', message: 'transport failed', workPath: started.workPath });
  assert.deepEqual({ status: failed.items[0].status, pathStatus: failed.items[0].pathStatus, detail: failed.items[0].detail, closed: failed.operation.closed }, { status: 'failed', pathStatus: 'expired', detail: 'transport failed', closed: true });
});

test('driver exposes ordered presentation while formal messages exclude temporary work', async () => {
  const core = new ScriptedDayloomCore({ handlers: { async send(instance) {
    const id = instance.session.id; instance.session = { ...instance.session, status: 'running' }; instance.changed();
    instance.work(id, 'thought', '临时推理'); instance.work(id, 'observe', '临时观察'); instance.delta(id, '正式回答');
    instance.session = { ...instance.session, status: 'ready' }; instance.changed(); return success();
  } } });
  const { createRuntimeDriverFromCoreForTest } = await import(driverModule);
  const driver = createRuntimeDriverFromCoreForTest({ worldRoot: path.resolve('presentation-world'), core });
  await driver.runHubAction('init'); await driver.submitSessionText('你好');
  const state = driver.getState();
  assert.equal(state.messages.some((message) => message.text.includes('临时')), false);
  assert.deepEqual(state.presentationItems.slice(-2).map((item) => ['kind' in item ? item.kind : item.role, item.status]), [['working', 'completed'], ['assistant', 'complete']]);
  assert.equal(state.presentationItems.at(-2).pathStatus, 'expired'); assert.equal(state.presentationItems.at(-1).text, '正式回答');
  await driver.dispose();
});

test('hidden work visibility consumes lifecycle without retaining process text', async () => {
  const core = new ScriptedDayloomCore({ handlers: { async send(instance) {
    const id = instance.session.id; instance.session = { ...instance.session, status: 'running' }; instance.changed();
    instance.work(id, 'thought', '不得显示'); instance.delta(id, 'Final');
    instance.session = { ...instance.session, status: 'ready' }; instance.changed(); return success();
  } } });
  const { createRuntimeDriverFromCoreForTest } = await import(driverModule);
  const driver = createRuntimeDriverFromCoreForTest({ worldRoot: path.resolve('hidden-world'), core, workVisibility: 'hidden' });
  await driver.runHubAction('init'); await driver.submitSessionText('你好');
  const working = driver.getState().presentationItems.find((item) => 'kind' in item);
  assert.equal(working.text, ''); assert.equal(working.status, 'completed'); assert.equal(driver.getState().messages.at(-1).text, 'Final');
  await driver.dispose();
});

test('cancel rejection preserves events received while cancellation is pending', async () => {
  const sendGate = deferred(), cancelGate = deferred();
  const core = new ScriptedDayloomCore({ handlers: {
    async send(instance) {
      const id = instance.session.id; instance.session = { ...instance.session, status: 'running' }; instance.changed();
      instance.work(id, 'thought', '过程'); instance.delta(id, 'before'); await sendGate.promise;
      instance.delta(id, ' during'); instance.session = { ...instance.session, status: 'ready' }; instance.changed(); return success();
    },
    async cancel() { await cancelGate.promise; return failure('INTERNAL_ERROR', 'cancel rejected'); },
  } });
  const { createRuntimeDriverFromCoreForTest } = await import(driverModule);
  const driver = createRuntimeDriverFromCoreForTest({ worldRoot: path.resolve('cancel-race-world'), core });
  await driver.runHubAction('init'); const sending = driver.submitSessionText('你好');
  while (driver.getState().session.status !== 'running') await new Promise((resolve) => setImmediate(resolve));
  const cancelling = driver.submitSessionText('/cancel'); sendGate.resolve();
  while (driver.getState().messages.at(-1)?.text !== 'before during') await new Promise((resolve) => setImmediate(resolve));
  cancelGate.resolve(); await cancelling; await sending;
  assert.equal(driver.getState().messages.some((message) => message.role === 'assistant' && message.text === 'before during' && message.status === 'complete'), true);
  assert.equal(driver.getState().session.status, 'ready');
  await driver.dispose();
});
