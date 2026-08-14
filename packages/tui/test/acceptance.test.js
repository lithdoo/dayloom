import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import { ScriptedDayloomCore, deferred, failure, published, success } from './support/scripted-core.mjs';

async function driverFor(core) {
  const { createRuntimeDriverFromCoreForTest } = await import('../dist/runtime-driver/create-runtime-driver-from-core-for-test.js');
  return createRuntimeDriverFromCoreForTest({ worldRoot: path.resolve('acceptance-world'), core });
}

test('tui Hub failure clears busy state and reconciles refreshed WORLD_CONFLICT truth', async () => {
  const refreshed = published({ revision: 9, commitId: 'winner', phase: 'idle', day: null });
  const core = new ScriptedDayloomCore({
    world: published({ phase: 'awaiting-settle', day: 'day1' }),
    handlers: { async settle(instance) { instance.world = refreshed; instance.changed(); return failure('WORLD_CONFLICT', 'another writer won'); } },
  });
  const driver = await driverFor(core); await driver.runHubAction('settle');
  assert.deepEqual(driver.getState().page, { kind: 'hub', mode: 'status', busy: null });
  assert.equal(driver.getState().world.revision, 9); assert.equal(driver.getState().world.commitId, 'winner');
  assert.deepEqual(driver.getState().recent, { kind: 'failed', label: '结算失败', detail: 'another writer won' });
  await driver.dispose();
});

test('tui-old-request-cannot-mutate-new-session and stale delta is ignored', async () => {
  const oldSend = deferred();
  const core = new ScriptedDayloomCore({ handlers: {
    async send(instance) {
      const oldId = instance.session.id; instance.session = { ...instance.session, status: 'running' }; instance.changed();
      await oldSend.promise; instance.delta(oldId, 'stale'); return failure('CANCELLED', 'cancelled');
    },
    async cancel(instance) { instance.session = null; instance.changed(); return success(); },
  } });
  const driver = await driverFor(core); await driver.runHubAction('init');
  const sending = driver.submitSessionText('old'); await waitFor(() => driver.getState().session.status === 'running');
  await driver.submitSessionText('/cancel'); assert.equal(driver.getState().page.kind, 'hub');
  await driver.runHubAction('init'); const newId = driver.getState().session.id;
  oldSend.resolve(); await sending;
  assert.equal(driver.getState().session.id, newId); assert.equal(driver.getState().page.kind, 'session');
  assert.equal(driver.getState().messages.some((message) => message.text.includes('stale')), false);
  await driver.dispose();
});

test('tui transcript evicts whole old messages and never truncates current streaming output', async () => {
  const streamGate = deferred(); const huge = 'x'.repeat(260_000);
  const core = new ScriptedDayloomCore({ handlers: { async send(instance) {
    const id = instance.session.id; instance.session = { ...instance.session, status: 'running' }; instance.changed();
    instance.delta(id, huge); await streamGate.promise;
    instance.session = { ...instance.session, status: 'ready' }; instance.changed(); return success();
  } } });
  const driver = await driverFor(core); await driver.runHubAction('init');
  const sending = driver.submitSessionText('hello'); await waitFor(() => driver.getState().messages.some((message) => message.status === 'streaming'));
  const streaming = driver.getState().messages.find((message) => message.status === 'streaming');
  assert.equal(streaming.text.length, huge.length); assert.equal(streaming.text, huge);
  streamGate.resolve(); await sending;
  assert.equal(driver.getState().messages.at(-1).text.length, huge.length);
  await driver.dispose();
});

test('tui submitting disables every Session control', async () => {
  const gate = deferred();
  const core = new ScriptedDayloomCore({ handlers: { async submit(instance) {
    instance.session = { ...instance.session, status: 'submitting' }; instance.changed(); await gate.promise;
    instance.session = null; instance.changed(); return success();
  } } });
  const driver = await driverFor(core); await driver.runHubAction('init');
  const submitting = driver.submitSessionText('/submit'); await waitFor(() => driver.getState().session.status === 'submitting');
  assert.deepEqual(driver.getState().sessionControls, { input: false, submit: false, cancel: false, dismiss: false });
  gate.resolve(); await submitting; await driver.dispose();
});

