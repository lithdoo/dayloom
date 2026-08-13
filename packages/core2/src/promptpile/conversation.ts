import { spawn, type ChildProcess } from 'node:child_process';

export interface ProcessResult { code: number | null; stdout: string; stderr: string }
export interface ProcessRunner {
  run(bin: string, args: readonly string[], stdin?: string, onChild?: (child: ChildProcess) => void): Promise<ProcessResult>;
}
export const nodeProcessRunner: ProcessRunner = {
  run(bin, args, stdin, onChild) {
    return new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [bin, ...args], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
      onChild?.(child);
      let stdout = '', stderr = '';
      child.stdout!.setEncoding('utf8').on('data', (chunk) => { stdout += chunk; });
      child.stderr!.setEncoding('utf8').on('data', (chunk) => { stderr += chunk; });
      child.once('error', reject);
      child.once('close', (code) => resolve({ code, stdout, stderr }));
      child.stdin!.end(stdin ?? '');
    });
  },
};
export async function appendUser(runner: ProcessRunner, promptpileBin: string, directory: string, content: string, onChild?: (child: ChildProcess) => void): Promise<void> {
  const result = await runner.run(promptpileBin, ['conversation', 'append-user', '-d', directory, '--quiet'], content, onChild);
  if (result.code !== 0) throw new Error(result.stderr || 'Promptpile append-user failed.');
}
