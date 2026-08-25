import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { createRequire } from 'node:module';
import { createDayloomCore } from '@dayloom/core';

const require = createRequire(import.meta.url);
const { archiveFixture } = require('../../core/test/helpers.js');
const driverModule = new URL('../dist/runtime-driver/create-runtime-driver-from-core-for-test.js', import.meta.url);

test('real Promptpile React streams Thought Observe Check and Final through Core into TUI presentation', { timeout: 25_000 }, async (t) => {
  const provider = await fixtureProvider(t);
  const archive = archiveFixture();
  fs.writeFileSync(archive.config, [
    '[[llm_api]]', 'name = "local"', 'model = "fixture-model"', `base_url = "${provider.baseUrl}"`, 'api_key = "fixture-key"', '',
    '[promptpile]', 'llm_api = "local"', '',
  ].join('\n'));
  const core = await createDayloomCore({ worldRoot: archive.root, llmConfigPath: archive.config });
  const { createRuntimeDriverFromCoreForTest } = await import(driverModule);
  const driver = createRuntimeDriverFromCoreForTest({ worldRoot: archive.root, core });
  t.after(async () => { await driver.dispose(); archive.cleanup(); });
  const seenPhases = new Set();
  const visibleWorkText = [];
  driver.subscribe((snapshot) => {
    for (const item of snapshot.presentationItems) if ('kind' in item && item.kind === 'working' && item.phase) {
      seenPhases.add(item.phase);
      if (item.text) visibleWorkText.push(item.text);
    }
  });

  await driver.runHubAction('play');
  await driver.submitSessionText('推进故事');

  const state = driver.getState();
  const working = state.presentationItems.find((item) => 'kind' in item && item.kind === 'working');
  const final = state.messages.find((message) => message.role === 'assistant');
  assert.ok(working); assert.equal(working.status, 'completed'); assert.equal(working.text, ''); assert.equal(working.pathStatus, 'expired');
  assert.ok(working.workPath); assert.equal(fs.existsSync(working.workPath), false);
  assert.deepEqual({ text: final.text, status: final.status }, { text: '真实最终回答', status: 'complete' });
  assert.deepEqual([...seenPhases], ['thought', 'observe', 'check']);
  assert.equal(visibleWorkText.some((text) => /internal reasoning|second internal step/i.test(text)), true);
  assert.equal(state.messages.some((message) => /真实思考|AUTHORITATIVE_FACTS|检查/.test(message.text)), false);
  assert.equal(provider.requests.length, 7);
});

async function fixtureProvider(t) {
  const requests = [];
  const server = http.createServer((request, response) => {
    let body = ''; request.setEncoding('utf8'); request.on('data', (chunk) => { body += chunk; });
    request.on('end', () => { requests.push(JSON.parse(body)); respond(response, requests.length); });
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  t.after(async () => { server.closeAllConnections?.(); await new Promise((resolve) => server.close(resolve)); });
  return { requests, baseUrl: `http://127.0.0.1:${server.address().port}/v1` };
}

function respond(response, requestNumber) {
  response.writeHead(200, { 'content-type': 'text/event-stream' });
  if (requestNumber === 3 || requestNumber === 6) {
    const decision = requestNumber === 3;
    response.end(`data: ${JSON.stringify({ choices: [{ delta: { content: '检查', tool_calls: [{ index: 0, id: `check-${requestNumber}`, type: 'function', function: { name: 'react_check_decision', arguments: JSON.stringify({ decision }) } }] } }] })}\n\ndata: [DONE]\n\n`);
    return;
  }
  const content = requestNumber === 1 ? 'internal reasoning in English'
    : requestNumber === 2 ? observeHandoff(true)
      : requestNumber === 4 ? 'second internal step in English'
        : requestNumber === 5 ? observeHandoff(false)
          : '真实最终回答';
  const split = Math.ceil(content.length / 2);
  response.write(`data: ${JSON.stringify({ choices: [{ delta: { content: content.slice(0, split) } }] })}\n\n`);
  response.end(`data: ${JSON.stringify({ choices: [{ delta: { content: content.slice(split) } }] })}\n\ndata: [DONE]\n\n`);
}

function observeHandoff(continueWork) {
  return `[EVIDENCE]\n<none>\n[DECISIONS]\n<none>\n[UNRESOLVED]\n<none>\n[NEXT_TOOL_ACTION]\n${continueWork ? 'mcp__draft__list_directory .' : '<none>'}`;
}
