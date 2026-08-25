import { randomBytes } from 'node:crypto';
import { spawn, type ChildProcess } from 'node:child_process';
import { chmod, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';
import * as TOML from '@iarna/toml';
import { SessionFileRuntimeError } from '../errors';
import type { CommandBoundary } from './binaries';
import type { ProcessRunner } from './conversation';
import { assertWorkRetrievalClosure, type ArtifactPolicy } from './archive-retrieval-artifacts';
import { assertWorkspaceTreeV1, type WorkspacePolicyV1 } from './session-file-policy';
import type { SessionFileHookConfigV1 } from './session-file-hook';

export const ARCHIVE_FILE_TOOLS = Object.freeze(['list_directory', 'directory_tree', 'search_files', 'search_files_content', 'read_file_lines'] as const);
export const DRAFT_FILE_TOOLS = Object.freeze(['list_directory', 'read_file_lines', 'write_file'] as const);
export const CANDIDATE_FILE_TOOLS = Object.freeze(['list_directory', 'directory_tree', 'read_file_lines', 'write_file'] as const);
export interface SessionFileServerV1 { readonly id: 'archive' | 'draft' | 'candidate'; readonly root: string; readonly writable: boolean; readonly tools: readonly string[] }
export interface SessionFileBindingV1 { readonly toolsFile: string; readonly afterHookPath: string; readonly toolNames: readonly string[] }
export interface SessionFileRuntimeV1 {
  readonly binding: SessionFileBindingV1; assertHealthy(): void; assertReadyForFinal(workPath: string): void; close(): Promise<void>;
}
type RuntimeState = 'starting' | 'ready' | 'failed' | 'closing' | 'closed';
const settings = Object.freeze({ startupMs: 15_000, probeMs: 3_000, probeDelayMs: 200, closeMs: 2_000, initMs: 10_000, listMs: 10_000, callMs: 15_000, execMs: 25_000, ports: 5 });

export async function startSessionFileRuntimeV1(input: {
  runtimeRoot: string; promptpileMcpBin: string; filesystemMcp: CommandBoundary; runner: ProcessRunner;
  servers: readonly SessionFileServerV1[]; maxToolCallsPerThought: number; maxToolResultLineBytes: number;
  workspaces: readonly WorkspacePolicyV1[];
}): Promise<SessionFileRuntimeV1> {
  if (input.servers.length === 0 || new Set(input.servers.map((server) => server.id)).size !== input.servers.length) throw fileError('startup', 'Session File Runtime servers are invalid.');
  await mkdir(input.runtimeRoot, { recursive: true });
  const expectedTools = input.servers.flatMap((server) => server.tools.map((tool) => `mcp__${server.id}__${tool}`));
  let lastError: unknown;
  for (let attempt = 0; attempt < settings.ports; attempt += 1) {
    const port = await freePort(), token = randomBytes(32).toString('hex'), baseUrl = `http://127.0.0.1:${port}`;
    const configPath = path.join(input.runtimeRoot, 'mcp.toml'), hookConfigPath = path.join(input.runtimeRoot, 'hook.json'), candidatePath = path.join(input.runtimeRoot, 'tools.candidate.toml'), toolsFile = path.join(input.runtimeRoot, 'tools.toml');
    const hookJs = path.join(__dirname, 'session-file-hook.js'), afterHookPath = path.join(input.runtimeRoot, process.platform === 'win32' ? 'after-hook.cmd' : 'after-hook.sh');
    const config = {
      version: 1, gateway: { port, token }, defaults: { init_timeout_ms: settings.initMs, list_timeout_ms: settings.listMs }, behavior: { failure_policy: 'strict', flat_names: false },
      execution: { concurrency: 1, call_timeout_ms: settings.callMs, failure_policy: 'fail_fast', retry_max_attempts: 2, retry_base_delay_ms: 250, retry_safe_tools: expectedTools.filter((name) => !name.endsWith('__write_file')) },
      servers: Object.fromEntries(input.servers.map((server) => [server.id, { command: input.filesystemMcp.command, args: [...input.filesystemMcp.argsPrefix, server.root], cwd: server.root, env: { ALLOW_WRITE: String(server.writable), ENABLE_ROOTS: 'false' }, allowed_tools: [...server.tools] }])),
    };
    const hookConfig: SessionFileHookConfigV1 = { version: 1, promptpileMcpBin: input.promptpileMcpBin, baseUrl, token, execRequestTimeoutMs: settings.execMs, maxToolCallsPerThought: input.maxToolCallsPerThought, maxToolResultLineBytes: input.maxToolResultLineBytes, allowedToolNames: expectedTools, workspaces: input.workspaces };
    await writeFile(configPath, TOML.stringify(config as TOML.JsonMap), { encoding: 'utf8', mode: 0o600 }); await writeFile(hookConfigPath, `${JSON.stringify(hookConfig, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
    const trampoline = process.platform === 'win32' ? `@echo off\r\n${cmdQuote(process.execPath)} ${cmdQuote(hookJs)} ${cmdQuote(hookConfigPath)}\r\nexit /b %errorlevel%\r\n` : `#!/bin/sh\nexec ${shellQuote(process.execPath)} ${shellQuote(hookJs)} ${shellQuote(hookConfigPath)}\n`;
    await writeFile(afterHookPath, trampoline, { encoding: 'utf8', mode: 0o700 }); if (process.platform !== 'win32') await chmod(afterHookPath, 0o700);
    let state: RuntimeState = 'starting', stderr = '';
    const child = spawn(process.execPath, [input.promptpileMcpBin, 'launch', '--config', configPath], { stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true });
    child.stderr?.setEncoding('utf8').on('data', (chunk: string) => { if (stderr.length < 16 * 1024) stderr += chunk.slice(0, 16 * 1024 - stderr.length); }); child.once('exit', () => { if (state === 'ready') state = 'failed'; });
    try {
      const deadline = Date.now() + settings.startupMs;
      for (;;) {
        if (child.exitCode !== null || child.signalCode !== null) throw fileError('startup', stderr || 'Session File gateway exited during startup.');
        const remaining = deadline - Date.now(); if (remaining <= 0) throw fileError('startup', 'Session File gateway exceeded its startup deadline.');
        await rm(candidatePath, { force: true });
        try {
          const probe = await input.runner.run(input.promptpileMcpBin, ['export-tools', '--base-url', baseUrl, '--token', token, '-o', candidatePath], { timeoutMs: Math.min(settings.probeMs, remaining) });
          if (probe.code === 0) { const names = toolNames(TOML.parse(await readFile(candidatePath, 'utf8'))); if (!sameSet(names, expectedTools)) throw fileError('tools', `Session File Runtime exported the wrong tool set: ${names.join(', ')}`); await rename(candidatePath, toolsFile); state = 'ready'; break; }
        } catch (error) { if (error instanceof SessionFileRuntimeError && error.stage === 'tools') throw error; }
        await delay(Math.min(settings.probeDelayMs, Math.max(0, deadline - Date.now())));
      }
      const artifactPolicy: ArtifactPolicy = hookConfig;
      return Object.freeze({
        binding: Object.freeze({ toolsFile, afterHookPath, toolNames: Object.freeze(expectedTools) }),
        assertHealthy() { if (state !== 'ready') throw fileError('runtime', `Session File Runtime is ${state}.`); },
        assertReadyForFinal(workPath: string) { if (state !== 'ready') throw fileError('runtime', `Session File Runtime is ${state}.`); assertWorkRetrievalClosure(workPath, artifactPolicy); for (const workspace of input.workspaces) assertWorkspaceTreeV1(workspace); },
        async close() { if (state === 'closed' || state === 'closing') { if (state === 'closing') await waitForExit(child); return; } state = 'closing'; if (!await waitForExit(child, 0)) child.kill(); if (!await waitForExit(child, settings.closeMs)) { child.kill('SIGKILL'); await waitForExit(child); } state = 'closed'; },
      });
    } catch (error) { lastError = error; state = 'closing'; child.kill(); await waitForExit(child, settings.closeMs); state = 'closed'; await rm(candidatePath, { force: true }); if (!/EADDRINUSE/i.test(stderr) || attempt + 1 >= settings.ports) break; }
  }
  await rm(input.runtimeRoot, { recursive: true, force: true }).catch(() => undefined); throw lastError instanceof SessionFileRuntimeError ? lastError : fileError('startup', 'Could not start Session File Runtime.', lastError);
}

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const fileError = (stage: 'startup' | 'tools' | 'runtime', message: string, cause?: unknown) => new SessionFileRuntimeError(stage, message, cause === undefined ? undefined : { cause });
async function freePort(): Promise<number> { return new Promise((resolve, reject) => { const server = net.createServer(); server.unref(); server.once('error', reject); server.listen(0, '127.0.0.1', () => { const address = server.address(); if (!address || typeof address === 'string') { server.close(); reject(new Error('Could not allocate loopback port.')); return; } server.close((error) => error ? reject(error) : resolve(address.port)); }); }); }
function shellQuote(value: string): string { return `'${value.replace(/'/g, `'"'"'`)}'`; }
function cmdQuote(value: string): string { return `"${value.replace(/"/g, '""')}"`; }
function toolNames(value: unknown): string[] { if (!value || typeof value !== 'object' || !Array.isArray((value as { tools?: unknown }).tools)) throw fileError('tools', 'Exported tools file is malformed.'); return (value as { tools: Array<{ name?: unknown }> }).tools.map((tool) => { if (typeof tool.name !== 'string') throw fileError('tools', 'Exported tool entry is malformed.'); return tool.name; }); }
function sameSet(left: readonly string[], right: readonly string[]): boolean { return left.length === right.length && new Set(left).size === left.length && left.every((item) => right.includes(item)); }
async function waitForExit(child: ChildProcess, timeoutMs?: number): Promise<boolean> { if (child.exitCode !== null || child.signalCode !== null) return true; return new Promise((resolve) => { const done = () => { if (timer) clearTimeout(timer); resolve(true); }; const timer = timeoutMs === undefined ? undefined : setTimeout(() => { child.off('exit', done); resolve(false); }, timeoutMs); child.once('exit', done); }); }
