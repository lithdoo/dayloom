import { spawn, type ChildProcess } from 'node:child_process';

export interface ProcessResult { code: number | null; stdout: string; stderr: string }
export interface ProcessRunOptions {
  stdin?: string;
  onStdout?: (chunk: string) => void;
  onChild?: (child: ChildProcess) => void;
}
export interface ProcessRunner {
  run(bin: string, args: readonly string[], options?: ProcessRunOptions): Promise<ProcessResult>;
}
export const nodeProcessRunner: ProcessRunner = {
  run(bin, args, options = {}) {
    return new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [bin, ...args], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
      options.onChild?.(child);
      let stdout = '', stderr = '';
      let callbackError: unknown;
      child.stdout!.setEncoding('utf8').on('data', (chunk: string) => {
        stdout += chunk;
        if (callbackError !== undefined) return;
        try { options.onStdout?.(chunk); }
        catch (error) { callbackError = error; child.kill(); }
      });
      child.stderr!.setEncoding('utf8').on('data', (chunk) => { stderr += chunk; });
      child.once('error', reject);
      child.once('close', (code) => callbackError === undefined ? resolve({ code, stdout, stderr }) : reject(callbackError));
      child.stdin!.end(options.stdin ?? '');
    });
  },
};
export async function appendUser(runner: ProcessRunner, promptpileBin: string, directory: string, content: string, onChild?: (child: ChildProcess) => void): Promise<void> {
  const result = await runner.run(promptpileBin, ['conversation', 'append-user', '-d', directory, '--quiet'], { stdin: content, onChild });
  if (result.code !== 0) throw new Error(result.stderr || 'Promptpile append-user failed.');
}
