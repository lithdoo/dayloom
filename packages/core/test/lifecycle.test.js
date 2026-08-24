const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createDayloomCoreInternal } = require('../dist/core');
const { resolvePackagedBoundaries } = require('../dist/promptpile/binaries');
const { archiveFixture, eventStream, FakeRunner } = require('./helpers');

function nextConversationIndex(directory) {
  const indices = fs.readdirSync(directory).map((name) => /^\[(\d+)\]/.exec(name)).filter(Boolean).map((match) => Number(match[1]));
  return indices.length === 0 ? 0 : Math.max(...indices) + 1;
}

test('play lifecycle keeps one writable Conversation, streams send, and publishes submit once', async (t) => {
  const fixture = archiveFixture(); t.after(fixture.cleanup);
  const submission = JSON.stringify({ version: 2, events: [{ beatId: 'beat1', title: 'A day', locationId: null, participantIds: [], scene: 'world', dialogue: '', userAction: 'hello', result: { summary: 'A day', learnedFacts: [], timeAdvanced: null, completedBeatIds: ['beat1'], skippedBeatIds: [], endDay: true }, proposedPatch: [] }] });
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
  assert.equal(events.filter((event) => event.type === 'output.delta').some((event) => event.text.includes('version')), true);
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

test('compressed multi-turn send continues and submit publishes while summary output stays private', async (t) => {
  const fixture = archiveFixture(); t.after(fixture.cleanup); const boundaries = await resolvePackagedBoundaries();
  const submission = JSON.stringify({ version: 2, events: [{ beatId: 'beat1', title: 'Compressed day', locationId: null, participantIds: [], scene: 'Done', dialogue: '', userAction: 'Act', result: { summary: 'Compressed day', learnedFacts: [], timeAdvanced: null, completedBeatIds: ['beat1'], skippedBeatIds: [], endDay: true }, proposedPatch: [] }] });
  const finals = ['First visible', 'Second visible', submission], summaryRequests = []; let conversationAppends = 0, reactCalls = 0;
  const runner = { async run(bin, args, options = {}) {
    if (args[0] === 'conversation') {
      const directory = args[3];
      if (directory.includes(`${path.sep}requests${path.sep}`)) {
        summaryRequests.push(JSON.parse(options.stdin));
      } else if (directory.endsWith(`${path.sep}conversation`)) {
        if (conversationAppends === 0) {
          for (let idx = 0; idx < 6; idx += 1) fs.writeFileSync(path.join(directory, `[${idx}]${idx % 2 ? 'assistant' : 'user'}.md`), 'history-' + 'x'.repeat(25_000));
        }
        const idx = nextConversationIndex(directory); fs.writeFileSync(path.join(directory, `[${idx}]user.md`), options.stdin); conversationAppends += 1;
      }
      return { code: 0, stdout: '', stderr: '' };
    }
    if (bin === boundaries.promptpileBin) {
      const sourceTurnIndices = [summaryRequests.at(-1).turns[0].idx];
      return { code: 0, stdout: JSON.stringify({ version: 1, goal: [{ text: 'PRIVATE-SUMMARY', sourceTurnIndices }], stableFacts: [], constraints: [], decisions: [], importantToolFindings: [], completedWork: [], unresolvedWork: [], failedApproaches: [], nextActions: [] }), stderr: '' };
    }
    reactCalls += 1; const final = finals.shift();
    const conversation = args[args.indexOf('--output-dir') + 1];
    assert.equal(fs.readdirSync(conversation).some((name) => name.startsWith('.promptpile-compress.lock')), false, 'React starts only after lifecycle lock release');
    if (reactCalls < 3) {
      const idx = nextConversationIndex(conversation);
      fs.writeFileSync(path.join(conversation, `[${idx}]assistant.md`), final);
    }
    options.onExtraPipe?.(eventStream(final)); return { code: 0, stdout: '', stderr: '' };
  } };
  const core = await createDayloomCoreInternal({ worldRoot: fixture.root, llmConfigPath: fixture.config }, { runner, boundaries }); t.after(() => core.dispose());
  const events = []; core.subscribe((event) => events.push(event));
  assert.deepEqual(await core.startSession('play'), { ok: true });
  assert.deepEqual(await core.send('first'), { ok: true }); assert.deepEqual(await core.send('second'), { ok: true });
  assert.equal(summaryRequests.length, 1, 'compact steady state does not repeat semantic summarization');
  assert.deepEqual(await core.submit(), { ok: true }); assert.equal(core.getState().world.revision, 2);
  const visible = events.filter((event) => event.type === 'output.delta').map((event) => event.text).join('');
  assert.equal(visible, `First visibleSecond visible${submission}`); assert.equal(visible.includes('PRIVATE-SUMMARY'), false);
});
