const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { CoreOperationError } = require('../dist/errors');
const {
  CORE2_COMPRESSION_POLICY,
  CORE2_SEMANTIC_SUMMARY_PROVIDER_ID,
  createCore2SemanticSummaryProvider,
  runCompressedCompletion,
} = require('../dist/promptpile/compression');

function temporaryRoot(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'core2-compression-'));
  fs.mkdirSync(path.join(root, 'requests'), { recursive: true });
  fs.mkdirSync(path.join(root, 'conversation'), { recursive: true });
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

function semanticDocument(request, marker = 'summary-marker') {
  const sourceTurnIndices = [request.turns[0].idx];
  return {
    version: 1,
    goal: [{ text: marker, sourceTurnIndices }],
    stableFacts: [], constraints: [], decisions: [], importantToolFindings: [], completedWork: [],
    unresolvedWork: [], failedApproaches: [], nextActions: [],
  };
}

function providerOptions(root, runner, events = []) {
  return {
    runner,
    promptpileBin: 'promptpile',
    requestsDir: path.join(root, 'requests'),
    summaryConfigPath: path.join(root, 'summary.toml'),
    summaryPromptPath: path.join(root, 'summary.system.md'),
    onChildStart: (child) => events.push(['start', child]),
    onChildEnd: (child) => events.push(['end', child]),
  };
}

const request = {
  version: 1,
  turns: [{ idx: 0, estimatedTokens: 10, hasToolCalls: false, artifacts: [{ name: '[0]user.md', role: 'user', extension: 'md', fileKind: 'message', content: 'hello' }] }],
  budget: { estimatedInputTokens: 10, maxInputTokens: 100, maxOutputTokens: 50 },
};

test('semantic provider uses exact Promptpile argv, keeps JSON private, and cleans its request directory', async (t) => {
  const root = temporaryRoot(t), calls = [], children = [{ kill() {} }, { kill() {} }], events = [];
  const runner = { async run(bin, args, options = {}) {
    const child = children[calls.length]; options.onChild?.(child);
    calls.push({ bin, args: [...args], stdin: options.stdin });
    return args[0] === 'conversation'
      ? { code: 0, stdout: '', stderr: '' }
      : { code: 0, stdout: JSON.stringify(semanticDocument(request)), stderr: '' };
  } };
  const handle = createCore2SemanticSummaryProvider(providerOptions(root, runner, events));
  assert.equal(handle.provider.id, CORE2_SEMANTIC_SUMMARY_PROVIDER_ID);
  assert.deepEqual(await handle.provider.summarize(request, new AbortController().signal), semanticDocument(request));
  await handle.drain();
  const requestDir = calls[0].args[3];
  assert.deepEqual(calls[0], { bin: 'promptpile', args: ['conversation', 'append-user', '-d', requestDir, '--quiet'], stdin: JSON.stringify(request) });
  assert.deepEqual(calls[1], { bin: 'promptpile', args: ['--config', path.join(root, 'summary.toml'), '-d', requestDir, '--insert-files', path.join(root, 'summary.system.md'), '--disable-tool', '--temperature', '0'], stdin: undefined });
  assert.equal(fs.existsSync(requestDir), false);
  assert.deepEqual(events, [['start', children[0]], ['end', children[0]], ['start', children[1]], ['end', children[1]]]);
});

test('semantic provider rejects empty, malformed, and non-object JSON and always cleans up', async (t) => {
  for (const stdout of ['', '{bad', '[]', 'null', '"text"']) {
    const root = temporaryRoot(t); let requestDir;
    const runner = { async run(_bin, args) {
      if (args[0] === 'conversation') { requestDir = args[3]; return { code: 0, stdout: '', stderr: '' }; }
      return { code: 0, stdout, stderr: '' };
    } };
    const handle = createCore2SemanticSummaryProvider(providerOptions(root, runner));
    await assert.rejects(() => handle.provider.summarize(request, new AbortController().signal));
    await handle.drain();
    assert.equal(fs.existsSync(requestDir), false);
  }
});

test('abort kills the exact provider child and drain waits for child settlement and cleanup', async (t) => {
  const root = temporaryRoot(t); let release, completionChild, requestDir;
  const runner = { async run(_bin, args, options = {}) {
    requestDir = args[0] === 'conversation' ? args[3] : requestDir;
    const child = { killed: false, kill() { this.killed = true; } }; options.onChild?.(child);
    if (args[0] === 'conversation') return { code: 0, stdout: '', stderr: '' };
    completionChild = child;
    return new Promise((resolve) => { release = () => resolve({ code: 1, stdout: '', stderr: 'aborted' }); });
  } };
  const controller = new AbortController();
  const handle = createCore2SemanticSummaryProvider(providerOptions(root, runner));
  const rejected = assert.rejects(handle.provider.summarize(request, controller.signal), /aborted/);
  while (!release) await new Promise((resolve) => setImmediate(resolve));
  controller.abort();
  assert.equal(completionChild.killed, true);
  let drained = false; const draining = handle.drain().then(() => { drained = true; });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(drained, false); assert.equal(fs.existsSync(requestDir), true);
  release(); await rejected; await draining;
  assert.equal(fs.existsSync(requestDir), false);
});

