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
    response.end(`data: ${JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: 0, id: `check-${requestNumber}`, type: 'function', function: { name: 'react_check_decision', arguments: '{"decision":false}' } }] } }] })}\n\ndata: [DONE]\n\n`);
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

test('real beta.4 isolates two consecutive Play sends and hands Observe to Final', { timeout: 20_000 }, async (t) => {
  const provider = await fixtureProvider(t, ['visible-final-1', 'visible-final-2']);
  const archive = archiveFixture(); t.after(archive.cleanup); writeConfig(archive.config, provider.baseUrl);
  const runtime = fs.mkdtempSync(path.join(os.tmpdir(), 'core2-react-beta4-')); t.after(() => fs.rmSync(runtime, { recursive: true, force: true }));
  const boundaries = await resolvePackagedBoundaries();
  const world = await readPublishedWorld(archive.root), config = await readCallerConfig(archive.config);
  const session = await createPlayWorkspace(runtime, 'play', world, config);
  await appendUser(nodeProcessRunner, boundaries.promptpileBin, session.contextDir, buildContextMessage(world));
  const contextBefore = snapshot(session.contextDir);

  for (const [input, expected] of [['first turn', 'visible-final-1'], ['second turn', 'visible-final-2']]) {
    await appendUser(nodeProcessRunner, boundaries.promptpileBin, session.conversationDir, input);
    assert.equal(await runReact({ runner: nodeProcessRunner, reactBin: boundaries.reactBin, validate: boundaries.validateAgentEvent, config: session.sendConfig, context: session.contextDir, conversation: session.conversationDir, workRoot: session.reactWorkRoot }), expected);
    assert.deepEqual(fs.readdirSync(session.reactWorkRoot), []);
  }

  assert.equal(provider.requests.length, 8);
  for (const requestIndex of [0, 4]) {
    const thoughtMessages = provider.requests[requestIndex].messages;
    assert.equal(thoughtMessages.some((message) => message.content.includes('[DAYLOOM_PLAY_CONTEXT_V0]')), true);
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

test('real beta.4 completes Play and Planning publication through Core2', { timeout: 25_000 }, async (t) => {
  const playSubmission = JSON.stringify({ version: 1, summary: 'Day completed', beats: [{ id: 'beat1', status: 'completed', eventId: 'event1' }], events: [{ id: 'event1', beatId: 'beat1', userInput: 'Act', assistantOutput: 'Done' }] });
  const planningSubmission = JSON.stringify({ version: 1, intent: 'Continue the story', beats: [{ intent: 'Open the next scene' }] });
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

test('real beta.4 running cancellation kills the child before Core2 removes its Session root', { timeout: 20_000 }, async (t) => {
  const provider = await fixtureProvider(t, ['unused'], { holdFirst: true });
  const archive = archiveFixture(); t.after(archive.cleanup); writeConfig(archive.config, provider.baseUrl);
  const calls = []; let reactChild;
  const runner = { run(bin, args, options = {}) {
    calls.push({ bin, args: [...args] });
    return nodeProcessRunner.run(bin, args, { ...options, onChild(child) { options.onChild?.(child); if (args.includes('--work-root')) reactChild = child; } });
  } };
  const core = await createDayloomCoreInternal({ worldRoot: archive.root, llmConfigPath: archive.config }, { runner, boundaries: await resolvePackagedBoundaries() }); t.after(() => core.dispose());
  await core.startSession('play');
  const sending = core.send('wait');
  await waitFor(() => provider.requests.length === 1 && reactChild);
  const reactArgs = calls.find((call) => call.args.includes('--work-root')).args;
  const workRoot = reactArgs[reactArgs.indexOf('--work-root') + 1], sessionRoot = path.dirname(workRoot);
  const cancelling = core.cancel();
  await waitFor(() => reactChild.killed);
  provider.release();
  assert.equal((await sending).error.code, 'CANCELLED');
  assert.deepEqual(await cancelling, { ok: true });
  assert.equal(fs.existsSync(sessionRoot), false);
});

test('real beta.4 empty Observe fails closed before Final and leaves no Session work', { timeout: 20_000 }, async (t) => {
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
  await core.startSession('play');
  const result = await core.send('fail before Final');
  assert.equal(result.error.code, 'AGENT_FAILED');
  assert.equal(provider.requests.length, 2);
  assert.equal(core.getState().session, null);
  assert.equal(fs.readFileSync(path.join(archive.root, 'current.json'), 'utf8'), before);
  const reactArgs = calls.find((call) => call.args.includes('--work-root')).args;
  const workRoot = reactArgs[reactArgs.indexOf('--work-root') + 1];
  assert.equal(fs.existsSync(path.dirname(workRoot)), false);
});
