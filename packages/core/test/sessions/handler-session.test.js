const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  MessageStore,
  createDayloomRuntime,
  createHandlerSessionFactory,
} = require('../../dist/index.js');
const {
  chunks,
  waitFor,
} = require('../helpers/baseline.js');

test('handler session connects non-interactive business handlers to runtime', async (t) => {
  const events = [];
  const store = new MessageStore();
  const worldRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'dayloom-handler-session-'));
  t.after(() => fs.rmSync(worldRoot, { recursive: true, force: true }));
  const runtime = await createDayloomRuntime({
    worldRoot,
    sessionFactory: createHandlerSessionFactory((kind) => ({
      start: async (_context, emit) => {
        emit.system(`started:${kind}`);
      },
      sendInput: async (input, _context, emit, signal) => {
        await emit.stream('handler-assistant', chunks([`echo:${input.text}`]), signal);
      },
      submit: async () => ({
        kind: 'init',
        world: { id: 'handler-world', title: 'Handler World' },
        canon: { premise: '', rules: '', style: '', userRole: '' },
      }),
    })),
  });
  runtime.subscribe((event) => {
    events.push(event);
    if (event.type === 'message-added') {
      store.applySessionEvent(event.message.sessionId, {
        type: 'message-added',
        message: event.message,
      });
    }
    if (
      event.type === 'assistant-message-start' ||
      event.type === 'assistant-message-delta' ||
      event.type === 'assistant-message-end' ||
      event.type === 'assistant-message-error'
    ) {
      store.applySessionEvent(event.sessionId, event);
    }
  });

  let result = await runtime.executeCommand({ command: 'init' });
  assert.equal(result.ok, true);
  result = await runtime.sendInput({ text: 'hello' });
  assert.equal(result.ok, true);
  await waitFor(() => runtime.getSnapshot().session.status === 'waiting-input');

  const sessionId = runtime.getSnapshot().session.id;
  assert.equal(
    store.getMessages(sessionId).some((message) => message.text === 'echo:hello' && message.status === 'complete'),
    true,
  );

  result = await runtime.executeCommand({ command: 'submit' });
  assert.equal(result.ok, true);
  assert.equal(runtime.getSnapshot().world.phase, 'idle');
  assert.equal(events.some((event) => event.type === 'session-ended' && event.status === 'completed'), true);
  await runtime.dispose();
});

test('handler session reports failed business handlers', async (t) => {
  const worldRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'dayloom-handler-failure-'));
  t.after(() => fs.rmSync(worldRoot, { recursive: true, force: true }));
  const runtime = await createDayloomRuntime({
    worldRoot,
    sessionFactory: createHandlerSessionFactory(() => ({
      sendInput: async () => {
        throw new Error('business failed');
      },
      submit: async () => ({}),
    })),
  });

  await runtime.executeCommand({ command: 'init' });
  const result = await runtime.sendInput({ text: 'boom' });

  assert.equal(result.ok, true);
  await waitFor(() => runtime.getSnapshot().session.status === 'failed');
  assert.equal(runtime.getSnapshot().session.error.message, 'business failed');
  await runtime.dispose();
});
