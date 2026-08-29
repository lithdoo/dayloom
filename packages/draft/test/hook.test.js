import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolvePromptpileBoundariesV1 } from '../dist/binaries.js';
import { startFileRuntimeV1 } from '../dist/runtime.js';

const hookJs = fileURLToPath(new URL('../dist/hook.js', import.meta.url));

async function tempDir() {
  return mkdtemp(path.join(os.tmpdir(), 'dayloom-draft-hook-'));
}

function callLine(id, name, args) {
  return JSON.stringify({
    id,
    type: 'function',
    function: { name, arguments: JSON.stringify(args) },
  });
}

async function runHook(runtime, artifactRoot, calls) {
  await mkdir(artifactRoot, { recursive: true });
  const callsPath = path.join(artifactRoot, '[1]assistant.calls.jsonl');
  await writeFile(callsPath, `${calls.map((call) => callLine(call.id, call.name, call.arguments)).join('\n')}\n`, 'utf8');
  const child = spawnSync(process.execPath, [hookJs, runtime.binding.hookConfigPath], {
    encoding: 'utf8',
    env: {
      ...process.env,
      PROMPTPILE_HAS_TOOL_CALLS: '1',
      PROMPTPILE_ASSISTANT_CALL_FILE: callsPath,
      PROMPTPILE_OUTPUT_DIRECTORY: artifactRoot,
    },
    timeout: 25_000,
  });
  assert.equal(child.status, 0, child.stderr);
  const raw = await readFile(path.join(artifactRoot, '[1]assistant.result.jsonl'), 'utf8');
  return raw.split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
}

test('file-set MCP allows exact files, keeps World read-only, and rejects siblings', async () => {
  const root = await tempDir();
  const drafts = path.join(root, 'drafts');
  const world = path.join(root, 'world');
  const runtimeRoot = path.join(root, 'runtime');
  await mkdir(drafts);
  await mkdir(world);
  const allowed = path.join(drafts, 'a.md');
  const sibling = path.join(drafts, 'c.md');
  const worldFile = path.join(world, 'note.md');
  await writeFile(allowed, 'old-a\n', 'utf8');
  await writeFile(sibling, 'old-c\n', 'utf8');
  await writeFile(worldFile, 'world\n', 'utf8');
  const boundaries = await resolvePromptpileBoundariesV1();
  let runtime;
  try {
    runtime = await startFileRuntimeV1({
      runtimeRoot,
      promptpileMcpBin: boundaries.promptpileMcpBin,
      filesystemMcp: boundaries.filesystemMcp,
      worldRoot: await realpath(world),
      draft: {
        mode: 'files',
        mcpRoot: await realpath(drafts),
        files: [{ requested: allowed, canonical: await realpath(allowed), exists: true }],
      },
    });
    assert.equal(runtime.binding.toolNames.includes('mcp__world__write_file'), false);
    assert.equal(runtime.binding.toolNames.includes('mcp__draft__write_file'), true);

    const artifacts = path.join(root, 'artifacts');
    await mkdir(artifacts);
    const written = await runHook(runtime, artifacts, [{
      id: 'write-a',
      name: 'mcp__draft__write_file',
      arguments: { path: 'a.md', content: 'new-a\n' },
    }]);
    assert.equal(await readFile(allowed, 'utf8'), 'new-a\n');
    assert.equal(written[0].content.includes('DAYLOOM_DRAFT_TOOL_ERROR'), false);

    const siblingArtifacts = path.join(root, 'artifacts-sibling');
    await mkdir(siblingArtifacts);
    const denied = await runHook(runtime, siblingArtifacts, [{
      id: 'write-c',
      name: 'mcp__draft__write_file',
      arguments: { path: 'c.md', content: 'hacked\n' },
    }]);
    assert.equal(await readFile(sibling, 'utf8'), 'old-c\n');
    assert.match(denied[0].content, /DAYLOOM_DRAFT_TOOL_ERROR/);

    const worldArtifacts = path.join(root, 'artifacts-world');
    await mkdir(worldArtifacts);
    const worldDenied = await runHook(runtime, worldArtifacts, [{
      id: 'write-world',
      name: 'mcp__world__write_file',
      arguments: { path: 'note.md', content: 'mutated\n' },
    }]);
    assert.equal(await readFile(worldFile, 'utf8'), 'world\n');
    assert.match(worldDenied[0].content, /DAYLOOM_DRAFT_TOOL_ERROR/);

    const escapeArtifacts = path.join(root, 'artifacts-escape');
    await mkdir(escapeArtifacts);
    const escaped = await runHook(runtime, escapeArtifacts, [{
      id: 'escape',
      name: 'mcp__draft__write_file',
      arguments: { path: '../world/note.md', content: 'escaped\n' },
    }]);
    assert.equal(await readFile(worldFile, 'utf8'), 'world\n');
    assert.match(escaped[0].content, /DAYLOOM_DRAFT_TOOL_ERROR/);
  } finally {
    await runtime?.close();
    await rm(root, { recursive: true, force: true });
  }
});

test('draft-dir MCP writes inside the subtree and rejects symlink escape', { skip: process.platform === 'win32' }, async () => {
  const root = await tempDir();
  const draftDir = path.join(root, 'draft');
  const world = path.join(root, 'world');
  const outside = path.join(root, 'outside.md');
  await mkdir(draftDir);
  await mkdir(world);
  await writeFile(outside, 'outside\n', 'utf8');
  await writeFile(path.join(draftDir, 'notes.md'), 'notes\n', 'utf8');
  await symlink(outside, path.join(draftDir, 'escape.md'));
  const boundaries = await resolvePromptpileBoundariesV1();
  let runtime;
  try {
    runtime = await startFileRuntimeV1({
      runtimeRoot: path.join(root, 'runtime'),
      promptpileMcpBin: boundaries.promptpileMcpBin,
      filesystemMcp: boundaries.filesystemMcp,
      worldRoot: await realpath(world),
      draft: { mode: 'directory', root: await realpath(draftDir) },
    });
    const nested = await runHook(runtime, path.join(root, 'nested-artifacts'), [
      { id: 'mkdir', name: 'mcp__draft__create_directory', arguments: { path: 'sub' } },
      { id: 'nested', name: 'mcp__draft__write_file', arguments: { path: 'sub/play.md', content: '# Play\n' } },
    ]);
    assert.equal(await readFile(path.join(draftDir, 'sub', 'play.md'), 'utf8'), '# Play\n');
    assert.equal(nested[0].content.includes('DAYLOOM_DRAFT_TOOL_ERROR'), false);

    const escaped = await runHook(runtime, path.join(root, 'symlink-artifacts'), [{
      id: 'symlink',
      name: 'mcp__draft__write_file',
      arguments: { path: 'escape.md', content: 'pwned\n' },
    }]);
    assert.equal(await readFile(outside, 'utf8'), 'outside\n');
    assert.match(escaped[0].content, /DAYLOOM_DRAFT_TOOL_ERROR/);

    const deleted = await runHook(runtime, path.join(root, 'delete-artifacts'), [{
      id: 'delete',
      name: 'mcp__draft__delete_file',
      arguments: { path: 'notes.md' },
    }]);
    assert.match(deleted[0].content, /DAYLOOM_DELETE_FILE_OK/);
    await assert.rejects(() => readFile(path.join(draftDir, 'notes.md')));
  } finally {
    await runtime?.close();
    await rm(root, { recursive: true, force: true });
  }
});
