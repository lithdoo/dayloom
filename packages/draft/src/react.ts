import type { Writable } from 'node:stream';
import { spawnForwardedV1 } from './process.js';
import type { OutputFormatV1 } from './argv.js';

export const INTERNAL_REACT_MAX_STEP_V1 = 8;

export interface ReactInvocationV1 {
  reactBin: string;
  config: string;
  conversation: string;
  workRoot: string;
  outputFormat: OutputFormatV1;
  stdout: Writable;
  stderr: Writable;
}

export function reactArgvV1(input: Omit<ReactInvocationV1, 'reactBin' | 'stdout' | 'stderr'>): string[] {
  return [
    '--config', input.config,
    '-d', input.conversation,
    '--output-dir', input.conversation,
    '--continue',
    '--output-format', input.outputFormat,
    '--max-step', String(INTERNAL_REACT_MAX_STEP_V1),
    '--work-root', input.workRoot,
  ];
}

export async function runPromptpileReactV1(input: ReactInvocationV1): Promise<number> {
  return spawnForwardedV1({
    command: process.execPath,
    args: [input.reactBin, ...reactArgvV1(input)],
    stdout: input.stdout,
    stderr: input.stderr,
  });
}
