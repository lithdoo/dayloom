const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { archiveFixture, FakeRunner, eventStream } = require('./helpers');
const { createDayloomCoreInternal } = require('../dist/core');
const { ArchiveRetrievalError } = require('../dist/errors');
const { readPublishedWorld } = require('../dist/world/read');
const { materializeArchiveView, isAiVisibleWorldPath, AI_VISIBLE_WORLD_NAMESPACES_V1 } = require('../dist/world/archive-view');
const { resolvePackagedBoundaries } = require('../dist/promptpile/binaries');
const { nodeProcessRunner } = require('../dist/promptpile/conversation');
const {
  pairedResultPath, readValidatedToolCalls, readCompleteToolResultVector,
  sanitizeToolResultsAtomic, writeSyntheticToolResultsAtomic, assertWorkRetrievalClosure,
} = require('../dist/promptpile/archive-retrieval-artifacts');
const { startArchiveRetrievalRuntime, ARCHIVE_RETRIEVAL_TOOL_NAMES } = require('../dist/promptpile/archive-retrieval');
const { runReact } = require('../dist/promptpile/react-runner');

const policy = { allowedToolNames: ARCHIVE_RETRIEVAL_TOOL_NAMES, maxToolCallsPerThought: 4, maxToolResultLineBytes: 32 * 1024 };
const temporary = (t, prefix) => { const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix)); t.after(() => fs.rmSync(root, { recursive: true, force: true })); return root; };
const call = (id, name = 'list_directory', args = { path: '.' }) => ({ id, type: 'function', function: { name, arguments: JSON.stringify(args) } });

test('frozen retrieval dependencies and local command boundaries resolve exactly', async () => {
  const pkg = require('../package.json'), boundaries = await resolvePackagedBoundaries();
  assert.equal(pkg.dependencies['promptpile-mcp'], '0.1.0-beta.3');
  assert.equal(pkg.dependencies['promptpile-protocol'], '0.1.0-beta.2');
  assert.equal(pkg.dependencies['@rustmcp/rust-mcp-filesystem'], '0.4.3');
  assert.equal(fs.statSync(boundaries.promptpileMcpBin).isFile(), true);
  assert.equal(path.isAbsolute(boundaries.filesystemMcp.command), true);
  for (const arg of boundaries.filesystemMcp.argsPrefix) assert.equal(path.isAbsolute(arg), true);
});

test('ProcessRunner enforces a killable timeout and settles once', async (t) => {
  const root = temporary(t, 'retrieval-timeout-'), script = path.join(root, 'hang.js');
  fs.writeFileSync(script, 'setInterval(() => {}, 1000);\n');
  const started = Date.now();
  await assert.rejects(() => nodeProcessRunner.run(script, [], { timeoutMs: 80 }), /timed out after 80ms/);
  assert.ok(Date.now() - started < 2_000);
});

test('Archive View copies exactly the deterministic AI-visible pinned tree', async (t) => {
  const fixture = archiveFixture(); t.after(fixture.cleanup); const sessionRoot = temporary(t, 'archive-view-');
  const world = await readPublishedWorld(fixture.root);
  const view = await materializeArchiveView({ worldRoot: fixture.root, sessionRoot, world });
  assert.deepEqual([...AI_VISIBLE_WORLD_NAMESPACES_V1], ['canon/', 'state/', 'characters/', 'locations/', 'arcs/', 'memory/', 'story-seeds/', 'days/']);
  assert.equal(isAiVisibleWorldPath('profile/dayloom.json'), false);
  assert.equal(view.documentPaths.includes('profile/dayloom.json'), false);
  assert.deepEqual([...view.documentPaths], [...view.documentPaths].sort((a, b) => a.localeCompare(b, 'en')));
  for (const documentPath of view.documentPaths) {
    assert.equal(isAiVisibleWorldPath(documentPath), true);
    assert.equal(fs.statSync(path.join(view.root, ...documentPath.split('/'))).isFile(), true);
  }
  assert.equal(fs.existsSync(path.join(view.root, 'current.json')), false);
  assert.equal(fs.existsSync(path.join(view.root, 'objects')), false);
});

