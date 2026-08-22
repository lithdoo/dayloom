const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { rm } = require('node:fs/promises');
const { createDayloomCoreInternal } = require('../dist/core');
const { resolvePackagedBoundaries } = require('../dist/promptpile/binaries');
const { archiveFixture, eventStream, FakeRunner } = require('./helpers');

const turn = () => new Promise((resolve) => setImmediate(resolve));
async function waitFor(predicate) { while (!predicate()) await turn(); }

function blockedReactRunner({ finishOnKill = true } = {}) {
  let react;
  const runner = {
    async run(_bin, args, options = {}) {
      if (args[0] === 'conversation') return { code: 0, stdout: '', stderr: '' };
      return new Promise((resolve) => {
        let settled = false;
        const settle = (result) => { if (!settled) { settled = true; resolve(result); } };
        const child = {
          killed: false,
          kill() {
            this.killed = true;
            if (finishOnKill) settle({ code: 1, stdout: '', stderr: 'interrupted' });
          },
        };
        react = {
          child,
          options,
          get settled() { return settled; },
          fail: () => settle({ code: 1, stdout: '', stderr: 'failed' }),
          complete(content = 'done') {
            const stdout = eventStream(content);
            options.onStdout?.(stdout);
            settle({ code: 0, stdout, stderr: '' });
          },
          stream(raw) { options.onStdout?.(raw); },
        };
        options.onChild?.(child);
      });
    },
  };
  return { runner, get react() { return react; } };
}

async function setup(t, runner, internal = {}) {
  const fixture = archiveFixture();
  t.after(fixture.cleanup);
  const core = await createDayloomCoreInternal(
    { worldRoot: fixture.root, llmConfigPath: fixture.config },
    { runner, boundaries: await resolvePackagedBoundaries(), ...internal },
  );
  t.after(() => core.dispose());
  assert.deepEqual(await core.startSession('play'), { ok: true });
  return { core, fixture };
}

async function startBlockedSend(t, options) {
  const controlled = blockedReactRunner(options);
  const context = await setup(t, controlled.runner);
  const sending = context.core.send('hello');
  await waitFor(() => controlled.react);
  return { ...context, controlled, sending };
}

test('core2-running-session-exposes-cancel-capability', async (t) => {
  const { core, controlled, sending } = await startBlockedSend(t);
  assert.equal(core.getState().session.status, 'running');
  assert.equal(core.getState().capabilities.cancel, true);
  const cancelling = core.cancel();
  assert.equal(core.getState().capabilities.cancel, false);
  assert.equal((await sending).error.code, 'CANCELLED');
  assert.deepEqual(await cancelling, { ok: true });
  assert.equal(controlled.react.child.killed, true);
});

test('core2-running-cancel-linearizes-once', async (t) => {
  const { core, sending } = await startBlockedSend(t);
  const first = core.cancel();
  const second = core.cancel();
  assert.strictEqual(second, first);
  assert.equal((await sending).error.code, 'CANCELLED');
  assert.deepEqual(await first, { ok: true });
});

test('core2-running-cancel-intent-wins-send-completion-race', async (t) => {
  const { core, controlled, sending } = await startBlockedSend(t, { finishOnKill: false });
  const cancelling = core.cancel();
  controlled.react.complete('natural completion');
  assert.equal((await sending).error.code, 'CANCELLED');
  assert.deepEqual(await cancelling, { ok: true });
});

test('core2-running-cancel-kills-active-child', async (t) => {
  const { core, controlled, sending } = await startBlockedSend(t);
  const cancelling = core.cancel();
  assert.equal(controlled.react.child.killed, true);
  await sending; await cancelling;
});

