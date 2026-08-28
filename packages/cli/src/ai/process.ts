import { spawn, type ChildProcess, type SpawnOptions } from 'node:child_process';
import type { Readable } from 'node:stream';

export interface ProcessResultV1 {
  code: number | null;
  stdout: string;
  stderr: string;
}

export interface ProcessRunOptionsV1 {
  stdin?: string;
  onExtraPipe?: (chunk: string) => void;
  timeoutMs?: number;
}

export async function runNodeCliV1(bin: string, args: readonly string[], options: ProcessRunOptionsV1 = {}): Promise<ProcessResultV1> {
  return runCommandV1(process.execPath, [bin, ...args], options);
}

export async function runCommandV1(command: string, args: readonly string[], options: ProcessRunOptionsV1 = {}): Promise<ProcessResultV1> {
  if (options.timeoutMs !== undefined && (!Number.isFinite(options.timeoutMs) || options.timeoutMs <= 0)) throw new Error('Process timeout must be a positive finite number.');
  return new Promise((resolve, reject) => {
    const stdio: SpawnOptions['stdio'] = options.onExtraPipe ? ['pipe', 'pipe', 'pipe', 'pipe'] : ['pipe', 'pipe', 'pipe'];
    const child: ChildProcess = spawn(command, [...args], { stdio, windowsHide: true });
    let stdout = '';
    let stderr = '';
    let settled = false;
    let callbackError: unknown;
    let timedOut = false;
    const timer = options.timeoutMs === undefined ? undefined : setTimeout(() => {
      if (settled) return;
      timedOut = true;
      child.kill();
    }, options.timeoutMs);

    child.stdout?.setEncoding('utf8').on('data', (chunk: string) => { if (stdout.length < 1024 * 1024) stdout += chunk.slice(0, 1024 * 1024 - stdout.length); });
    child.stderr?.setEncoding('utf8').on('data', (chunk: string) => { if (stderr.length < 128 * 1024) stderr += chunk.slice(0, 128 * 1024 - stderr.length); });
    if (options.onExtraPipe && child.stdio[3]) {
      (child.stdio[3] as Readable).setEncoding('utf8').on('data', (chunk: string) => {
        if (callbackError !== undefined || timedOut) return;
        try { options.onExtraPipe?.(chunk); }
        catch (error) { callbackError = error; child.kill(); }
      });
    }
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
      if (callbackError !== undefined) reject(callbackError);
      else if (timedOut) reject(new Error(`Process timed out after ${options.timeoutMs}ms.`));
      else resolve({ code, stdout, stderr });
    });
    child.stdin?.end(options.stdin ?? '');
  });
}
