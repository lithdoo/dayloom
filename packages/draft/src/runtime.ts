import { randomBytes } from 'node:crypto';
import { chmod, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { spawn, type ChildProcess } from 'node:child_process';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as TOML from '@iarna/toml';
import type { CommandBoundaryV1 } from './binaries.js';
import { runNodeCliV1 } from './process.js';
import type { DraftAuthorityV1 } from './authority.js';
import { draftErrorV1 } from './errors.js';
import type { FileHookConfigV1 } from './hook.js';

export const WORLD_READ_TOOLS_V1 = Object.freeze([
  'list_directory',
  'directory_tree',
  'search_files',
  'search_files_content',
  'read_file_lines',
] as const);

export const DRAFT_FILE_TOOLS_V1 = Object.freeze([
  'read_file_lines',
  'write_file',
] as const);

export const DRAFT_DIRECTORY_MCP_TOOLS_V1 = Object.freeze([
  ...WORLD_READ_TOOLS_V1,
  'create_directory',
  'write_file',
] as const);

export const DRAFT_DIRECTORY_TOOLS_V1 = Object.freeze([
  ...DRAFT_DIRECTORY_MCP_TOOLS_V1,
  'delete_file',
] as const);

export interface FileRuntimeBindingV1 {
  toolsFile: string;
  afterHookPath: string;
  hookConfigPath: string;
  toolNames: readonly string[];
}

export interface FileRuntimeV1 {
  binding: Readonly<FileRuntimeBindingV1>;
  close(): Promise<void>;
}

const settings = Object.freeze({
  startupMs: 15_000,
  probeMs: 3_000,
  probeDelayMs: 200,
  closeMs: 2_000,
  initMs: 10_000,
  listMs: 10_000,
  callMs: 20_000,
  execMs: 30_000,
  ports: 5,
  maxToolCallsPerThought: 8,
  maxToolResultLineBytes: 256 * 1024,
});

export async function startFileRuntimeV1(input: {
  runtimeRoot: string;
  promptpileMcpBin: string;
  filesystemMcp: CommandBoundaryV1;
  worldRoot: string | null;
  draft: DraftAuthorityV1;
}): Promise<FileRuntimeV1> {
  await mkdir(input.runtimeRoot, { recursive: true });
  const mcpDraftTools = input.draft.mode === 'files' ? DRAFT_FILE_TOOLS_V1 : DRAFT_DIRECTORY_MCP_TOOLS_V1;
  const draftRoot = input.draft.mode === 'files' ? input.draft.mcpRoot : input.draft.root;
  const expectedTools = Object.freeze([
    ...(input.worldRoot === null ? [] : WORLD_READ_TOOLS_V1.map((tool) => `mcp__world__${tool}`)),
    ...mcpDraftTools.map((tool) => `mcp__draft__${tool}`),
    ...(input.draft.mode === 'directory' ? ['mcp__draft__delete_file'] : []),
  ]);
  let lastError: unknown;

  for (let attempt = 0; attempt < settings.ports; attempt += 1) {
    const port = await freePortV1();
    const token = randomBytes(32).toString('hex');
    const baseUrl = `http://127.0.0.1:${port}`;
    const configPath = path.join(input.runtimeRoot, 'mcp.toml');
    const hookConfigPath = path.join(input.runtimeRoot, 'hook.json');
    const candidateTools = path.join(input.runtimeRoot, 'tools.candidate.toml');
    const toolsFile = path.join(input.runtimeRoot, 'tools.toml');
    const hookJs = fileURLToPath(new URL('./hook.js', import.meta.url));
    const afterHookPath = path.join(input.runtimeRoot, process.platform === 'win32' ? 'after-hook.cmd' : 'after-hook.sh');

    const server = (root: string, writable: boolean, tools: readonly string[]) => ({
      command: input.filesystemMcp.command,
      args: [...input.filesystemMcp.argsPrefix, root],
      cwd: root,
      env: { ALLOW_WRITE: String(writable), ENABLE_ROOTS: 'false' },
      allowed_tools: [...tools],
    });

    const servers: TOML.JsonMap = {
      draft: server(draftRoot, true, mcpDraftTools),
    };
    if (input.worldRoot !== null) servers.world = server(input.worldRoot, false, WORLD_READ_TOOLS_V1);

    const config: TOML.JsonMap = {
      version: 1,
      gateway: { port, token },
      defaults: { init_timeout_ms: settings.initMs, list_timeout_ms: settings.listMs },
      behavior: { failure_policy: 'strict', flat_names: false },
      execution: {
        concurrency: 1,
        call_timeout_ms: settings.callMs,
        failure_policy: 'fail_fast',
        retry_max_attempts: 2,
        retry_base_delay_ms: 250,
        retry_safe_tools: expectedTools.filter((name) => !name.endsWith('__write_file') && !name.endsWith('__delete_file') && !name.endsWith('__create_directory')),
      },
      servers,
    };

    const hookConfig: FileHookConfigV1 = {
      version: 1,
      promptpileMcpBin: input.promptpileMcpBin,
      baseUrl,
      token,
      execRequestTimeoutMs: settings.execMs,
      maxToolCallsPerThought: settings.maxToolCallsPerThought,
      maxToolResultLineBytes: settings.maxToolResultLineBytes,
      allowedToolNames: expectedTools,
      worldRoot: input.worldRoot,
      draft: input.draft.mode === 'files'
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

    let state: 'starting' | 'ready' | 'failed' | 'closing' | 'closed' = 'starting';
    let stderr = '';
    const child: ChildProcess = spawn(process.execPath, [input.promptpileMcpBin, 'launch', '--config', configPath], {
      stdio: ['ignore', 'ignore', 'pipe'],
      windowsHide: true,
    });
    child.stderr?.setEncoding('utf8').on('data', (chunk: string) => {
      if (stderr.length < 16 * 1024) stderr += chunk.slice(0, 16 * 1024 - stderr.length);
    });
    child.once('exit', () => { if (state === 'ready') state = 'failed'; });

    try {
      const deadline = Date.now() + settings.startupMs;
      for (;;) {
        if (child.exitCode !== null || child.signalCode !== null) {
          throw new Error(stderr || 'Promptpile MCP gateway exited during startup.');
        }
        const remaining = deadline - Date.now();
        if (remaining <= 0) throw new Error('Promptpile MCP gateway exceeded its startup deadline.');
        await rm(candidateTools, { force: true });
        try {
          const probe = await runNodeCliV1(
            input.promptpileMcpBin,
            ['export-tools', '--base-url', baseUrl, '--token', token, '-o', candidateTools],
            { timeoutMs: Math.min(settings.probeMs, remaining) },
          );
          if (probe.code === 0) {
            const document = TOML.parse(await readFile(candidateTools, 'utf8')) as TOML.JsonMap;
            const exported = toolNamesV1(document);
            const gatewayTools = expectedTools.filter((name) => name !== 'mcp__draft__delete_file');
            if (!sameSetV1(exported, gatewayTools)) {
              throw new Error(`Promptpile MCP exported the wrong tool set: ${exported.join(', ')}.`);
            }
            if (input.draft.mode === 'directory') {
              const tools = document.tools as TOML.JsonMap[];
              tools.push({
                name: 'mcp__draft__delete_file',
                description: 'Delete one regular file inside the granted Draft directory.',
                parameters: {
                  type: 'object',
                  required: ['path'],
                  properties: { path: { type: 'string', description: 'Draft-relative path of the file to delete.' } },
                },
              });
              await writeFile(candidateTools, TOML.stringify(document), { encoding: 'utf8', mode: 0o600 });
            }
            await rename(candidateTools, toolsFile);
            state = 'ready';
            break;
          }
        } catch (error) {
          if (error instanceof Error && /wrong tool set/.test(error.message)) throw error;
        }
        await delayV1(Math.min(settings.probeDelayMs, Math.max(0, deadline - Date.now())));
      }

      return Object.freeze({
        binding: Object.freeze({ toolsFile, afterHookPath, hookConfigPath, toolNames: expectedTools }),
        async close() {
          if (state === 'closed') return;
          if (state === 'closing') { await waitForExitV1(child); return; }
          state = 'closing';
          if (!await waitForExitV1(child, 0)) child.kill();
          if (!await waitForExitV1(child, settings.closeMs)) {
            child.kill('SIGKILL');
            await waitForExitV1(child);
          }
          state = 'closed';
        },
      });
    } catch (error) {
      lastError = error;
      state = 'closing';
      child.kill();
      await waitForExitV1(child, settings.closeMs);
      state = 'closed';
      await rm(candidateTools, { force: true });
      if (!/EADDRINUSE/i.test(stderr) || attempt + 1 >= settings.ports) break;
    }
  }

  await rm(input.runtimeRoot, { recursive: true, force: true }).catch(() => undefined);
  throw draftErrorV1(
    'MCP_FAILED',
    lastError instanceof Error ? lastError.message : 'Could not start Promptpile file runtime.',
  );
}

const delayV1 = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function freePortV1(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        server.close();
        reject(new Error('Could not allocate loopback port.'));
        return;
      }
      server.close((error) => error ? reject(error) : resolve(address.port));
    });
  });
}

function toolNamesV1(value: unknown): string[] {
  if (!value || typeof value !== 'object' || !Array.isArray((value as { tools?: unknown }).tools)) {
    throw new Error('Exported tools file is malformed.');
  }
  return (value as { tools: Array<{ name?: unknown }> }).tools.map((tool) => {
    if (typeof tool.name !== 'string') throw new Error('Exported tool entry is malformed.');
    return tool.name;
  });
}

function sameSetV1(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && new Set(left).size === left.length && left.every((item) => right.includes(item));
}

function shellQuoteV1(value: string): string { return `'${value.replace(/'/g, `'"'"'`)}'`; }
function cmdQuoteV1(value: string): string { return `"${value.replace(/"/g, '""')}"`; }

async function waitForExitV1(child: ChildProcess, timeoutMs?: number): Promise<boolean> {
  if (child.exitCode !== null || child.signalCode !== null) return true;
  return new Promise((resolve) => {
    const done = () => { if (timer) clearTimeout(timer); resolve(true); };
    const timer = timeoutMs === undefined ? undefined : setTimeout(() => { child.off('exit', done); resolve(false); }, timeoutMs);
    child.once('exit', done);
  });
}