test('core2-running-cancel-kills-child-started-after-intent', async (t) => {
  let sendAppend;
  const runner = {
    async run(_bin, args, options = {}) {
      if (args[0] !== 'conversation') throw new Error('React must not start.');
      if (!args[3].includes(`${path.sep}conversation`) || !sendAppend) {
        if (!sendAppend && args[3].includes(`${path.sep}conversation`)) {
          return new Promise((resolve) => { sendAppend = { options, resolve }; });
        }
        return { code: 0, stdout: '', stderr: '' };
      }
      return { code: 0, stdout: '', stderr: '' };
    },
  };
  const fixture = archiveFixture(); t.after(fixture.cleanup);
  const core = await createDayloomCoreInternal({ worldRoot: fixture.root, llmConfigPath: fixture.config }, { runner: new FakeRunner(), boundaries: await resolvePackagedBoundaries() });
  t.after(() => core.dispose());
  await core.startSession('play');
  core.runner = runner;
  const sending = core.send('hello');
  await waitFor(() => sendAppend);
  const cancelling = core.cancel();
  const child = { killed: false, kill() { this.killed = true; } };
  sendAppend.options.onChild?.(child);
  assert.equal(child.killed, true);
  sendAppend.resolve({ code: 1, stdout: '', stderr: 'interrupted' });
  assert.equal((await sending).error.code, 'CANCELLED');
  await cancelling;
});

test('core2-running-cancel-stops-future-output-delta', async (t) => {
  const { core, controlled, sending } = await startBlockedSend(t, { finishOnKill: false });
  const deltas = [];
  core.subscribe((event) => { if (event.type === 'output.delta') deltas.push(event.text); });
  const cancelling = core.cancel();
  controlled.react.complete('hidden');
  await sending; await cancelling;
  assert.deepEqual(deltas, []);
});

test('core2-interrupted-send-returns-cancelled', async (t) => {
  const { core, sending } = await startBlockedSend(t);
  const cancelling = core.cancel();
  assert.deepEqual(await sending, { ok: false, error: { code: 'CANCELLED', message: 'The active Session operation was cancelled.' } });
  await cancelling;
});

test('core2-interrupted-send-never-restores-ready', async (t) => {
  const { core, sending } = await startBlockedSend(t);
  const seen = [];
  core.subscribe((event) => { if (event.type === 'state.changed') seen.push(event.state.session?.status ?? null); });
  const cancelling = core.cancel();
  await sending; await cancelling;
  assert.equal(seen.includes('ready'), false);
  assert.equal(core.getState().session, null);
});

test('core2-interrupted-send-does-not-terminalize-independently', async (t) => {
  const controlled = blockedReactRunner({ finishOnKill: false });
  let sessionCleanupCount = 0;
  const remove = async (target, options) => {
    if (target.includes(`${path.sep}sessions${path.sep}`)) sessionCleanupCount += 1;
    return rm(target, options);
  };
  const { core } = await setup(t, controlled.runner, { remove });
  const sending = core.send('hello'); await waitFor(() => controlled.react);
  const cancelling = core.cancel();
  assert.equal(sessionCleanupCount, 0);
  controlled.react.complete();
  await sending; await cancelling;
  assert.equal(sessionCleanupCount, 1);
});

test('core2-running-cancel-leaves-world-unchanged', async (t) => {
  const { core, fixture, sending } = await startBlockedSend(t);
  const before = fs.readFileSync(path.join(fixture.root, 'current.json'), 'utf8');
  const cancelling = core.cancel(); await sending; await cancelling;
  assert.equal(fs.readFileSync(path.join(fixture.root, 'current.json'), 'utf8'), before);
});

test('core2-running-cancel-terminalizes-session-once', async (t) => {
  const controlled = blockedReactRunner(); let cleanups = 0;
  const remove = async (target, options) => {
    if (target.includes(`${path.sep}sessions${path.sep}`)) {
      assert.equal(controlled.react.settled, true, 'Session root removal must follow child settlement');
      cleanups += 1;
    }
    return rm(target, options);
  };
  const { core } = await setup(t, controlled.runner, { remove });
  const sending = core.send('hello'); await waitFor(() => controlled.react);
  const first = core.cancel(), second = core.cancel();
  await sending; await Promise.all([first, second]);
  assert.equal(cleanups, 1); assert.equal(core.getState().session, null);
});

