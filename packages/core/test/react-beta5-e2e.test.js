const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { createDayloomCoreInternal } = require('../dist/core');
const { resolvePackagedBoundaries } = require('../dist/promptpile/binaries');
const { appendUser, nodeProcessRunner } = require('../dist/promptpile/conversation');
const { readCallerConfig } = require('../dist/promptpile/config');
const { runReact } = require('../dist/promptpile/react-runner');
const { createPlayWorkspace, buildContextMessage } = require('../dist/session/play');
const { readPublishedWorld } = require('../dist/world/read');
const { archiveFixture } = require('./helpers');

const SECTIONS = ['SESSION', 'USER_INTENT', 'AUTHORITATIVE_FACTS', 'EXACT_IDS', 'DECISIONS', 'CONSTRAINTS', 'UNRESOLVED', 'FINAL_CONTRACT'];
const turn = () => new Promise((resolve) => setImmediate(resolve));
async function waitFor(predicate) { while (!predicate()) await turn(); }

function observeHandoff(invocation) {
  return `[SESSION]\nPlay invocation ${invocation}\n\n[USER_INTENT]\nContinue the requested Dayloom operation.\n\n[AUTHORITATIVE_FACTS]\nPinned context and writable history remain authoritative.\n\n[EXACT_IDS]\nworld1, day1, beat1\n\n[DECISIONS]\nUse the fixture Final for invocation ${invocation}.\n\n[CONSTRAINTS]\nDo not override schema, identifiers, or publication ownership.\n\n[UNRESOLVED]\n<none>\n\n[FINAL_CONTRACT]\nReturn the configured fixture response.`;
}

