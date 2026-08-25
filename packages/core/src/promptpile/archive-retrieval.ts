import { randomBytes } from 'node:crypto';
import { spawn, type ChildProcess } from 'node:child_process';
import { chmod, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';
import * as TOML from '@iarna/toml';
import { ArchiveRetrievalError } from '../errors';
import type { ArchiveView } from '../world/archive-view';
import type { CommandBoundary } from './binaries';
import type { ProcessRunner } from './conversation';
import { assertWorkRetrievalClosure, type ArtifactPolicy } from './archive-retrieval-artifacts';
import type { ArchiveRetrievalHookConfigV1 } from './archive-retrieval-hook';

export const ARCHIVE_RETRIEVAL = Object.freeze({
  gatewayStartupTimeoutMs: 15_000, readinessProbeTimeoutMs: 3_000, readinessProbeDelayMs: 200,
  gatewayCloseGraceMs: 2_000, mcpInitTimeoutMs: 10_000, mcpListTimeoutMs: 10_000,
  toolCallTimeoutMs: 10_000, execRequestTimeoutMs: 25_000, retryMaxAttempts: 2,
  concurrency: 4, maxToolCallsPerThought: 4, maxToolResultLineBytes: 32 * 1024, portAttempts: 5,
});
export const ARCHIVE_RETRIEVAL_TOOL_NAMES = Object.freeze([
  'list_directory', 'directory_tree', 'search_files', 'search_files_content', 'read_file_lines',
] as const);
export interface ArchiveRetrievalBinding { readonly toolsFile: string; readonly afterHookPath: string }
export interface ArchiveRetrievalRuntime {
  readonly binding: ArchiveRetrievalBinding;
  assertHealthy(): void;
  assertReadyForFinal(workPath: string): void;
  close(): Promise<void>;
}
type RuntimeState = 'starting' | 'ready' | 'failed' | 'closing' | 'closed';
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const retrievalError = (stage: 'startup' | 'tools' | 'runtime', message: string, cause?: unknown) => new ArchiveRetrievalError(stage, message, cause === undefined ? undefined : { cause });

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref(); server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') { server.close(); reject(new Error('Could not allocate loopback port.')); return; }
      server.close((error) => error ? reject(error) : resolve(address.port));
    });
  });
}
function shellQuote(value: string): string { return `'${value.replace(/'/g, `'"'"'`)}'`; }
function cmdQuote(value: string): string { return `"${value.replace(/"/g, '""')}"`; }
function toolNames(candidate: unknown): string[] {
  if (!candidate || typeof candidate !== 'object' || !Array.isArray((candidate as { tools?: unknown }).tools)) throw retrievalError('tools', 'Exported tools file is malformed.');
  return (candidate as { tools: unknown[] }).tools.map((tool) => {
    if (!tool || typeof tool !== 'object' || typeof (tool as { name?: unknown }).name !== 'string') throw retrievalError('tools', 'Exported tool entry is malformed.');
    return (tool as { name: string }).name;
  });
}
function sameSet(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && new Set(left).size === left.length && left.every((item) => right.includes(item));
}
async function waitForExit(child: ChildProcess, timeoutMs?: number): Promise<boolean> {
  if (child.exitCode !== null || child.signalCode !== null) return true;
  return new Promise((resolve) => {
    const done = () => { if (timer) clearTimeout(timer); resolve(true); };
    const timer = timeoutMs === undefined ? undefined : setTimeout(() => { child.off('exit', done); resolve(false); }, timeoutMs);
    child.once('exit', done);
  });
}
export async function startArchiveRetrievalRuntime(input: {
  sessionId: string; sessionRoot: string; archiveView: ArchiveView; promptpileMcpBin: string;
  filesystemMcp: CommandBoundary; runner: ProcessRunner;
}): Promise<ArchiveRetrievalRuntime> {
  const retrieval = path.join(input.sessionRoot, 'retrieval');
  await mkdir(retrieval, { recursive: true });
  let lastError: unknown;
  for (let attempt = 0; attempt < ARCHIVE_RETRIEVAL.portAttempts; attempt += 1) {
    const port = await freePort(), token = randomBytes(32).toString('hex'), baseUrl = `http://127.0.0.1:${port}`;
    const configPath = path.join(retrieval, 'mcp.toml'), hookConfigPath = path.join(retrieval, 'hook.json');
    const candidatePath = path.join(retrieval, 'tools.candidate.toml'), toolsFile = path.join(retrieval, 'tools.toml');
    const hookJs = path.join(__dirname, 'archive-retrieval-hook.js');
    const afterHookPath = path.join(retrieval, process.platform === 'win32' ? 'after-hook.cmd' : 'after-hook.sh');
    const config = {
      version: 1,
      gateway: { port, token },
      defaults: { init_timeout_ms: ARCHIVE_RETRIEVAL.mcpInitTimeoutMs, list_timeout_ms: ARCHIVE_RETRIEVAL.mcpListTimeoutMs },
      behavior: { failure_policy: 'strict', flat_names: true },
      execution: {
        concurrency: ARCHIVE_RETRIEVAL.concurrency, call_timeout_ms: ARCHIVE_RETRIEVAL.toolCallTimeoutMs,
        failure_policy: 'fail_fast', retry_max_attempts: ARCHIVE_RETRIEVAL.retryMaxAttempts,
        retry_base_delay_ms: 250, retry_safe_tools: [...ARCHIVE_RETRIEVAL_TOOL_NAMES],
      },
      servers: { archive: {
        command: input.filesystemMcp.command,
        args: [...input.filesystemMcp.argsPrefix, input.archiveView.root],
        cwd: input.archiveView.root,
        env: { ALLOW_WRITE: 'false', ENABLE_ROOTS: 'false' },
        allowed_tools: [...ARCHIVE_RETRIEVAL_TOOL_NAMES],
      } },
    };
    const hookConfig: ArchiveRetrievalHookConfigV1 = {
      version: 1, promptpileMcpBin: input.promptpileMcpBin, baseUrl, token,
      execRequestTimeoutMs: ARCHIVE_RETRIEVAL.execRequestTimeoutMs,
      maxToolCallsPerThought: ARCHIVE_RETRIEVAL.maxToolCallsPerThought,
      maxToolResultLineBytes: ARCHIVE_RETRIEVAL.maxToolResultLineBytes,
      allowedToolNames: ARCHIVE_RETRIEVAL_TOOL_NAMES,
    };
    await writeFile(configPath, TOML.stringify(config as TOML.JsonMap), { encoding: 'utf8', mode: 0o600 });
    await writeFile(hookConfigPath, `${JSON.stringify(hookConfig, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
    const trampoline = process.platform === 'win32'
      ? `@echo off\r\n${cmdQuote(process.execPath)} ${cmdQuote(hookJs)} ${cmdQuote(hookConfigPath)}\r\nexit /b %errorlevel%\r\n`
      : `#!/bin/sh\nexec ${shellQuote(process.execPath)} ${shellQuote(hookJs)} ${shellQuote(hookConfigPath)}\n`;
    await writeFile(afterHookPath, trampoline, { encoding: 'utf8', mode: 0o700 });
    if (process.platform !== 'win32') await chmod(afterHookPath, 0o700);

    let state: RuntimeState = 'starting', stderr = '';
    const child = spawn(process.execPath, [input.promptpileMcpBin, 'launch', '--config', configPath], { stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true });
    child.stderr?.setEncoding('utf8').on('data', (chunk: string) => { if (stderr.length < 16 * 1024) stderr += chunk.slice(0, 16 * 1024 - stderr.length); });
    child.once('exit', () => { if (state === 'ready') state = 'failed'; });
    try {
      const deadline = Date.now() + ARCHIVE_RETRIEVAL.gatewayStartupTimeoutMs;
      for (;;) {
        if (child.exitCode !== null || child.signalCode !== null) throw retrievalError('startup', stderr || 'Archive retrieval gateway exited during startup.');
        const remaining = deadline - Date.now();
        if (remaining <= 0) throw retrievalError('startup', 'Archive retrieval gateway exceeded its startup deadline.');
        await rm(candidatePath, { force: true });
        try {
          const probe = await input.runner.run(input.promptpileMcpBin, ['export-tools', '--base-url', baseUrl, '--token', token, '-o', candidatePath], { timeoutMs: Math.min(ARCHIVE_RETRIEVAL.readinessProbeTimeoutMs, remaining) });
          if (probe.code === 0) {
            const names = toolNames(TOML.parse(await readFile(candidatePath, 'utf8')));
            if (!sameSet(names, ARCHIVE_RETRIEVAL_TOOL_NAMES)) throw retrievalError('tools', `Archive retrieval exported the wrong tool set: ${names.join(', ')}`);
            await rename(candidatePath, toolsFile); state = 'ready'; break;
          }
        } catch (error) {
          if (error instanceof ArchiveRetrievalError && error.stage === 'tools') throw error;
        }
        await delay(Math.min(ARCHIVE_RETRIEVAL.readinessProbeDelayMs, Math.max(0, deadline - Date.now())));
      }
      const policy: ArtifactPolicy = hookConfig;
      const binding = Object.freeze({ toolsFile, afterHookPath });
      return Object.freeze({
        binding,
        assertHealthy() { if (state !== 'ready') throw retrievalError('runtime', `Archive retrieval runtime is ${state}.`); },
        assertReadyForFinal(workPath: string) {
          if (state !== 'ready') throw retrievalError('runtime', `Archive retrieval runtime is ${state}.`);
          assertWorkRetrievalClosure(workPath, policy);
        },
        async close() {
          if (state === 'closed' || state === 'closing') { if (state === 'closing') await waitForExit(child); return; }
          state = 'closing';
          if (!await waitForExit(child, 0)) child.kill();
          if (!await waitForExit(child, ARCHIVE_RETRIEVAL.gatewayCloseGraceMs)) { child.kill('SIGKILL'); await waitForExit(child); }
          state = 'closed';
        },
      });
    } catch (error) {
      lastError = error; state = 'closing'; child.kill(); await waitForExit(child, ARCHIVE_RETRIEVAL.gatewayCloseGraceMs); state = 'closed';
      await rm(candidatePath, { force: true });
      if (!/EADDRINUSE/i.test(stderr) || attempt + 1 >= ARCHIVE_RETRIEVAL.portAttempts) break;
    }
  }
  await rm(retrieval, { recursive: true, force: true }).catch(() => undefined);
  throw lastError instanceof ArchiveRetrievalError ? lastError : retrievalError('startup', 'Could not start Archive retrieval runtime.', lastError);
}
