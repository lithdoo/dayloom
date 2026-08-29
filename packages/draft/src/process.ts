import { spawn, type ChildProcess, type SpawnOptions } from 'node:child_process';
import type { Readable, Writable } from 'node:stream';

export interface ProcessResultV1 {
  code: number | null;
  stdout: string;
  stderr: string;
}

export async function runCommandV1(
  command: string,
  args: readonly string[],
  options: { stdin?: string; timeoutMs?: number } = {},
): Promise<ProcessResultV1> {
  if (options.timeoutMs !== undefined && (!Number.isFinite(options.timeoutMs) || options.timeoutMs <= 0)) {
    throw new Error('Process timeout must be a positive finite number.');
  }
  return new Promise((resolve, reject) => {
    const child: ChildProcess = spawn(command, [...args], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    let stdout = '';
    let stderr = '';
    let settled = false;
    let timedOut = false;
    const timer = options.timeoutMs === undefined ? undefined : setTimeout(() => {
      if (settled) return;
      timedOut = true;
      child.kill();
    }, options.timeoutMs);

    child.stdout?.setEncoding('utf8').on('data', (chunk: string) => {
      if (stdout.length < 1024 * 1024) stdout += chunk.slice(0, 1024 * 1024 - stdout.length);
    });
    child.stderr?.setEncoding('utf8').on('data', (chunk: string) => {
      if (stderr.length < 128 * 1024) stderr += chunk.slice(0, 128 * 1024 - stderr.length);
    });
    child.once('error', (error) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      reject(error);
    });
    child.once('close', (code) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      if (timedOut) reject(new Error(`Process timed out after ${options.timeoutMs}ms.`));
      else resolve({ code, stdout, stderr });
    });
    child.stdin?.end(options.stdin ?? '');
  });
}

export async function runNodeCliV1(
  bin: string,
  args: readonly string[],
  options: { stdin?: string; timeoutMs?: number } = {},
): Promise<ProcessResultV1> {
  return runCommandV1(process.execPath, [bin, ...args], options);
}

export async function spawnForwardedV1(input: {
  command: string;
  args: readonly string[];
  stdout: Writable;
  stderr: Writable;
}): Promise<number> {
  const stdio: SpawnOptions['stdio'] = ['ignore', 'pipe', 'pipe'];
  const child = spawn(input.command, [...input.args], { stdio, windowsHide: true });
  await Promise.all([
    pipeKeepOpenV1(child.stdout, input.stdout),
    pipeKeepOpenV1(child.stderr, input.stderr),
  ]);
  const code = await waitForExitCodeV1(child);
  return code ?? 1;
}

function pipeKeepOpenV1(readable: Readable | null, writable: Writable): Promise<void> {
  if (!readable) return Promise.resolve();
  return new Promise((resolve, reject) => {
    readable.pipe(writable, { end: false });
    readable.once('error', reject);
    readable.once('end', resolve);
  });
}

function waitForExitCodeV1(child: ChildProcess): Promise<number | null> {
  if (child.exitCode !== null) return Promise.resolve(child.exitCode);
  return new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('close', (code) => resolve(code));
  });
}
