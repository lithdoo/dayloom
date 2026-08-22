import type { ValidateFunction } from 'ajv';
import type { ChildProcess } from 'node:child_process';
import type { ProcessRunner } from './conversation';

interface AgentEvent {
  type: string;
  session_id: string;
  sequence: number;
  content?: string;
  final?: { status: string; content?: string };
  error?: { code: string; message: string };
}
export async function runReact(input: {
  runner: ProcessRunner; reactBin: string; validate: ValidateFunction; config: string; context: string; conversation: string; workRoot: string;
  onDelta?: (text: string) => void; onChild?: (child: ChildProcess) => void;
}): Promise<string> {
  const args = ['--config', input.config, '-d', input.context, '--output-dir', input.conversation, '--work-root', input.workRoot, '--continue', '--max-step', '1', '--quiet', '--output-format', 'stream-json'];
  let expected = 0, sessionId: string | null = null, terminal = false, deltas = '', final = '', buffer = '', streamed = false;
  const consumeLine = (rawLine: string) => {
    const line = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine;
    if (line.length === 0) return;
    let event: AgentEvent;
    try { event = JSON.parse(line); } catch { throw new Error('React emitted malformed JSONL.'); }
    if (!input.validate(event)) throw new Error('React emitted an event that violates Agent Event v1.');
    if (terminal) throw new Error('React emitted an event after terminal.');
    if (expected === 0 && event.type !== 'session.started') throw new Error('First React event must be session.started.');
    if (event.sequence !== expected++) throw new Error('React event sequence is not contiguous.');
    if (sessionId === null) sessionId = event.session_id;
    else if (event.session_id !== sessionId) throw new Error('React event session_id changed.');
    if (event.type === 'final.delta') { deltas += event.content!; input.onDelta?.(event.content!); }
    if (event.type === 'session.failed') {
      terminal = true;
      throw new Error(event.error?.message ?? 'React session failed.');
    }
    if (event.type === 'session.completed') {
      terminal = true;
      if (event.final?.status !== 'completed') throw new Error('React Final was skipped.');
      final = event.final.content ?? '';
    }
  };
  const consumeChunk = (chunk: string) => {
    streamed = true; buffer += chunk;
    for (;;) {
      const newline = buffer.indexOf('\n');
      if (newline < 0) break;
      const line = buffer.slice(0, newline); buffer = buffer.slice(newline + 1); consumeLine(line);
    }
  };
  const result = await input.runner.run(input.reactBin, args, { onChild: input.onChild, onStdout: consumeChunk });
  if (!streamed && result.stdout.length > 0) consumeChunk(result.stdout);
  if (buffer.length > 0) throw new Error('React emitted truncated JSONL.');
  if (result.code !== 0 || !terminal || sessionId === null || deltas !== final) throw new Error(result.stderr || 'React stream did not complete successfully.');
  return final;
}
