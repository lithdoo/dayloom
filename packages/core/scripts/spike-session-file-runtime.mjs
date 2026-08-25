import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { createServer } from 'node:net';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import * as TOML from '@iarna/toml';

const require = createRequire(import.meta.url);

function packageBin(packageName, binName) {
  const packagePath = require.resolve(`${packageName}/package.json`);
  const metadata = require(packagePath);
  const relative = typeof metadata.bin === 'string' ? metadata.bin : metadata.bin?.[binName];
  if (typeof relative !== 'string') throw new Error(`${packageName} does not expose ${binName}.`);
  return path.resolve(path.dirname(packagePath), relative);
}

async function freePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') { server.close(); reject(new Error('Could not allocate loopback port.')); return; }
      server.close((error) => error ? reject(error) : resolve(address.port));
    });
  });
}

async function run(bin, args, timeoutMs = 30_000) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [bin, ...args], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    let stdout = '', stderr = '', settled = false;
    const timer = setTimeout(() => { if (!settled) child.kill(); }, timeoutMs);
    child.stdout.setEncoding('utf8').on('data', (chunk) => { stdout += chunk; });
    child.stderr.setEncoding('utf8').on('data', (chunk) => { stderr += chunk; });
    child.once('error', reject);
    child.once('close', (code) => {
      settled = true; clearTimeout(timer);
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(`${path.basename(bin)} failed (${code}): ${stderr || stdout}`));
    });
  });
}

async function waitForHealth(baseUrl, child) {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null || child.signalCode !== null) throw new Error('Gateway exited before becoming healthy.');
    try { if ((await fetch(`${baseUrl}/health`)).ok) return; } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('Gateway did not become healthy within 15 seconds.');
}

async function stop(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  child.kill();
  await Promise.race([
    new Promise((resolve) => child.once('exit', resolve)),
    new Promise((resolve) => setTimeout(resolve, 3_000)),
  ]);
  if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
}

const root = await mkdtemp(path.join(os.tmpdir(), 'dayloom-session-file-spike-'));
const archiveRoot = path.join(root, 'archive'), draftRoot = path.join(root, 'draft'), runtimeRoot = path.join(root, 'runtime');
await Promise.all([mkdir(archiveRoot), mkdir(draftRoot), mkdir(runtimeRoot)]);
await writeFile(path.join(archiveRoot, 'canon.md'), 'immutable archive evidence\n', 'utf8');

const promptpileMcpBin = packageBin('promptpile-mcp', 'promptpile-mcp');
const filesystemMcpBin = packageBin('@rustmcp/rust-mcp-filesystem', 'rust-mcp-filesystem');
const port = await freePort(), token = randomBytes(32).toString('hex'), baseUrl = `http://127.0.0.1:${port}`;
const configPath = path.join(runtimeRoot, 'mcp.toml'), toolsPath = path.join(runtimeRoot, 'tools.toml');
const callsPath = path.join(runtimeRoot, 'write.calls.jsonl'), resultPath = path.join(runtimeRoot, 'write.result.jsonl');
const archiveTools = ['list_directory', 'directory_tree', 'search_files', 'search_files_content', 'read_file_lines'];
const draftTools = ['list_directory', 'read_file_lines', 'write_file'];
const config = {
  version: 1,
  gateway: { port, token },
  defaults: { init_timeout_ms: 10_000, list_timeout_ms: 10_000 },
  behavior: { failure_policy: 'strict', flat_names: false },
  execution: { concurrency: 1, call_timeout_ms: 15_000, failure_policy: 'fail_fast', retry_max_attempts: 1, retry_base_delay_ms: 250, retry_safe_tools: [] },
  servers: {
    archive: { command: process.execPath, args: [filesystemMcpBin, archiveRoot], cwd: archiveRoot, env: { ALLOW_WRITE: 'false', ENABLE_ROOTS: 'false' }, allowed_tools: archiveTools },
    draft: { command: process.execPath, args: [filesystemMcpBin, draftRoot], cwd: draftRoot, env: { ALLOW_WRITE: 'true', ENABLE_ROOTS: 'false' }, allowed_tools: draftTools },
  },
};
await writeFile(configPath, TOML.stringify(config), 'utf8');

const gateway = spawn(process.execPath, [promptpileMcpBin, 'launch', '--config', configPath], { stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true });
let gatewayStderr = '';
gateway.stderr.setEncoding('utf8').on('data', (chunk) => { gatewayStderr += chunk; });

try {
  await waitForHealth(baseUrl, gateway);
  await run(promptpileMcpBin, ['export-tools', '--base-url', baseUrl, '--token', token, '-o', toolsPath]);
  const definitions = TOML.parse(await readFile(toolsPath, 'utf8')).tools;
  const exported = definitions.map((tool) => tool.name).sort();
  const expected = [
    ...archiveTools.map((name) => `mcp__archive__${name}`),
    ...draftTools.map((name) => `mcp__draft__${name}`),
  ].sort();
  assert.deepEqual(exported, expected, 'Gateway must export the exact namespaced capability set.');
  const writeDefinition = definitions.find((tool) => tool.name === 'mcp__draft__write_file');
  assert.deepEqual([...writeDefinition.parameters.required].sort(), ['content', 'path']);
  assert.equal(writeDefinition.parameters.properties.path.type, 'string');
  assert.equal(writeDefinition.parameters.properties.content.type, 'string');

  const call = { id: 'write-1', type: 'function', function: { name: 'mcp__draft__write_file', arguments: JSON.stringify({ path: 'world.md', content: '# Draft\n' }) } };
  await writeFile(callsPath, `${JSON.stringify(call)}\n`, 'utf8');
  await run(promptpileMcpBin, ['exec-calls', '--base-url', baseUrl, '--token', token, '--input', callsPath, '--timeout-ms', '15000', '--overwrite-results']);
  const result = JSON.parse((await readFile(resultPath, 'utf8')).trim());
  assert.equal(result.tool_call_id, 'write-1');
  assert.equal(await readFile(path.join(draftRoot, 'world.md'), 'utf8'), '# Draft\n');
  assert.equal(await readFile(path.join(archiveRoot, 'canon.md'), 'utf8'), 'immutable archive evidence\n');
  assert.ok(!exported.includes('mcp__archive__write_file'), 'Archive must not export a write capability.');

  process.stdout.write(`${JSON.stringify({
    status: 'passed', provider: '@rustmcp/rust-mcp-filesystem@0.4.3', gateway: 'promptpile-mcp@0.1.0-beta.3',
    toolCount: exported.length, exportedTools: exported, writeRequiredParameters: ['content', 'path'], writeResult: result.content,
  }, null, 2)}\n`);
} catch (error) {
  if (gatewayStderr) process.stderr.write(gatewayStderr);
  throw error;
} finally {
  await stop(gateway);
  await rm(root, { recursive: true, force: true });
}