test('core2-running-cancel-awaits-provider-drain', async (t) => {
  let summaryChild, releaseSummary;
  const runner = { async run(_bin, args, options = {}) {
    if (args[0] === 'conversation') {
      const directory = args[3];
      if (directory.endsWith(`${path.sep}conversation`)) {
        for (let index = 0; index < 6; index += 1) fs.writeFileSync(path.join(directory, `[${index}]turn.md`), 'x'.repeat(25_000));
      }
      return { code: 0, stdout: '', stderr: '' };
    }
    if (args[0] === '--config') {
      const child = { killed: false, kill() { this.killed = true; } };
      summaryChild = child; options.onChild?.(child);
      return new Promise((resolve) => { releaseSummary = resolve; });
    }
    throw new Error('React must not start.');
  } };
  const { core } = await setup(t, runner);
  const sending = core.send('hello'); await waitFor(() => summaryChild);
  let settled = false; const cancelling = core.cancel().finally(() => { settled = true; });
  await turn(); assert.equal(summaryChild.killed, true); assert.equal(settled, false);
  releaseSummary({ code: 1, stdout: '', stderr: 'interrupted' });
  assert.equal((await sending).error.code, 'CANCELLED'); await cancelling;
});

test('core2-running-cancel-cleanup-failure-does-not-resurrect-session', async (t) => {
  const controlled = blockedReactRunner();
  const remove = async (target, options) => {
    if (target.includes(`${path.sep}sessions${path.sep}`)) throw new Error('cleanup failed');
    return rm(target, options);
  };
  const { core } = await setup(t, controlled.runner, { remove });
  const sending = core.send('hello'); await waitFor(() => controlled.react);
  const cancelling = core.cancel(); await sending;
  assert.equal((await cancelling).error.code, 'INTERNAL_ERROR');
  assert.equal(core.getState().session, null);
});

test('core2-repeated-running-cancel-joins-one-terminal-intent', async (t) => {
  const { core, sending } = await startBlockedSend(t);
  const promises = [core.cancel(), core.cancel(), core.cancel()];
  assert.strictEqual(promises[0], promises[1]); assert.strictEqual(promises[1], promises[2]);
  await sending; assert.deepEqual(await Promise.all(promises), [{ ok: true }, { ok: true }, { ok: true }]);
});

test('core2-interrupt-state-clears-after-terminal-outcome', async (t) => {
  const { core, sending } = await startBlockedSend(t);
  const cancelling = core.cancel(); await sending; await cancelling;
  assert.equal(core.cancelRequestedSessionId, null);
  assert.equal(core.interruptCancelPromise, null);
});

test('core2-new-session-is-not-affected-by-old-cancel-state', async (t) => {
  const { core, sending } = await startBlockedSend(t);
  const cancelling = core.cancel(); await sending; await cancelling;
  assert.deepEqual(await core.startSession('play'), { ok: true });
  assert.equal(core.getState().capabilities.send, true);
  assert.deepEqual(await core.cancel(), { ok: true });
});

test('core2-submitting-cancel-remains-unavailable', async (t) => {
  const controlled = blockedReactRunner(); const { core } = await setup(t, controlled.runner);
  const submitting = core.submit(); await waitFor(() => controlled.react);
  assert.equal(core.getState().session.status, 'submitting');
  assert.equal(core.getState().capabilities.cancel, false);
  assert.equal((await core.cancel()).error.code, 'BUSY');
  controlled.react.fail(); await submitting;
});

test('core2-dispose-awaits-pending-interrupt-cancel', async (t) => {
  const { core, controlled, sending } = await startBlockedSend(t, { finishOnKill: false });
  const cancelling = core.cancel(); let disposed = false;
  const disposal = core.dispose().then(() => { disposed = true; });
  await turn(); assert.equal(disposed, false);
  controlled.react.complete();
  await sending; await cancelling; await disposal;
  assert.equal(core.cancelRequestedSessionId, null);
  assert.equal(core.interruptCancelPromise, null);
});