test('tui status/help remain local and contain current Core2 terminology', async () => {
  const core = new ScriptedDayloomCore({ world: published({ revision: 3, phase: 'planned', day: 'day1' }) });
  const driver = await driverFor(core); const { createViewModel } = await import('../dist/index.js'); const vm = createViewModel(driver);
  driver.setHubMode('help'); assert.match(vm.visibleMessages.get()[0].text, /AI 回复中仍可用/);
  driver.setHubMode('status'); const status = vm.visibleMessages.get()[0].text;
  assert.match(status, /Revision: 3/); assert.match(status, /Phase: 已计划 \(planned\)/);
  assert.deepEqual(core.calls.filter((call) => !['dispose'].includes(call[0])), []);
  await vm.dispose();
});

test('tui cancel cleanup error with terminal Core does not resurrect Session', async () => {
  const core = new ScriptedDayloomCore({ handlers: { async cancel(instance) {
    instance.session = null; instance.changed(); return failure('INTERNAL_ERROR', 'cleanup residue');
  } } });
  const driver = await driverFor(core); await driver.runHubAction('init'); await driver.submitSessionText('/cancel');
  assert.equal(driver.getState().page.kind, 'hub'); assert.equal(driver.getState().session, null);
  assert.deepEqual(driver.getState().recent, { kind: 'failed', label: '取消会话失败', detail: 'cleanup residue' });
  await driver.dispose();
});

test('tui composed lifecycle reaches day2 planned through the public Core2 contract', async () => {
  const core = new ScriptedDayloomCore({ sendScript: [{ deltas: ['init reply'] }, { deltas: ['play one'] }, { deltas: ['play two'] }] });
  const driver = await driverFor(core);
  await driver.runHubAction('init'); await driver.submitSessionText('world idea'); await driver.submitSessionText('/submit');
  assert.equal(driver.getState().world.phase, 'idle');
  await driver.runHubAction('daily'); await driver.submitSessionText('/submit');
  assert.equal(driver.getState().world.phase, 'planned'); assert.equal(driver.getState().world.day, 'day1');
  await driver.runHubAction('play'); await driver.submitSessionText('first action'); await driver.submitSessionText('second action'); await driver.submitSessionText('/submit');
  assert.equal(driver.getState().world.phase, 'awaiting-settle');
  await driver.runHubAction('settle');
  assert.equal(driver.getState().world.phase, 'idle'); assert.equal(driver.getState().world.lastSettledDay, 'day1');
  await driver.runHubAction('revise'); await driver.submitSessionText('/submit');
  assert.equal(driver.getState().world.phase, 'idle');
  await driver.runHubAction('daily'); await driver.submitSessionText('/submit');
  assert.equal(driver.getState().world.phase, 'planned'); assert.equal(driver.getState().world.day, 'day2');
  await driver.dispose();
});

test('tui clean CI orders protocol then core2 then tui and has a required Ubuntu PTY job', () => {
  const workflow = fs.readFileSync(path.resolve(import.meta.dirname, '../../..', '.github/workflows/tui.yml'), 'utf8');
  const protocol = workflow.indexOf('npm run build -w @dayloom/archive-protocol');
  const core2 = workflow.indexOf('npm test -w @dayloom/core2', protocol);
  const tui = workflow.indexOf('npm test -w @dayloom/tui', core2);
  assert.ok(protocol >= 0 && protocol < core2 && core2 < tui);
  assert.match(workflow, /os: \[ubuntu-latest, windows-latest\]/);
  assert.match(workflow, /node: \[20, 22\]/);
  assert.match(workflow, /required-pty:[\s\S]*DAYLOOM_TUI_REQUIRE_PTY: '1'/);
});

async function waitFor(predicate, timeoutMs = 1000) {
  const started = Date.now();
  while (!predicate()) {
    if (Date.now() - started > timeoutMs) throw new Error('Timed out.');
    await new Promise((resolve) => setTimeout(resolve, 2));
  }
}