test('an already-aborted provider request kills its first child and never starts completion', async (t) => {
  const root = temporaryRoot(t), calls = []; const child = { killed: false, kill() { this.killed = true; } };
  const runner = { async run(_bin, args, options = {}) {
    calls.push([...args]); options.onChild?.(child); return { code: 0, stdout: '', stderr: '' };
  } };
  const controller = new AbortController(); controller.abort();
  const handle = createCore2SemanticSummaryProvider(providerOptions(root, runner));
  await assert.rejects(() => handle.provider.summarize(request, controller.signal), /aborted/);
  await handle.drain();
  assert.equal(child.killed, true); assert.equal(calls.length, 1); assert.equal(fs.readdirSync(path.join(root, 'requests')).length, 0);
});

test('fixed policy uses the frozen growth trigger and public heuristic tokenizer', () => {
  assert.equal(CORE2_COMPRESSION_POLICY.threshold, 32_000);
  assert.equal(CORE2_COMPRESSION_POLICY.keepRecent, 4);
  assert.equal(CORE2_COMPRESSION_POLICY.strategy, 'sliding-window');
  assert.equal(CORE2_COMPRESSION_POLICY.tokenizer.kind, 'heuristic-fallback');
  assert.deepEqual(CORE2_COMPRESSION_POLICY.summary, { kind: 'semantic', maxOutputTokens: 2_048, timeoutMs: 60_000 });
  assert.equal('modelContextTokens' in CORE2_COMPRESSION_POLICY, false);
});

test('wrapper preserves completion errors and maps lifecycle failures without running completion', async (t) => {
  const root = temporaryRoot(t), conversationDir = path.join(root, 'conversation');
  const runner = { async run() { throw new Error('provider must not run'); } };
  const options = { ...providerOptions(root, runner), conversationDir };
  await assert.rejects(
    () => runCompressedCompletion({ ...options, completion: async () => { throw new Error('react detail'); } }),
    (error) => error instanceof CoreOperationError && error.code === 'AGENT_FAILED' && error.message === 'react detail',
  );

  fs.writeFileSync(path.join(conversationDir, '.promptpile-compress.lock'), JSON.stringify({
    version: 1, ownerId: 'blocking-owner', pid: process.pid, hostname: os.hostname(), operation: 'compress', createdAt: new Date().toISOString(),
  }));
  let completionCalled = false;
  await assert.rejects(
    () => runCompressedCompletion({ ...options, completion: async () => { completionCalled = true; } }),
    (error) => error instanceof CoreOperationError && error.code === 'CONVERSATION_FAILED',
  );
  assert.equal(completionCalled, false);
});

test('real beta.2 lifecycle skips healthy compact history, then restores originals without summarizing the old summary', async (t) => {
  const root = temporaryRoot(t), conversationDir = path.join(root, 'conversation'), summaryRequests = [];
  const contextPath = path.join(root, 'context', 'immutable.md'), reactPath = path.join(root, 'react', 'prompt.md'), privatePath = path.join(root, 'compression', 'private.txt');
  fs.mkdirSync(path.dirname(contextPath), { recursive: true }); fs.mkdirSync(path.dirname(reactPath), { recursive: true }); fs.mkdirSync(path.dirname(privatePath), { recursive: true });
  fs.writeFileSync(contextPath, Buffer.from([0, 1, 2, 3, 255])); fs.writeFileSync(reactPath, 'react-owned'); fs.writeFileSync(privatePath, 'compression-private');
  const protectedBytes = [contextPath, reactPath, privatePath].map((file) => fs.readFileSync(file));
  for (let idx = 0; idx < 6; idx += 1) fs.writeFileSync(path.join(conversationDir, `[${idx}]${idx % 2 ? 'assistant' : 'user'}.md`), `${idx}:` + 'x'.repeat(25_000));
  const runner = { async run(_bin, args, options = {}) {
    if (args[0] === 'conversation') {
      const parsed = JSON.parse(options.stdin); summaryRequests.push(parsed);
      return { code: 0, stdout: '', stderr: '' };
    }
    return { code: 0, stdout: JSON.stringify(semanticDocument(summaryRequests.at(-1), `summary-marker-${summaryRequests.length}`)), stderr: '' };
  } };
  const run = (completion) => runCompressedCompletion({ ...providerOptions(root, runner), conversationDir, completion });
  assert.equal(await run(async () => 'first'), 'first');
  assert.equal(summaryRequests.length, 1);
  assert.equal(await run(async () => 'steady'), 'steady');
  assert.equal(summaryRequests.length, 1, 'healthy compact live state must not restore or summarize below threshold');

  for (let idx = 6; idx < 10; idx += 1) fs.writeFileSync(path.join(conversationDir, `[${idx}]${idx % 2 ? 'assistant' : 'user'}.md`), `${idx}:` + 'y'.repeat(25_000));
  assert.equal(await run(async () => 'recompressed'), 'recompressed');
  assert.equal(summaryRequests.length, 2);
  assert.equal(JSON.stringify(summaryRequests[1]).includes('summary-marker-1'), false);
  assert.ok(summaryRequests[1].turns.some((turn) => turn.idx === 0), 'restored original history is the recompression source');
  assert.deepEqual([contextPath, reactPath, privatePath].map((file) => fs.readFileSync(file)), protectedBytes);
});
