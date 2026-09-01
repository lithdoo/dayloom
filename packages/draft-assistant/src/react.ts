import type { Writable } from 'node:stream';
import { runCommandV1, spawnForwardedV1, type ProcessResultV1 } from './process.js';
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
    '--output-format', 'stream-json',
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
  if (input.outputFormat === 'terminal') return runProjectedDialogueV1(input);
  return spawnForwardedV1({
    command: process.execPath,
    args: [input.reactBin, ...dialogueReactArgvV1(input)],
    stdout: input.stdout,
    stderr: input.stderr,
  });
}

async function runProjectedDialogueV1(input: ReactBaseV1 & {
  outputFormat: AssistantOutputFormatV1;
  stdout: Writable;
  stderr: Writable;
}): Promise<number> {
  const result = await runCommandV1(process.execPath, [input.reactBin, ...dialogueReactArgvV1(input)]);
  if (result.stderr !== '') input.stderr.write(result.stderr);
  if (result.code !== 0) return result.code ?? 1;
  input.stdout.write(`${approvedFinalFromEventsV1(result.stdout)}\n`);
  return 0;
}

export function approvedFinalFromEventsV1(stdout: string): string {
  let terminal: { type?: unknown; final?: { status?: unknown; content?: unknown } } | null = null;
  for (const line of stdout.split(/\r?\n/)) {
    if (line.trim() === '') continue;
    let event: { type?: unknown; final?: { status?: unknown; content?: unknown } };
    try { event = JSON.parse(line) as typeof event; }
    catch { throw new Error('Dialogue React emitted malformed Agent Event JSONL.'); }
    if (event.type === 'session.completed') terminal = event;
  }
  if (terminal?.final?.status !== 'completed' || typeof terminal.final.content !== 'string') {
    throw new Error('Dialogue React completed without an approved Final.');
  }
  return terminal.final.content;
}

export function runSyncReactV1(input: ReactBaseV1): Promise<ProcessResultV1> {
  return runCommandV1(process.execPath, [input.reactBin, ...syncReactArgvV1(input)]);
}
