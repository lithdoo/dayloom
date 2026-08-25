const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { assertWorkspaceCallPolicyV1, assertWorkspaceTreeV1 } = require('../dist/promptpile/session-file-policy');

const temporary = (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dayloom-file-policy-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
};
const policy = (root, serverId = 'draft') => ({ serverId, root, maxFiles: 4, maxFileBytes: 1024, maxTotalBytes: 2048 });
const call = (id, name, args) => ({ id, name, raw: { id, type: 'function', function: { name, arguments: JSON.stringify(args) } } });

test('workspace calls allow new files and require read-before-write for existing files', (t) => {
  const root = temporary(t); fs.writeFileSync(path.join(root, 'draft.yaml'), 'old\n');
  assert.doesNotThrow(() => assertWorkspaceCallPolicyV1([
    call('r', 'mcp__draft__read_file_lines', { path: 'draft.yaml', offset: 0, limit: 100 }),
    call('w', 'mcp__draft__write_file', { path: 'draft.yaml', content: 'new\n' }),
    call('n', 'mcp__draft__write_file', { path: 'content/new.md', content: 'new\n' }),
  ], [policy(root)]));
  assert.throws(() => assertWorkspaceCallPolicyV1([
    call('w', 'mcp__draft__write_file', { path: 'draft.yaml', content: 'new\n' }),
  ], [policy(root)]), /read an existing file/);
});

test('workspace calls reject Core-owned and escaping paths', (t) => {
  const root = temporary(t);
  for (const target of ['meta.json', '../draft.yaml', 'content/not-markdown.txt']) {
    assert.throws(() => assertWorkspaceCallPolicyV1([
      call('w', 'mcp__draft__write_file', { path: target, content: 'x' }),
    ], [policy(root)]));
  }
});

test('workspace calls predict file-count and total-byte limits before execution', (t) => {
  const root = temporary(t); fs.writeFileSync(path.join(root, 'draft.yaml'), 'old\n');
  assert.throws(() => assertWorkspaceCallPolicyV1([
    call('a', 'mcp__draft__write_file', { path: 'content/a.md', content: '1234' }),
    call('b', 'mcp__draft__write_file', { path: 'content/b.md', content: '5678' }),
  ], [{ ...policy(root), maxFiles: 2 }]), /resource limits/);
  assert.throws(() => assertWorkspaceCallPolicyV1([
    call('a', 'mcp__draft__write_file', { path: 'content/a.md', content: '12345678' }),
  ], [{ ...policy(root), maxTotalBytes: 8 }]), /resource limits/);
});

test('workspace tree rejects resource excess and symlinks when supported', (t) => {
  const root = temporary(t); fs.writeFileSync(path.join(root, 'a.md'), 'a'.repeat(10));
  assert.doesNotThrow(() => assertWorkspaceTreeV1(policy(root)));
  assert.throws(() => assertWorkspaceTreeV1({ ...policy(root), maxTotalBytes: 2 }), /resource limits/);
  try {
    fs.symlinkSync(path.join(root, 'a.md'), path.join(root, 'link.md'));
    assert.throws(() => assertWorkspaceTreeV1(policy(root)), /unsafe entry/);
  } catch (error) {
    if (error.code !== 'EPERM') throw error;
  }
});
