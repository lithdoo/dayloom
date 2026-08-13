const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { createDayloomCoreInternal } = require('../dist/core');
const { resolvePackagedBoundaries } = require('../dist/promptpile/binaries');
const { archiveFixture, FakeRunner } = require('./helpers');

test('play lifecycle keeps one writable Conversation, streams send, and publishes submit once', async (t) => {
  const fixture = archiveFixture(); t.after(fixture.cleanup);
  const submission = JSON.stringify({ version: 1, summary: 'A day', beats: [{ id: 'beat1', status: 'completed', eventId: 'event1' }], events: [{ id: 'event1', beatId: 'beat1', userInput: 'hello', assistantOutput: 'world' }] });
  const runner = new FakeRunner(['Visible response', submission]);
  const core = await createDayloomCoreInternal({ worldRoot: fixture.root, llmConfigPath: fixture.config }, { runner, boundaries: await resolvePackagedBoundaries() }); t.after(() => core.dispose());
  const originalCurrent = fs.readFileSync(`${fixture.root}/current.json`, 'utf8');
  const events = []; core.subscribe((event) => events.push(event));
  assert.deepEqual(await core.startSession('play'), { ok: true });
  assert.equal(fs.readFileSync(`${fixture.root}/current.json`, 'utf8'), originalCurrent);
  assert.deepEqual(await core.send('hello'), { ok: true });
  assert.equal(events.filter((event) => event.type === 'output.delta').map((event) => event.text).join(''), 'Visible response');
  assert.deepEqual(await core.submit(), { ok: true });
  assert.equal(core.getState().world.phase, 'awaiting-settle'); assert.equal(core.getState().world.revision, 2); assert.equal(core.getState().session, null);
  assert.equal(events.filter((event) => event.type === 'output.delta').some((event) => event.text.includes('version')), false);
  const conversationDirs = runner.calls.filter((call) => call.args[0] === 'conversation' && !call.stdin.startsWith('[DAYLOOM_PLAY_CONTEXT')).map((call) => call.args[call.args.indexOf('-d') + 1]);
  assert.equal(new Set(conversationDirs).size, 1);
});
test('listener failures are isolated and dispose is idempotent', async (t) => {
  const fixture = archiveFixture(); t.after(fixture.cleanup); const runner = new FakeRunner();
  const core = await createDayloomCoreInternal({ worldRoot: fixture.root, llmConfigPath: fixture.config }, { runner, boundaries: await resolvePackagedBoundaries() });
  let called = false; core.subscribe(() => { throw new Error('listener'); }); core.subscribe(() => { called = true; });
  await core.startSession('play'); assert.equal(called, true); await core.dispose(); await core.dispose();
  assert.equal((await core.cancel()).error.code, 'DISPOSED');
});
