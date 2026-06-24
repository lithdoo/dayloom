import fs from 'fs';
import path from 'path';
import { createPromptpileStreamConsumer } from '../shared/promptpile-stream';
import { runProcess } from '../revise/process-run';
import type { InitSession } from './types';

const OUTPUT_PILE_FD = 3;

export type PromptpileSpawnConfig = {
  command: string;
  argvPrefix: string[];
  displayName: string;
};

function tryResolveBundledPromptpileScript(): string | null {
  try {
    const pkgJson = require.resolve('promptpile/package.json');
    const script = path.join(path.dirname(pkgJson), 'dist', 'index.js');
    return fs.existsSync(script) ? script : null;
  } catch {
    return null;
  }
}

export function getPromptpileSpawnConfig(): PromptpileSpawnConfig {
  const bin = process.env.PROMPTPILE_BIN?.trim();
  if (bin) {
    return { command: bin, argvPrefix: [], displayName: bin };
  }
  const bundled = tryResolveBundledPromptpileScript();
  if (bundled) {
    return {
      command: process.execPath,
      argvPrefix: [bundled],
      displayName: 'node "' + bundled + '"',
    };
  }
  return { command: 'promptpile', argvPrefix: [], displayName: 'promptpile' };
}

export type PromptpileRunResult = {
  status: number | null;
  stdout: string;
  stderr: string;
  error?: Error;
};

export async function runPromptpile(
  session: InitSession,
  cliArgs: string[],
  options: { quiet?: boolean; onDelta?: (text: string) => void } = {}
): Promise<PromptpileRunResult> {
  const spawnConfig = getPromptpileSpawnConfig();
  const consumer = createPromptpileStreamConsumer({
    onDelta: text => options.onDelta?.(text),
    onError: message => {
      throw new Error('promptpile stream error: ' + message);
    }
  });

  const result = await runProcess(
    spawnConfig.command,
    [
      ...spawnConfig.argvPrefix,
      ...cliArgs,
      '--quiet',
      '--output-pile-fd',
      String(OUTPUT_PILE_FD),
      '--output-pile-format',
      'json'
    ],
    {
      cwd: session.root,
      quiet: options.quiet ?? true,
      outputPile: {
        fd: OUTPUT_PILE_FD,
        onData: chunk => consumer.push(chunk)
      }
    }
  );

  try {
    consumer.flush();
  } catch (e) {
    return { ...result, error: e instanceof Error ? e : new Error(String(e)) };
  }

  return result;
}

export function assertPromptpileOk(
  result: PromptpileRunResult,
  context: string
): void {
  if (result.error) {
    throw new Error(
      context + ': failed to run promptpile (' + result.error.message + '). ' +
        'Check ' + getPromptpileSpawnConfig().displayName + ' is available.'
    );
  }
  if (result.status !== 0) {
    const tail = result.stderr.trim().slice(-500);
    throw new Error(
      context + ': promptpile exited with code ' + result.status + (tail ? ': ' + tail : '')
    );
  }
}