test('Artifact adapter validates ordered closure, preserves metadata, truncates and writes synthetic vectors', (t) => {
  const root = temporary(t, 'retrieval-artifacts-'), callsPath = path.join(root, '[1]assistant.calls.jsonl');
  fs.writeFileSync(callsPath, `${JSON.stringify(call('a'))}\n${JSON.stringify(call('b', 'read_file_lines', { path: 'canon/premise.md', offset: 0, limit: 2 }))}\n`);
  const calls = readValidatedToolCalls(callsPath, policy), resultPath = pairedResultPath(callsPath);
  fs.writeFileSync(resultPath, `${JSON.stringify({ tool_call_id: 'a', name: 'list_directory', content: 'x'.repeat(40_000), metadata: { retained: true } })}\n${JSON.stringify({ tool_call_id: 'b', name: 'read_file_lines', content: 'ok' })}\n`);
  sanitizeToolResultsAtomic(calls, resultPath, policy);
  const rows = readCompleteToolResultVector(calls, resultPath, policy);
  assert.equal(rows[0].metadata.retained, true); assert.match(rows[0].content, /DAYLOOM_TOOL_RESULT_TRUNCATED/);
  for (const line of fs.readFileSync(resultPath, 'utf8').trimEnd().split('\n')) assert.ok(Buffer.byteLength(line) <= policy.maxToolResultLineBytes);
  assertWorkRetrievalClosure(root, policy);
  fs.rmSync(resultPath);
  assert.throws(() => assertWorkRetrievalClosure(root, policy), /Could not read Tool Artifact/);
  writeSyntheticToolResultsAtomic(calls, resultPath, '[DAYLOOM_RETRIEVAL_ERROR]\nunresolved', policy);
  assert.doesNotThrow(() => assertWorkRetrievalClosure(root, policy));
});

