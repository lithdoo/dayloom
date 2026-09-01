import { randomBytes } from 'node:crypto';
import { chmod, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { spawn, type ChildProcess } from 'node:child_process';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as TOML from '@iarna/toml';
import type { DraftAuthorityV1 } from './authority.js';
import type { CommandBoundaryV1 } from './binaries.js';
import { assistantErrorV1 } from './errors.js';
import type { FileHookConfigV1 } from './hook.js';
import { runNodeCliV1 } from './process.js';

const WORLD_READ = Object.freeze(['list_directory', 'directory_tree', 'search_files', 'search_files_content', 'read_file_lines'] as const);
const DRAFT_FILES = Object.freeze(['read_file_lines', 'write_file'] as const);
const DRAFT_DIRECTORY = Object.freeze([...WORLD_READ, 'create_directory', 'write_file'] as const);
export interface FileRuntimeBindingV1 { toolsFile: string; afterHookPath: string; hookConfigPath: string; toolNames: readonly string[] }
export interface FileRuntimeV1 { binding: Readonly<FileRuntimeBindingV1>; close(): Promise<void> }
const settings = Object.freeze({ startupMs: 15_000, probeMs: 3_000, probeDelayMs: 200, closeMs: 2_000, initMs: 10_000, listMs: 10_000, callMs: 20_000, execMs: 30_000, ports: 5 });

export async function startFileRuntimeV1(input: {
  runtimeRoot: string; promptpileMcpBin: string; filesystemMcp: CommandBoundaryV1;
  worldRoot: string | null; draft: DraftAuthorityV1 | null;
}): Promise<FileRuntimeV1> {
  if (input.worldRoot === null && input.draft === null) throw assistantErrorV1('MCP_FAILED', 'File runtime requires World or Draft authority.');
  await mkdir(input.runtimeRoot, { recursive: true });
  const draftTools = input.draft === null ? [] : input.draft.mode === 'files' ? DRAFT_FILES : DRAFT_DIRECTORY;
  const draftRoot = input.draft === null ? null : input.draft.mode === 'files' ? input.draft.mcpRoot : input.draft.root;
  const expected = Object.freeze([
    ...(input.worldRoot === null ? [] : WORLD_READ.map((tool) => `mcp__world__${tool}`)),
    ...draftTools.map((tool) => `mcp__draft__${tool}`),
    ...(input.draft?.mode === 'directory' ? ['mcp__draft__delete_file'] : []),
  ]);
  let lastError: unknown;
  for (let attempt = 0; attempt < settings.ports; attempt += 1) {
    const port = await freePortV1();
    const token = randomBytes(32).toString('hex');
    const baseUrl = `http://127.0.0.1:${port}`;
    const configPath = path.join(input.runtimeRoot, 'mcp.toml');
    const hookConfigPath = path.join(input.runtimeRoot, 'hook.json');
    const candidate = path.join(input.runtimeRoot, 'tools.candidate.toml');
    const toolsFile = path.join(input.runtimeRoot, 'tools.toml');
    const hookJs = fileURLToPath(new URL('./hook.js', import.meta.url));
    const afterHookPath = path.join(input.runtimeRoot, process.platform === 'win32' ? 'after-hook.cmd' : 'after-hook.sh');
    const server = (root: string, writable: boolean, tools: readonly string[]) => ({
      command: input.filesystemMcp.command, args: [...input.filesystemMcp.argsPrefix, root], cwd: root,
      env: { ALLOW_WRITE: String(writable), ENABLE_ROOTS: 'false' }, allowed_tools: [...tools],
    });
    const servers: TOML.JsonMap = {};
    if (draftRoot !== null) servers.draft = server(draftRoot, true, draftTools);
    if (input.worldRoot !== null) servers.world = server(input.worldRoot, false, WORLD_READ);
    const gatewayTools = expected.filter((name) => name !== 'mcp__draft__delete_file');
    const config: TOML.JsonMap = {
      version: 1, gateway: { port, token }, defaults: { init_timeout_ms: settings.initMs, list_timeout_ms: settings.listMs },
      behavior: { failure_policy: 'strict', flat_names: false },
      execution: { concurrency: 1, call_timeout_ms: settings.callMs, failure_policy: 'fail_fast', retry_max_attempts: 2, retry_base_delay_ms: 250,
        retry_safe_tools: gatewayTools.filter((name) => !/__(write_file|delete_file|create_directory)$/.test(name)) },
      servers,
    };
    const hookConfig: FileHookConfigV1 = {
      version: 1, promptpileMcpBin: input.promptpileMcpBin, baseUrl, token, execRequestTimeoutMs: settings.execMs,
      maxToolCallsPerThought: 8, maxToolResultLineBytes: 256 * 1024, allowedToolNames: expected,
      worldRoot: input.worldRoot,
      draft: input.draft === null ? null : input.draft.mode === 'files'
        ? { mode: 'files', mcpRoot: input.draft.mcpRoot, files: input.draft.files.map((file) => file.canonical) }
        : { mode: 'directory', mcpRoot: input.draft.root, root: input.draft.root },
    };
    await writeFile(configPath, TOML.stringify(config), { encoding: 'utf8', mode: 0o600 });
    await writeFile(hookConfigPath, `${JSON.stringify(hookConfig)}\n`, { encoding: 'utf8', mode: 0o600 });
    const trampoline = process.platform === 'win32'
      ? `@echo off\r\n${cmdQuoteV1(process.execPath)} ${cmdQuoteV1(hookJs)} ${cmdQuoteV1(hookConfigPath)}\r\nexit /b %errorlevel%\r\n`
      : `#!/bin/sh\nexec ${shellQuoteV1(process.execPath)} ${shellQuoteV1(hookJs)} ${shellQuoteV1(hookConfigPath)}\n`;
    await writeFile(afterHookPath, trampoline, { encoding: 'utf8', mode: 0o700 });
    if (process.platform !== 'win32') await chmod(afterHookPath, 0o700);

    let state: 'starting' | 'ready' | 'closing' | 'closed' = 'starting';
    let stderr = '';
    const child = spawn(process.execPath, [input.promptpileMcpBin, 'launch', '--config', configPath], { stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true });
    child.stderr?.setEncoding('utf8').on('data', (chunk: string) => { stderr += chunk.slice(0, Math.max(0, 16 * 1024 - stderr.length)); });
    try {
      const deadline = Date.now() + settings.startupMs;
      for (;;) {
        if (child.exitCode !== null || child.signalCode !== null) throw new Error(stderr || 'Promptpile MCP gateway exited during startup.');
        const remaining = deadline - Date.now();
        if (remaining <= 0) throw new Error('Promptpile MCP gateway exceeded its startup deadline.');
        await rm(candidate, { force: true });
        try {
          const probe = await runNodeCliV1(input.promptpileMcpBin, ['export-tools', '--base-url', baseUrl, '--token', token, '-o', candidate], { timeoutMs: Math.min(settings.probeMs, remaining) });
          if (probe.code === 0) {
            const document = TOML.parse(await readFile(candidate, 'utf8')) as TOML.JsonMap;
            const exported = toolNamesV1(document);
            if (!sameSetV1(exported, gatewayTools)) throw new Error(`Promptpile MCP exported the wrong tool set: ${exported.join(', ')}.`);
            if (input.draft?.mode === 'directory') {
              (document.tools as TOML.JsonMap[]).push({ name: 'mcp__draft__delete_file', description: 'Delete one regular file inside the granted Draft directory.', parameters: { type: 'object', required: ['path'], properties: { path: { type: 'string' } } } });
              await writeFile(candidate, TOML.stringify(document), { encoding: 'utf8', mode: 0o600 });
            }
            await rename(candidate, toolsFile);
            state = 'ready';
            break;
          }
        } catch (error) { if (error instanceof Error && /wrong tool set/.test(error.message)) throw error; }
        await delayV1(Math.min(settings.probeDelayMs, Math.max(0, deadline - Date.now())));
      }
      return Object.freeze({ binding: Object.freeze({ toolsFile, afterHookPath, hookConfigPath, toolNames: expected }), async close() {
        if (state === 'closed') return;
        if (state === 'closing') { await waitForExitV1(child); return; }
        state = 'closing';
        if (!await waitForExitV1(child, 0)) await terminateTreeV1(child);
        if (!await waitForExitV1(child, settings.closeMs)) { await terminateTreeV1(child, true); await waitForExitV1(child); }
        state = 'closed';
      } });
    } catch (error) {
      lastError = error;
      state = 'closing';
      await terminateTreeV1(child);
      await waitForExitV1(child, settings.closeMs);
      state = 'closed';
      if (!/EADDRINUSE/i.test(stderr) || attempt + 1 >= settings.ports) break;
    }
  }
  throw assistantErrorV1('MCP_FAILED', lastError instanceof Error ? lastError.message : 'Could not start Promptpile file runtime.');
}
const delayV1 = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
async function freePortV1(): Promise<number> {
  return new Promise((resolve, reject) => { const server = net.createServer(); server.unref(); server.once('error', reject); server.listen(0, '127.0.0.1', () => { const address = server.address(); if (!address || typeof address === 'string') { server.close(); reject(new Error('Could not allocate port.')); } else server.close((error) => error ? reject(error) : resolve(address.port)); }); });
}
function toolNamesV1(value: TOML.JsonMap): string[] { if (!Array.isArray(value.tools)) throw new Error('Exported tools file is malformed.'); return (value.tools as Array<{ name?: unknown }>).map((tool) => { if (typeof tool.name !== 'string') throw new Error('Tool name is malformed.'); return tool.name; }); }
function sameSetV1(left: readonly string[], right: readonly string[]): boolean { return left.length === right.length && new Set(left).size === left.length && left.every((item) => right.includes(item)); }
function shellQuoteV1(value: string): string { return `'${value.replace(/'/g, `'"'"'`)}'`; }
function cmdQuoteV1(value: string): string { return `"${value.replace(/"/g, '""')}"`; }
async function waitForExitV1(child: ChildProcess, timeoutMs?: number): Promise<boolean> { if (child.exitCode !== null || child.signalCode !== null) return true; return new Promise((resolve) => { const done = () => { if (timer) clearTimeout(timer); resolve(true); }; const timer = timeoutMs === undefined ? undefined : setTimeout(() => { child.off('exit', done); resolve(false); }, timeoutMs); child.once('exit', done); }); }
async function terminateTreeV1(child: ChildProcess, force = false): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  if (process.platform !== 'win32' || child.pid === undefined) { child.kill(force ? 'SIGKILL' : 'SIGTERM'); return; }
  await new Promise<void>((resolve) => { const killer = spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true }); killer.once('error', () => resolve()); killer.once('close', () => resolve()); });
}
