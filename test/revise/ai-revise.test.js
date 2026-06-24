const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { buildUnifiedDiff } = require('../../dist/revise/diff.js');
const { snapshotChanges, assertSnapshotsUnchanged } = require('../../dist/revise/file-hash.js');
const { parseAndAssertReadonlyCalls } = require('../../dist/revise/mcp-tools.js');
const { parseReviseStatus, parseRevisePayload, stripReviseStatus } = require('../../dist/revise/parse-assistant.js');

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'day-loom-ai-revise-'));
}

test('parseReviseStatus reads pending changes and stripReviseStatus hides machine block', () => {
  const text = `已记录。\n\n\`\`\`revise-status\n{"pending_changes":[{"target":{"kind":"canon","section":"style"},"instruction":"更克制"}]}\n\`\`\``;
  assert.deepEqual(parseReviseStatus(text), {
    pending_changes: [{ target: { kind: 'canon', section: 'style' }, instruction: '更克制' }],
  });
  assert.equal(stripReviseStatus(text), '已记录。');
});

test('parseRevisePayload reads finalize payload', () => {
  const text = `\`\`\`revise-payload\n{"summary":"style","operations":[{"op":"replace_canon","section":"style","content":"# Style\\n"}]}\n\`\`\``;
  assert.equal(parseRevisePayload(text).operations[0].section, 'style');
});

test('buildUnifiedDiff renders old and new controlled file contents', () => {
  const root = tempDir();
  fs.mkdirSync(path.join(root, 'canon'));
  fs.writeFileSync(path.join(root, 'canon', 'style.md'), '# Old\n', 'utf8');
  const diff = buildUnifiedDiff(root, [{ relativePath: 'canon/style.md', content: '# New\n' }]);
  assert.match(diff, /--- a\/canon\/style\.md/);
  assert.match(diff, /-# Old/);
  assert.match(diff, /\+# New/);
  fs.rmSync(root, { recursive: true, force: true });
});

test('assertSnapshotsUnchanged refuses concurrent file edits', () => {
  const root = tempDir();
  fs.mkdirSync(path.join(root, 'canon'));
  fs.writeFileSync(path.join(root, 'canon', 'style.md'), '# Old\n', 'utf8');
  const snapshots = snapshotChanges(root, [{ relativePath: 'canon/style.md', content: '# New\n' }]);
  fs.writeFileSync(path.join(root, 'canon', 'style.md'), '# Manual edit\n', 'utf8');
  assert.throws(() => assertSnapshotsUnchanged(root, snapshots), /file changed during review/);
  fs.rmSync(root, { recursive: true, force: true });
});

test('parseAndAssertReadonlyCalls rejects forged filesystem write calls', () => {
  const root = tempDir();
  const callFile = path.join(root, '[3]assistant.calls.jsonl');
  fs.writeFileSync(callFile, `${JSON.stringify({ id: 'x', type: 'function', function: { name: 'mcp__world__write_file', arguments: '{}' } })}\n`, 'utf8');
  assert.throws(() => parseAndAssertReadonlyCalls(callFile), /Refusing non-readonly MCP tool call/);
  fs.rmSync(root, { recursive: true, force: true });
});

test('MCP helpers export readonly tools, verify root, and persist results', async () => {
  const http = require('node:http');
  const { exportReadonlyTools, assertAllowedWorldRoot, executeReadonlyCalls } = require('../../dist/revise/mcp-tools.js');
  const root = tempDir();
  const world = path.join(root, 'world');
  fs.mkdirSync(world);
  const toolsFile = path.join(root, 'readonly.tools.toml');
  const readonlyNames = [
    'list_allowed_directories', 'list_directory', 'directory_tree', 'search_files',
    'read_text_file', 'read_multiple_files', 'get_file_info',
  ].map(name => `mcp__world__${name}`);
  const tools = [...readonlyNames, 'mcp__world__write_file'].map(name => ({
    type: 'function', function: { name, parameters: { type: 'object', properties: {} } },
  }));
  const server = http.createServer((req, res) => {
    res.setHeader('Content-Type', 'application/json');
    if (req.url === '/v1/tools/export') return res.end(JSON.stringify({ tools }));
    if (req.url === '/v1/calls/exec') {
      let body = '';
      req.on('data', chunk => { body += chunk; });
      req.on('end', () => {
        const calls = JSON.parse(body).calls;
        res.end(JSON.stringify({ results: calls.map(call => ({ toolCallId: call.id, ok: true, content: call.function.name.endsWith('list_allowed_directories') ? `Allowed directories:\n${world}` : 'ok' })) }));
      });
      return;
    }
    res.statusCode = 404;
    res.end('{}');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;
  try {
    await exportReadonlyTools(baseUrl, undefined, toolsFile);
    const toml = fs.readFileSync(toolsFile, 'utf8');
    assert.match(toml, /mcp__world__read_text_file/);
    assert.doesNotMatch(toml, /mcp__world__write_file/);
    await assertAllowedWorldRoot(baseUrl, undefined, world, root);
    const callFile = path.join(root, '[3]assistant.calls.jsonl');
    fs.writeFileSync(callFile, `${JSON.stringify({ id: 'read', type: 'function', function: { name: 'mcp__world__read_text_file', arguments: '{"path":"x"}' } })}\n`, 'utf8');
    const resultFile = await executeReadonlyCalls(baseUrl, undefined, callFile);
    assert.match(fs.readFileSync(resultFile, 'utf8'), /"content":"ok"/);
  } finally {
    await new Promise(resolve => server.close(resolve));
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('projectRevisePayload upserts characters and scenes without replacing derived memory', () => {
  const { projectRevisePayload } = require('../../dist/revise/project-payload.js');
  const root = tempDir();
  fs.mkdirSync(path.join(root, 'characters', 'char_old'), { recursive: true });
  fs.mkdirSync(path.join(root, 'scenes'), { recursive: true });
  fs.writeFileSync(path.join(root, 'characters', 'index.yaml'), 'characters:\n  - char_old\n', 'utf8');
  fs.writeFileSync(path.join(root, 'characters', 'char_old', 'memory.md'), 'keep me\n', 'utf8');
  fs.writeFileSync(path.join(root, 'scenes', 'index.yaml'), 'scenes: []\n', 'utf8');
  const files = projectRevisePayload({ summary: 'entities', operations: [
    { op: 'upsert_character', id: 'char_old', profileMd: '# Old updated\n' },
    { op: 'upsert_character', id: 'char_new', profileMd: '# New\n' },
    { op: 'upsert_scene', id: 'scene_library', profileMd: '# Library\n' },
  ] }, root);
  const map = new Map(files.map(file => [file.relativePath, file.content]));
  assert.equal(map.has('characters/char_old/memory.md'), false);
  assert.equal(map.get('characters/char_new/memory.md'), '');
  assert.match(map.get('characters/index.yaml'), /char_old/);
  assert.match(map.get('characters/index.yaml'), /char_new/);
  assert.match(map.get('scenes/index.yaml'), /scene_library/);
  assert.equal(map.get('scenes/scene_library/triggers.yaml'), 'triggers: []\n');
  fs.rmSync(root, { recursive: true, force: true });
});

test('validateRevisePayload rejects invalid entity ids', () => {
  const { validateRevisePayload } = require('../../dist/revise/validate-payload.js');
  assert.throws(() => validateRevisePayload({ summary: 'x', operations: [{ op: 'upsert_character', id: '../escape', profileMd: '# bad' }] }), /Invalid entity id/);
});