test('real gateway exports exactly five read-only tools and hook closes a real call', { timeout: 25_000 }, async (t) => {
  const fixture = archiveFixture(); t.after(fixture.cleanup); const sessionRoot = temporary(t, 'retrieval-runtime-');
  const world = await readPublishedWorld(fixture.root), view = await materializeArchiveView({ worldRoot: fixture.root, sessionRoot, world });
  const boundaries = await resolvePackagedBoundaries();
  const runtime = await startArchiveRetrievalRuntime({ sessionId: 'session', sessionRoot, archiveView: view, promptpileMcpBin: boundaries.promptpileMcpBin, filesystemMcp: boundaries.filesystemMcp, runner: nodeProcessRunner });
  t.after(() => runtime.close());
  const tools = fs.readFileSync(runtime.binding.toolsFile, 'utf8');
  assert.deepEqual([...tools.matchAll(/^name = "([^"]+)"$/gm)].map((match) => match[1]), [...ARCHIVE_RETRIEVAL_TOOL_NAMES]);
  const work = path.join(sessionRoot, 'work'); fs.mkdirSync(work);
  const callsPath = path.join(work, '[1]assistant.calls.jsonl'); fs.writeFileSync(callsPath, `${JSON.stringify(call('real'))}\n`);
  const hookConfig = path.join(sessionRoot, 'retrieval', 'hook.json');
  const hookJs = path.resolve(__dirname, '../dist/promptpile/archive-retrieval-hook.js');
  const result = spawnSync(process.execPath, [hookJs, hookConfig], { encoding: 'utf8', env: { ...process.env, PROMPTPILE_HAS_TOOL_CALLS: '1', PROMPTPILE_ASSISTANT_CALL_FILE: callsPath, PROMPTPILE_OUTPUT_DIRECTORY: work }, timeout: 20_000 });
  assert.equal(result.status, 0, result.stderr);
  runtime.assertReadyForFinal(work);
  const rows = readCompleteToolResultVector(readValidatedToolCalls(callsPath, policy), pairedResultPath(callsPath), policy);
  assert.match(rows[0].content, /canon|state/i);
  await runtime.close();
});

test('pre-Final guard runs after work.ready validation and before any Final projection', async () => {
  const boundaries = await resolvePackagedBoundaries(), events = []; let guarded = false;
  const runner = { run: async (_bin, _args, options) => { options.onExtraPipe(eventStream('forbidden')); return { code: 0, stdout: '', stderr: '' }; } };
  await assert.rejects(() => runReact({
    runner, reactBin: boundaries.reactBin, validateProcessPile: boundaries.validateProcessPile,
    config: 'c', context: 'x', conversation: 'y',
    assertBeforeFinal() { guarded = true; throw new Error('open retrieval vector'); },
    observer: { workCompleted: () => events.push('work.completed'), outputStarted: () => events.push('output.started') },
  }), /open retrieval vector/);
  assert.equal(guarded, true); assert.deepEqual(events, []);
});

test('Core installs one retrieval aggregate transactionally and closes it before Session cleanup', async (t) => {
  const fixture = archiveFixture(); t.after(fixture.cleanup); const lifecycle = [];
  const retrievalFactory = async (input) => {
    const directory = path.join(input.sessionRoot, 'retrieval'); fs.mkdirSync(directory, { recursive: true });
    const toolsFile = path.join(directory, 'tools.toml'), afterHookPath = path.join(directory, 'after-hook.cmd');
    fs.writeFileSync(toolsFile, 'tools = []\n'); fs.writeFileSync(afterHookPath, '@exit /b 0\r\n');
    return { binding: { toolsFile, afterHookPath }, assertHealthy() { lifecycle.push('healthy'); }, assertReadyForFinal() {}, async close() { lifecycle.push('close'); assert.equal(fs.existsSync(input.sessionRoot), true); } };
  };
  const core = await createDayloomCoreInternal(
    { worldRoot: fixture.root, llmConfigPath: fixture.config },
    { runner: new FakeRunner(), boundaries: await resolvePackagedBoundaries(), retrievalFactory },
  );
  t.after(() => core.dispose());
  assert.deepEqual(await core.startSession('play'), { ok: true });
  assert.equal(core.getState().session.kind, 'play');
  assert.deepEqual(await core.cancel(), { ok: true });
  assert.deepEqual(lifecycle, ['close']);
  assert.equal(core.getState().session, null);
});

test('Core maps retrieval health failure to AGENT_FAILED and terminalizes without World recovery', async (t) => {
  const fixture = archiveFixture(); t.after(fixture.cleanup); let closed = 0;
  const retrievalFactory = async (input) => {
    const directory = path.join(input.sessionRoot, 'retrieval'); fs.mkdirSync(directory, { recursive: true });
    const toolsFile = path.join(directory, 'tools.toml'), afterHookPath = path.join(directory, 'after-hook.cmd');
    fs.writeFileSync(toolsFile, 'tools = []\n'); fs.writeFileSync(afterHookPath, '@exit /b 0\r\n');
    return { binding: { toolsFile, afterHookPath }, assertHealthy() { throw new ArchiveRetrievalError('runtime', 'gateway failed'); }, assertReadyForFinal() {}, async close() { closed += 1; } };
  };
  const core = await createDayloomCoreInternal(
    { worldRoot: fixture.root, llmConfigPath: fixture.config },
    { runner: new FakeRunner(), boundaries: await resolvePackagedBoundaries(), retrievalFactory },
  );
  t.after(() => core.dispose()); await core.startSession('play');
  assert.deepEqual(await core.send('hello'), { ok: false, error: { code: 'AGENT_FAILED', message: 'gateway failed' } });
  assert.equal(core.getState().session, null); assert.equal(closed, 1); assert.equal(core.getState().world.revision, 1);
});
