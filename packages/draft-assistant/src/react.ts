import type { Writable } from 'node:stream';
import { runCommandV1, spawnForwardedV1, type ProcessResultV1 } from '@dayloom/draft';
import type { AssistantOutputFormatV1 } from './argv.js';

export const DIALOGUE_MAX_STEP_V1 = 4;
export const SYNC_MAX_STEP_V1 = 6;
export const OBSERVE_CARRYOVER_V1 = 1;

interface ReactBaseV1 {
  reactBin: string;
  config: string;
  conversation: string;
  workRoot: string;
}

export function dialogueReactArgvV1(input: Omit<ReactBaseV1, 'reactBin'> & { outputFormat: AssistantOutputFormatV1 }): string[] {
  return [
    '--config', input.config,
    '-d', input.conversation,
    '--output-dir', input.conversation,
    '--continue',
    '--output-format', input.outputFormat,
    '--max-step', String(DIALOGUE_MAX_STEP_V1),
    '--max-step-policy', 'error',
    '--observe-carryover', String(OBSERVE_CARRYOVER_V1),
    '--work-root', input.workRoot,
  ];
}

export function syncReactArgvV1(input: Omit<ReactBaseV1, 'reactBin'>): string[] {
  return [
    '--config', input.config,
    '-d', input.conversation,
    '--output-format', 'terminal',
    '--max-step', String(SYNC_MAX_STEP_V1),
    '--max-step-policy', 'error',
    '--observe-carryover', String(OBSERVE_CARRYOVER_V1),
    '--work-root', input.workRoot,
  ];
}

export function runDialogueReactV1(input: ReactBaseV1 & {
  outputFormat: AssistantOutputFormatV1;
  stdout: Writable;
  stderr: Writable;
}): Promise<number> {
  return spawnForwardedV1({
    command: process.execPath,
    args: [input.reactBin, ...dialogueReactArgvV1(input)],
    stdout: input.stdout,
    stderr: input.stderr,
  });
}

export function runSyncReactV1(input: ReactBaseV1): Promise<ProcessResultV1> {
  return runCommandV1(process.execPath, [input.reactBin, ...syncReactArgvV1(input)]);
}
