import { spawn, type ChildProcess } from 'node:child_process';
import type { Readable } from 'node:stream';

export interface ProcessResult { code: number | null; stdout: string; stderr: string }
export interface ProcessRunOptions {
  stdin?: string;
  onStdout?: (chunk: string) => void;
  onExtraPipe?: (chunk: string) => void;
  onChild?: (child: ChildProcess) => void;
  timeoutMs?: number;
}
export interface ProcessRunner {
  run(bin: string, args: readonly string[], options?: ProcessRunOptions): Promise<ProcessResult>;
}
export const nodeProcessRunner: ProcessRunner = {
  run(bin, args, options = {}) {
    return new Promise((resolve, reject) => {
      if (options.timeoutMs !== undefined && (!Number.isFinite(options.timeoutMs) || options.timeoutMs <= 0)) {
        reject(new Error('Process timeoutMs must be a positive finite number.'));
        return;
      }
      const stdio: 'pipe'[] = options.onExtraPipe ? ['pipe', 'pipe', 'pipe', 'pipe'] : ['pipe', 'pipe', 'pipe'];
      const child: ChildProcess = spawn(process.execPath, [bin, ...args], { stdio, windowsHide: true });
      let settled = false, callbackError: unknown, timedOut = false;
      const failCallback = (error: unknown) => {
        if (callbackError !== undefined || timedOut) return;
        callbackError = error; child.kill();
      };
      try { options.onChild?.(child); } catch (error) { failCallback(error); }
      let stdout = '', stderr = '';
      const timer = options.timeoutMs === undefined ? undefined : setTimeout(() => {
        if (settled) return;
        timedOut = true;
        child.kill();
      }, options.timeoutMs);
      child.stdout!.setEncoding('utf8').on('data', (chunk: string) => {
        stdout += chunk;
        if (callbackError !== undefined || timedOut) return;
        try { options.onStdout?.(chunk); } catch (error) { failCallback(error); }
      });
      if (options.onExtraPipe) (child.stdio[3] as Readable).setEncoding('utf8').on('data', (chunk: string) => {
        if (callbackError !== undefined || timedOut) return;
        try { options.onExtraPipe?.(chunk); } catch (error) { failCallback(error); }
      });
      child.stderr!.setEncoding('utf8').on('data', (chunk: string) => {
        if (stderr.length < 64 * 1024) stderr += chunk.slice(0, 64 * 1024 - stderr.length);
      });
      child.once('error', (error) => {
        if (settled) return; settled = true; if (timer) clearTimeout(timer); reject(error);
      });
      child.once('close', (code: number | null) => {
        if (settled) return; settled = true; if (timer) clearTimeout(timer);
        if (callbackError !== undefined) reject(callbackError);
        else if (timedOut) reject(new Error(`Process timed out after ${options.timeoutMs}ms.`));
        else resolve({ code, stdout, stderr });
      });
      child.stdin!.end(options.stdin ?? '');
    });
  },
};
export async function appendUser(runner: ProcessRunner, promptpileBin: string, directory: string, content: string, onChild?: (child: ChildProcess) => void): Promise<void> {
  const result = await runner.run(promptpileBin, ['conversation', 'append-user', '-d', directory, '--quiet'], { stdin: content, onChild });
  if (result.code !== 0) throw new Error(result.stderr || 'Promptpile append-user failed.');
}
