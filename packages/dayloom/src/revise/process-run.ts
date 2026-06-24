import { spawn, type ChildProcess } from 'child_process';
import type { Readable } from 'stream';

export interface RunResult {
  status: number | null;
  stdout: string;
  stderr: string;
  error?: Error;
}

export interface RunProcessOptions {
  cwd: string;
  env?: NodeJS.ProcessEnv;
  quiet?: boolean;
  outputPile?: {
    fd: number;
    onData: (chunk: string) => void;
  };
}

export function runProcess(command: string, args: string[], options: RunProcessOptions): Promise<RunResult> {
  return new Promise(resolve => {
    const stdio = options.outputPile ? ['ignore', 'pipe', 'pipe', 'pipe'] : ['ignore', 'pipe', 'pipe'];
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env ?? process.env,
      stdio: stdio as ['ignore', 'pipe', 'pipe', ...Array<'pipe'>]
    });
    let stdout = '';
    let stderr = '';
    let spawnError: Error | undefined;
    let outputPileError: Error | undefined;
    let resolved = false;

    const resolveOnce = (result: RunResult): void => {
      if (resolved) return;
      resolved = true;
      resolve(result);
    };

    child.stdout?.on('data', chunk => {
      const text = chunk.toString();
      stdout += text;
      if (!options.quiet) process.stdout.write(text);
    });
    child.stderr?.on('data', chunk => {
      const text = chunk.toString();
      stderr += text;
      if (!options.quiet) process.stderr.write(text);
    });

    if (options.outputPile) {
      const outputStream = child.stdio[options.outputPile.fd] as Readable | null | undefined;
      if (!outputStream || typeof outputStream.on !== 'function') {
        outputPileError = new Error('promptpile output fd ' + options.outputPile.fd + ' was not created');
        child.kill();
      } else {
        outputStream.setEncoding('utf8');
        outputStream.on('data', chunk => {
          try {
            options.outputPile?.onData(String(chunk));
          } catch (e) {
            outputPileError = e instanceof Error ? e : new Error(String(e));
            child.kill();
          }
        });
        outputStream.on('error', error => {
          outputPileError = new Error('promptpile output fd ' + options.outputPile?.fd + ' error: ' + error.message);
          child.kill();
        });
      }
    }

    child.on('error', error => {
      spawnError = error;
    });
    child.on('close', status => {
      resolveOnce({ status, stdout, stderr, error: outputPileError ?? spawnError });
    });
  });
}

export function stopChild(child: ChildProcess): Promise<void> {
  return new Promise(resolve => {
    if (child.exitCode !== null || child.signalCode !== null) return resolve();
    const timer = setTimeout(() => { if (child.exitCode === null) child.kill('SIGKILL'); }, 3000);
    child.once('close', () => { clearTimeout(timer); resolve(); });
    child.kill('SIGTERM');
  });
}
