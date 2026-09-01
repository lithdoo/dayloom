import { spawn, type ChildProcess, type SpawnOptions } from 'node:child_process';
import type { Readable, Writable } from 'node:stream';

export interface ProcessResultV1 { code: number | null; stdout: string; stderr: string }

export function runCommandV1(command: string, args: readonly string[], options: { stdin?: string; timeoutMs?: number; cwd?: string } = {}): Promise<ProcessResultV1> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, [...args], { cwd: options.cwd, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    let stdout = '';
    let stderr = '';
    let settled = false;
    let timedOut = false;
    const timer = options.timeoutMs === undefined ? undefined : setTimeout(() => { timedOut = true; child.kill(); }, options.timeoutMs);
    child.stdout?.setEncoding('utf8').on('data', (chunk: string) => { stdout += chunk; });
    child.stderr?.setEncoding('utf8').on('data', (chunk: string) => { stderr += chunk; });
    child.once('error', (error) => { if (!settled) { settled = true; if (timer) clearTimeout(timer); reject(error); } });
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

export function runNodeCliV1(bin: string, args: readonly string[], options: { stdin?: string; timeoutMs?: number; cwd?: string } = {}): Promise<ProcessResultV1> {
  return runCommandV1(process.execPath, [bin, ...args], options);
}

export async function spawnForwardedV1(input: { command: string; args: readonly string[]; stdout: Writable; stderr: Writable; cwd?: string }): Promise<number> {
  const stdio: SpawnOptions['stdio'] = ['ignore', 'pipe', 'pipe'];
  const child = spawn(input.command, [...input.args], { cwd: input.cwd, stdio, windowsHide: true });
  await Promise.all([pipeKeepOpenV1(child.stdout, input.stdout), pipeKeepOpenV1(child.stderr, input.stderr)]);
  return (await waitForExitCodeV1(child)) ?? 1;
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
  return new Promise((resolve, reject) => { child.once('error', reject); child.once('close', resolve); });
}
