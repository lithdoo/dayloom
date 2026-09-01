import { mkdir, rm } from 'node:fs/promises';
import type { ValidateFunction } from 'ajv';
import { runNodeCliV1 } from './process.js';

interface AgentEventV1 {
  type: string;
  session_id: string;
  sequence: number;
  final?: { status: 'completed' | 'skipped'; content?: string };
  error?: { code: string; message: string };
}

export class ReactProcessErrorV1 extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = 'ReactProcessErrorV1';
  }
}

export async function appendPromptpileUserV1(promptpileBin: string, directory: string, content: string): Promise<void> {
  await mkdir(directory, { recursive: true });
  const result = await runNodeCliV1(promptpileBin, ['conversation', 'append-user', '-d', directory, '--quiet'], { stdin: content, timeoutMs: 30_000 });
  if (result.code !== 0) throw new Error(result.stderr || 'Promptpile append-user failed.');
}

export async function runPromptpileReactV1(input: {
  reactBin: string;
  validateAgentEvent: ValidateFunction;
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

  const reducer = new AgentEventReducerV1(input.validateAgentEvent);

  const result = await runNodeCliV1(input.reactBin, [
    '--config', input.config,
    '-d', input.context,
    '--output-dir', input.conversation,
    '--continue',
    '--max-step', String(input.maxSteps ?? 10),
    '--work-root', input.workRoot,
    '--quiet',
    '--output-format', 'stream-json',
  ], { timeoutMs: input.timeoutMs ?? 5 * 60_000 });

  for (const line of result.stdout.split(/\r?\n/)) reducer.consume(line);
  return reducer.finish(result.code, result.stderr);
}

class AgentEventReducerV1 {
  private expectedSequence = 0;
  private sessionId: string | null = null;
  private terminal: AgentEventV1 | null = null;

  constructor(private readonly validate: ValidateFunction) {}

  consume(line: string): void {
    if (line.length === 0) return;
    let event: AgentEventV1;
    try { event = JSON.parse(line) as AgentEventV1; }
    catch { throw new Error('React emitted malformed Agent Event JSONL.'); }
    if (!this.validate(event)) throw new Error('React emitted an event that violates Agent Event v1.');
    if (this.terminal !== null) throw new Error('React emitted an Agent Event after terminal.');
    if (event.sequence !== this.expectedSequence) throw new Error('React Agent Event sequence is not contiguous.');
    this.expectedSequence += 1;
    if (this.sessionId === null) {
      if (event.type !== 'session.started' || event.sequence !== 0) throw new Error('First Agent Event must be session.started.');
      this.sessionId = event.session_id;
      return;
    }
    if (event.session_id !== this.sessionId) throw new Error('React Agent Event session_id changed.');
    if (event.type === 'session.completed' || event.type === 'session.failed') this.terminal = event;
  }

  finish(exitCode: number | null, stderr: string): string {
    if (this.terminal === null) throw new Error('React Agent Event stream ended before terminal.');
    if (this.terminal.type === 'session.failed') {
      throw new ReactProcessErrorV1(
        this.terminal.error?.code ?? 'react_process_failed',
        this.terminal.error?.message ?? (stderr || 'React process failed.'),
      );
    }
    if (exitCode !== 0) throw new Error(stderr || 'React completed but the child exit code was nonzero.');
    if (this.terminal.final?.status !== 'completed' || typeof this.terminal.final.content !== 'string' || this.terminal.final.content.trim() === '') {
      throw new Error('React Final evidence is missing or empty.');
    }
    return this.terminal.final.content;
  }
}