async function fixtureProvider(t, finals, options = {}) {
  const requests = [], held = [];
  const server = http.createServer((request, response) => {
    let body = '';
    request.setEncoding('utf8');
    request.on('data', (chunk) => { body += chunk; });
    request.on('end', () => {
      requests.push(JSON.parse(body));
      const requestNumber = requests.length;
      if (options.holdFirst && requestNumber === 1) { held.push(response); return; }
      respond(response, requestNumber, finals, options);
    });
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  t.after(async () => {
    for (const response of held.splice(0)) if (!response.writableEnded) respond(response, 1, finals, options);
    server.closeAllConnections?.();
    await new Promise((resolve) => server.close(resolve));
  });
  return {
    requests,
    baseUrl: `http://127.0.0.1:${server.address().port}/v1`,
    release() { for (const response of held.splice(0)) if (!response.writableEnded) respond(response, 1, finals, options); },
  };
}

function respond(response, requestNumber, finals, options = {}) {
  response.writeHead(200, { 'content-type': 'text/event-stream' });
  const phase = (requestNumber - 1) % 4;
  if (phase === 2) {
    const decision = options.checkDecision ?? false;
    response.end(`data: ${JSON.stringify({ choices: [{ delta: { ...(options.checkContent ? { content: options.checkContent } : {}), tool_calls: [{ index: 0, id: `check-${requestNumber}`, type: 'function', function: { name: 'react_check_decision', arguments: JSON.stringify({ decision }) } }] } }] })}\n\ndata: [DONE]\n\n`);
    return;
  }
  const invocation = Math.floor((requestNumber - 1) / 4) + 1;
  const content = phase === 0 ? `RAW_THOUGHT_${invocation}` : phase === 1 ? options.observeContent ?? observeHandoff(invocation) : finals[invocation - 1];
  const split = Math.max(1, Math.floor(content.length / 2));
  response.write(`data: ${JSON.stringify({ choices: [{ delta: { content: content.slice(0, split) } }] })}\n\n`);
  response.end(`data: ${JSON.stringify({ choices: [{ delta: { content: content.slice(split) } }] })}\n\ndata: [DONE]\n\n`);
}

function writeConfig(configPath, baseUrl) {
  fs.writeFileSync(configPath, [
    '[[llm_api]]',
    'name = "local"',
    'model = "fixture-model"',
    `base_url = "${baseUrl}"`,
    'api_key = "fixture-key"',
    '',
    '[promptpile]',
    'llm_api = "local"',
    '',
  ].join('\n'));
}

function snapshot(directory) {
  return fs.readdirSync(directory).sort().map((name) => [name, fs.readFileSync(path.join(directory, name), 'utf8')]);
}

test('real beta.5 isolates two consecutive Play sends and hands Observe to Final', { timeout: 20_000 }, async (t) => {
  const provider = await fixtureProvider(t, ['visible-final-1', 'visible-final-2']);
  const archive = archiveFixture(); t.after(archive.cleanup); writeConfig(archive.config, provider.baseUrl);
  const runtime = fs.mkdtempSync(path.join(os.tmpdir(), 'core-react-beta5-')); t.after(() => fs.rmSync(runtime, { recursive: true, force: true }));
  const boundaries = await resolvePackagedBoundaries();
  const world = await readPublishedWorld(archive.root), config = await readCallerConfig(archive.config);
  const session = await createPlayWorkspace(runtime, 'play', world, config);
  await appendUser(nodeProcessRunner, boundaries.promptpileBin, session.contextDir, buildContextMessage(world));
  const contextBefore = snapshot(session.contextDir);

  for (const [input, expected] of [['first turn', 'visible-final-1'], ['second turn', 'visible-final-2']]) {
    await appendUser(nodeProcessRunner, boundaries.promptpileBin, session.conversationDir, input);
    let workPath;
    assert.equal(await runReact({
      runner: nodeProcessRunner,
      reactBin: boundaries.reactBin,
      validateProcessPile: boundaries.validateProcessPile,
      config: session.sendConfig,
      context: session.contextDir,
      conversation: session.conversationDir,
      observer: { workStarted(path) { workPath = path; } },
    }), expected);
    assert.ok(workPath);
    assert.equal(fs.existsSync(workPath), false);
  }

  assert.equal(provider.requests.length, 8);
  for (const requestIndex of [0, 4]) {
    const thoughtMessages = provider.requests[requestIndex].messages;
    assert.equal(thoughtMessages.some((message) => message.content.includes('[DAYLOOM_PLAY_CONTEXT_V1]')), true);
    const observeMessages = provider.requests[requestIndex + 1].messages;
    assert.equal(observeMessages.some((message) => message.role === 'assistant' && message.content === `RAW_THOUGHT_${requestIndex / 4 + 1}`), true);
    const finalMessages = provider.requests[requestIndex + 3].messages;
    assert.equal(finalMessages.at(-1).role, 'user');
    for (const section of SECTIONS) assert.equal(finalMessages.at(-1).content.includes(`[${section}]`), true);
    assert.equal(finalMessages.some((message) => /^RAW_THOUGHT_/.test(message.content)), false);
  }
  assert.equal(provider.requests[7].messages.some((message) => message.content === 'visible-final-1'), true);
  assert.deepEqual(snapshot(session.contextDir), contextBefore);
  assert.deepEqual(fs.readdirSync(session.conversationDir).sort(), ['[0]user.md', '[1]assistant.md', '[2]user.md', '[3]assistant.md']);
  for (const [, content] of snapshot(session.conversationDir)) {
    assert.doesNotMatch(content, /RAW_THOUGHT_|\[AUTHORITATIVE_FACTS\]|final_receipt/i);
  }
});

test('real beta.5 returns a completed Final with max_step when Check continues at the one-step budget', { timeout: 20_000 }, async (t) => {
  const provider = await fixtureProvider(t, ['visible-budget-final'], { checkDecision: true });
  const archive = archiveFixture(); t.after(archive.cleanup); writeConfig(archive.config, provider.baseUrl);
  const runtime = fs.mkdtempSync(path.join(os.tmpdir(), 'core-react-max-step-')); t.after(() => fs.rmSync(runtime, { recursive: true, force: true }));
  const boundaries = await resolvePackagedBoundaries();
  const world = await readPublishedWorld(archive.root), config = await readCallerConfig(archive.config);
  const session = await createPlayWorkspace(runtime, 'play-max-step', world, config);
  await appendUser(nodeProcessRunner, boundaries.promptpileBin, session.contextDir, buildContextMessage(world));
  const final = await runReact({
    runner: nodeProcessRunner,
    reactBin: boundaries.reactBin,
    validateProcessPile: boundaries.validateProcessPile,
    config: session.sendConfig,
    context: session.contextDir,
    conversation: session.conversationDir,
  });
  assert.equal(final, 'visible-budget-final');
  assert.equal(provider.requests.length, 4);
});

test('real beta.5 completes Play and Planning publication through Core', { timeout: 25_000 }, async (t) => {
  const playSubmission = JSON.stringify({ version: 2, events: [{ beatId: 'beat1', title: 'Day completed', locationId: null, participantIds: [], scene: 'Done', dialogue: '', userAction: 'Act', result: { summary: 'Day completed', learnedFacts: [], timeAdvanced: null, completedBeatIds: ['beat1'], skippedBeatIds: [], endDay: true }, proposedPatch: [] }] });
  const planningSubmission = JSON.stringify({ version: 2, intent: 'Continue the story', knownContext: [], constraints: [], openQuestions: [], maxEvents: 1, beats: [{ key: 'open', intent: 'Open the next scene', priority: 'required', dependsOn: [] }] });
  const provider = await fixtureProvider(t, ['visible-send', playSubmission, planningSubmission]);
  const archive = archiveFixture(); t.after(archive.cleanup); writeConfig(archive.config, provider.baseUrl);
  const core = await createDayloomCoreInternal({ worldRoot: archive.root, llmConfigPath: archive.config }); t.after(() => core.dispose());

  assert.deepEqual(await core.startSession('play'), { ok: true });
  assert.deepEqual(await core.send('Act'), { ok: true });
  assert.deepEqual(await core.submit(), { ok: true });
  assert.equal(core.getState().world.phase, 'awaiting-settle');
  assert.deepEqual(await core.settle(), { ok: true });
  assert.deepEqual(await core.startSession('planning'), { ok: true });
  assert.deepEqual(await core.submit(), { ok: true });
  assert.equal(core.getState().world.phase, 'planned');
  assert.equal(core.getState().world.day, 'day2');
  assert.equal(provider.requests.length, 12);
});

test('real beta.5 cancellation kills the React child and emits a closed operation', { timeout: 20_000 }, async (t) => {
  const provider = await fixtureProvider(t, ['unused'], { holdFirst: true });
  const archive = archiveFixture(); t.after(archive.cleanup); writeConfig(archive.config, provider.baseUrl);
  const calls = []; let reactChild;
  const runner = { run(bin, args, options = {}) {
    calls.push({ bin, args: [...args] });
    return nodeProcessRunner.run(bin, args, { ...options, onChild(child) { options.onChild?.(child); if (args.includes('--process-pile-fd')) reactChild = child; } });
  } };
  const core = await createDayloomCoreInternal({ worldRoot: archive.root, llmConfigPath: archive.config }, { runner, boundaries: await resolvePackagedBoundaries() }); t.after(() => core.dispose());
  const events = []; core.subscribe((event) => events.push(event));
  await core.startSession('play');
  const sending = core.send('wait');
  await waitFor(() => provider.requests.length === 1 && reactChild);
  const cancelling = core.cancel();
  await waitFor(() => reactChild.killed);
  provider.release();
  assert.equal((await sending).error.code, 'CANCELLED');
  assert.deepEqual(await cancelling, { ok: true });
  assert.equal(calls.some((call) => call.args.includes('--work-root')), false);
  assert.equal(events.filter((event) => event.type === 'work.failed' && event.status === 'cancelled').length, 1);
});

test('real beta.5 empty Observe fails closed before Final without Core-owned work paths', { timeout: 20_000 }, async (t) => {
  const provider = await fixtureProvider(t, ['must-not-run'], { observeContent: '' });
  const archive = archiveFixture(); t.after(archive.cleanup); writeConfig(archive.config, provider.baseUrl);
  const before = fs.readFileSync(path.join(archive.root, 'current.json'), 'utf8');
  const calls = [];
  const runner = { run(bin, args, options) { calls.push({ args: [...args] }); return nodeProcessRunner.run(bin, args, options); } };
  const core = await createDayloomCoreInternal(
    { worldRoot: archive.root, llmConfigPath: archive.config },
    { runner, boundaries: await resolvePackagedBoundaries() },
  );
  t.after(() => core.dispose());
  const events = []; core.subscribe((event) => events.push(event));
  await core.startSession('play');
  const result = await core.send('fail before Final');
  assert.equal(result.error.code, 'AGENT_FAILED');
  assert.equal(provider.requests.length, 2);
  assert.equal(core.getState().session, null);
  assert.equal(fs.readFileSync(path.join(archive.root, 'current.json'), 'utf8'), before);
  assert.equal(calls.some((call) => call.args.includes('--work-root')), false);
  assert.equal(events.filter((event) => event.type === 'work.failed' && event.status === 'failed').length, 1);
});

test('real beta.5 Process Pile streams all phases through CoreEvent v1 and React cleans its work', { timeout: 20_000 }, async (t) => {
  const provider = await fixtureProvider(t, ['visible-v2-final'], { checkContent: 'checked' });
  const archive = archiveFixture(); t.after(archive.cleanup); writeConfig(archive.config, provider.baseUrl);
  const calls = [];
  const runner = { run(bin, args, options) { calls.push({ args: [...args] }); return nodeProcessRunner.run(bin, args, options); } };
  const core = await createDayloomCoreInternal(
    { worldRoot: archive.root, llmConfigPath: archive.config },
    { runner, boundaries: await resolvePackagedBoundaries() },
  );
  t.after(() => core.dispose());
  const events = []; const existedAtReady = [];
  core.subscribe((event) => {
    events.push(event);
    if (event.type === 'work.completed') existedAtReady.push(fs.existsSync(event.workPath));
  });
  assert.deepEqual(await core.startSession('play'), { ok: true });
  assert.deepEqual(await core.send('show transparent work'), { ok: true });
  const operation = events.find((event) => event.type === 'work.started').operationId;
  const own = events.filter((event) => event.operationId === operation);
  assert.deepEqual(own.filter((event) => event.type === 'work.delta').map((event) => event.phase), ['thought', 'thought', 'observe', 'observe', 'check']);
  assert.equal(own.filter((event) => event.type === 'output.delta').map((event) => event.text).join(''), 'visible-v2-final');
  assert.equal(own.filter((event) => event.type === 'output.completed').length, 1);
  assert.deepEqual(existedAtReady, [true]);
  assert.equal(fs.existsSync(own.find((event) => event.type === 'work.started').workPath), false);
  const reactArgs = calls.find((call) => call.args.includes('--process-pile-fd')).args;
  assert.equal(reactArgs.includes('--work-root'), false);
  assert.equal(reactArgs[reactArgs.indexOf('--process-pile-fd') + 1], '3');
});
