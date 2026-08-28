import { mkdir, rm } from 'node:fs/promises';
import type { ValidateFunction } from 'ajv';
import { runNodeCliV1 } from './process.js';

interface ProcessEventV1 {
  type: string;
  process_id: string;
  sequence: number;
  final?: { status: 'completed' | 'skipped'; content?: string };
  error?: { code: string; message: string };
}

export async function appendPromptpileUserV1(promptpileBin: string, directory: string, content: string): Promise<void> {
  await mkdir(directory, { recursive: true });
  const result = await runNodeCliV1(promptpileBin, ['conversation', 'append-user', '-d', directory, '--quiet'], { stdin: content, timeoutMs: 30_000 });
  if (result.code !== 0) throw new Error(result.stderr || 'Promptpile append-user failed.');
}

export async function runPromptpileReactV1(input: {
  reactBin: string;
  validateProcessPile: ValidateFunction;
  config: string;
  context: string;
  conversation: string;
  workRoot: string;
  maxSteps?: number;
  timeoutMs?: number;
}): Promise<string> {
  await rm(input.workRoot, { recursive: true, force: true });
  await mkdir(input.workRoot, { recursive: true });
  await mkdir(input.context, { recursive: true });
  await mkdir(input.conversation, { recursive: true });

  const reducer = new ProcessPileReducerV1(input.validateProcessPile);
  let buffer = '';
  const consume = (chunk: string) => {
    buffer += chunk;
    if (buffer.length > 1024 * 1024 && !buffer.includes('\n')) throw new Error('React Process Pile line exceeds the size limit.');
    for (;;) {
      const newline = buffer.indexOf('\n');
      if (newline < 0) break;
      const raw = buffer.slice(0, newline);
      buffer = buffer.slice(newline + 1);
      reducer.consume(raw.endsWith('\r') ? raw.slice(0, -1) : raw);
    }
  };

  const result = await runNodeCliV1(input.reactBin, [
    '--config', input.config,
    '-d', input.context,
    '--output-dir', input.conversation,
    '--continue',
    '--max-step', String(input.maxSteps ?? 10),
    '--work-root', input.workRoot,
    '--work-lifecycle', 'caller',
    '--quiet',
    '--process-pile-fd', '3',
    '--process-pile-format', 'json',
  ], { onExtraPipe: consume, timeoutMs: input.timeoutMs ?? 5 * 60_000 });

  if (buffer.length !== 0) throw new Error('React emitted truncated Process Pile JSONL.');
  return reducer.finish(result.code, result.stderr);
}

class ProcessPileReducerV1 {
  private expectedSequence = 0;
  private processId: string | null = null;
  private terminal: ProcessEventV1 | null = null;

  constructor(private readonly validate: ValidateFunction) {}

  consume(line: string): void {
    if (line.length === 0) return;
    let event: ProcessEventV1;
    try { event = JSON.parse(line) as ProcessEventV1; }
    catch { throw new Error('React emitted malformed Process Pile JSONL.'); }
    if (!this.validate(event)) throw new Error('React emitted an event that violates Process Pile v1.');
    if (this.terminal !== null) throw new Error('React emitted a Process Pile event after terminal.');
    if (event.sequence !== this.expectedSequence) throw new Error('React Process Pile sequence is not contiguous.');
    this.expectedSequence += 1;
    if (this.processId === null) {
      if (event.type !== 'process.started' || event.sequence !== 0) throw new Error('First Process Pile event must be process.started.');
      this.processId = event.process_id;
      return;
    }
    if (event.process_id !== this.processId) throw new Error('React Process Pile process_id changed.');
    if (event.type === 'process.completed' || event.type === 'process.failed') this.terminal = event;
  }

  finish(exitCode: number | null, stderr: string): string {
    if (this.terminal === null) throw new Error('React Process Pile ended before terminal.');
    if (this.terminal.type === 'process.failed') throw new Error(this.terminal.error?.message ?? (stderr || 'React process failed.'));
    if (exitCode !== 0) throw new Error(stderr || 'React completed but the child exit code was nonzero.');
    if (this.terminal.final?.status !== 'completed' || typeof this.terminal.final.content !== 'string' || this.terminal.final.content.trim() === '') {
      throw new Error('React Final evidence is missing or empty.');
    }
    return this.terminal.final.content;
  }
}
