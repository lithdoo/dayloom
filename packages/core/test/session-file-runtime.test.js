const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { resolvePackagedBoundaries } = require('../dist/promptpile/binaries');
const { nodeProcessRunner } = require('../dist/promptpile/conversation');
const { startSessionFileRuntimeV1, ARCHIVE_FILE_TOOLS, DRAFT_FILE_TOOLS } = require('../dist/promptpile/session-file-runtime');
const { readValidatedToolCalls, pairedResultPath, readCompleteToolResultVector } = require('../dist/promptpile/archive-retrieval-artifacts');

const temporary = (t) => { const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dayloom-file-runtime-')); t.after(() => fs.rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })); return root; };
const row = (id, name, args) => ({ id, type: 'function', function: { name, arguments: JSON.stringify(args) } });

test('real namespaced Session File Runtime closes read/write evidence and rejects write-without-read', { timeout: 30_000 }, async (t) => {
  const root = temporary(t), archive = path.join(root, 'archive'), draft = path.join(root, 'draft'), runtimeRoot = path.join(root, 'runtime'), work = path.join(root, 'work');
  for (const dir of [archive, draft, work]) fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(path.join(archive, 'canon.md'), 'archive\n'); fs.writeFileSync(path.join(draft, 'draft.yaml'), 'old\n');
  const boundaries = await resolvePackagedBoundaries(), policy = { serverId: 'draft', root: draft, maxFiles: 8, maxFileBytes: 4096, maxTotalBytes: 8192 };
  const runtime = await startSessionFileRuntimeV1({ runtimeRoot, promptpileMcpBin: boundaries.promptpileMcpBin, filesystemMcp: boundaries.filesystemMcp, runner: nodeProcessRunner, servers: [{ id: 'archive', root: archive, writable: false, tools: ARCHIVE_FILE_TOOLS }, { id: 'draft', root: draft, writable: true, tools: DRAFT_FILE_TOOLS }], workspaces: [policy], maxToolCallsPerThought: 8, maxToolResultLineBytes: 32 * 1024 });
  t.after(() => runtime.close());
  assert.deepEqual(runtime.binding.toolNames, [...ARCHIVE_FILE_TOOLS.map((name) => `mcp__archive__${name}`), ...DRAFT_FILE_TOOLS.map((name) => `mcp__draft__${name}`)]);
  const calls = path.join(work, '[1]assistant.calls.jsonl'); fs.writeFileSync(calls, `${JSON.stringify(row('r', 'mcp__draft__read_file_lines', { path: 'draft.yaml', offset: 0, limit: 100 }))}\n${JSON.stringify(row('w', 'mcp__draft__write_file', { path: 'draft.yaml', content: 'new\n' }))}\n`);
  const hook = path.resolve(__dirname, '../dist/promptpile/session-file-hook.js'), env = { ...process.env, PROMPTPILE_HAS_TOOL_CALLS: '1', PROMPTPILE_ASSISTANT_CALL_FILE: calls, PROMPTPILE_OUTPUT_DIRECTORY: work };
  let result = spawnSync(process.execPath, [hook, path.join(runtimeRoot, 'hook.json')], { encoding: 'utf8', env, timeout: 20_000 }); assert.equal(result.status, 0, result.stderr); runtime.assertReadyForFinal(work); assert.equal(fs.readFileSync(path.join(draft, 'draft.yaml'), 'utf8'), 'new\n');
  const artifactPolicy = { allowedToolNames: runtime.binding.toolNames, maxToolCallsPerThought: 8, maxToolResultLineBytes: 32 * 1024 };
  assert.equal(readCompleteToolResultVector(readValidatedToolCalls(calls, artifactPolicy), pairedResultPath(calls), artifactPolicy).length, 2);
  fs.rmSync(pairedResultPath(calls)); fs.writeFileSync(calls, `${JSON.stringify(row('bad', 'mcp__draft__write_file', { path: 'draft.yaml', content: 'forbidden\n' }))}\n`);
  result = spawnSync(process.execPath, [hook, path.join(runtimeRoot, 'hook.json')], { encoding: 'utf8', env, timeout: 20_000 }); assert.equal(result.status, 0, result.stderr); assert.equal(fs.readFileSync(path.join(draft, 'draft.yaml'), 'utf8'), 'new\n');
  assert.match(fs.readFileSync(pairedResultPath(calls), 'utf8'), /DAYLOOM_SESSION_FILE_ERROR/); await runtime.close();
});
