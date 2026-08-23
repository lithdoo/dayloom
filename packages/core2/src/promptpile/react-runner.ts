import type { ValidateFunction } from 'ajv';
import type { ChildProcess } from 'node:child_process';
import type { CoreEventProtocol, ReactWorkPhase } from '../events';
import type { ProcessRunner } from './conversation';

interface AgentEvent {
  type: string; session_id: string; sequence: number; content?: string;
  final?: { status: string; content?: string }; error?: { code: string; message: string };
}

interface ProcessEvent {
  type: string; process_id: string; sequence: number;
  max_steps?: number; work_id?: string; work_path?: string; work_lifecycle?: string;
  phase?: 'startup' | 'thought' | 'observe' | 'check' | 'final'; step_index?: number;
  content?: string; continue?: boolean; steps_completed?: number; stop_reason?: string;
  final?: { status: 'completed' | 'skipped'; content?: string };
  work?: { work_id: string; status: 'failed' | 'cancelled'; work_path: string | null };
  error?: { code: string; message: string };
}

export interface ReactProcessObserver {
  workStarted?(workPath: string): void;
  workDelta?(phase: ReactWorkPhase, stepIndex: number, text: string): void;
  workCompleted?(workPath: string): void;
  workFailed?(status: 'failed' | 'cancelled', message: string, workPath: string | null): void;
  outputStarted?(): void;
  outputDelta?(text: string): void;
  outputCompleted?(): void;
}

export interface RunReactInput {
  runner: ProcessRunner;
  reactBin: string;
  validate: ValidateFunction;
  validateProcessPile?: ValidateFunction;
  eventProtocol?: CoreEventProtocol;
  config: string;
  context: string;
  conversation: string;
  workRoot?: string;
  onDelta?: (text: string) => void;
  observer?: ReactProcessObserver;
  onChild?: (child: ChildProcess) => void;
}

export async function runReact(input: RunReactInput): Promise<string> {
  return input.eventProtocol === 'core-event-v2' ? runProcessPile(input) : runAgentEventV1(input);
}

async function runAgentEventV1(input: RunReactInput): Promise<string> {
  const args = ['--config', input.config, '-d', input.context, '--output-dir', input.conversation];
  if (input.workRoot) args.push('--work-root', input.workRoot);
  args.push('--continue', '--max-step', '1', '--quiet', '--output-format', 'stream-json');
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
    if (event.type === 'session.failed') { terminal = true; throw new Error(event.error?.message ?? 'React session failed.'); }
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
  if (final.trim() === '') throw new Error('React Final was empty.');
  return final;
}

async function runProcessPile(input: RunReactInput): Promise<string> {
  if (!input.validateProcessPile) throw new Error('Process Pile v1 validator is unavailable.');
  const args = [...baseArgs(input), '--quiet', '--process-pile-fd', '3', '--process-pile-format', 'json'];
  const reducer = new ProcessPileReducer(input.validateProcessPile, input.observer);
  let buffer = '';
  let failedProjected = false;
  const projectLocalFailure = (message: string) => {
    if (failedProjected || reducer.protocolFailureProjected) return;
    failedProjected = true;
    input.observer?.workFailed?.('failed', message, reducer.workPath);
  };
  const consume = (chunk: string) => {
    buffer += chunk;
    if (buffer.length > 1024 * 1024 && !buffer.includes('\n')) throw new Error('React Process Pile line exceeds the size limit.');
    for (;;) {
      const newline = buffer.indexOf('\n');
      if (newline < 0) break;
      const line = buffer.slice(0, newline); buffer = buffer.slice(newline + 1);
      reducer.consume(line.endsWith('\r') ? line.slice(0, -1) : line);
    }
  };
  try {
    const result = await input.runner.run(input.reactBin, args, { onChild: input.onChild, onExtraPipe: consume });
    if (buffer.length > 0) throw new Error('React emitted truncated Process Pile JSONL.');
    const final = reducer.finish(result.code, result.stderr);
    if (final.trim() === '') throw new Error('React Final was empty.');
    input.observer?.outputCompleted?.();
    return final;
  } catch (error) {
    projectLocalFailure(error instanceof Error ? error.message : 'React Process Pile failed.');
    throw error;
  }
}

function baseArgs(input: RunReactInput): string[] {
  return ['--config', input.config, '-d', input.context, '--output-dir', input.conversation, '--continue', '--max-step', '1'];
}

class ProcessPileReducer {
  private expectedSequence = 0;
  private processId: string | null = null;
  private workId: string | null = null;
  private maxSteps = 0;
  private expectedPhase: ReactWorkPhase | 'ready' | 'final-or-terminal' | 'terminal' = 'thought';
  private active: { phase: ReactWorkPhase | 'final'; stepIndex?: number } | null = null;
  private checkCompletions = 0;
  private terminal: ProcessEvent | null = null;
  private finalText = '';
  workPath: string | null = null;
  protocolFailureProjected = false;

  constructor(private readonly validate: ValidateFunction, private readonly observer?: ReactProcessObserver) {}

  consume(line: string): void {
    if (line.length === 0) return;
    let event: ProcessEvent;
    try { event = JSON.parse(line); } catch { throw new Error('React emitted malformed Process Pile JSONL.'); }
    if (!this.validate(event)) throw new Error('React emitted an event that violates Process Pile v1.');
    if (this.terminal) throw new Error('React emitted a Process Pile event after terminal.');
    if (event.sequence !== this.expectedSequence++) throw new Error('React Process Pile sequence is not contiguous.');
    if (this.processId === null) {
      if (event.type !== 'process.started' || event.sequence !== 0) throw new Error('First Process Pile event must be process.started.');
      this.processId = event.process_id; this.workId = event.work_id!; this.workPath = event.work_path!; this.maxSteps = event.max_steps!;
      this.observer?.workStarted?.(this.workPath);
      return;
    }
    if (event.process_id !== this.processId) throw new Error('React Process Pile process_id changed.');
    if (event.type === 'phase.started') return this.phaseStarted(event);
    if (event.type === 'phase.delta') return this.phaseDelta(event);
    if (event.type === 'phase.completed') return this.phaseCompleted(event);
    if (event.type === 'work.ready') {
      if (this.active || this.expectedPhase !== 'ready' || event.work_id !== this.workId || event.work_path !== this.workPath) throw new Error('React Process Pile work.ready is out of order.');
      this.expectedPhase = 'final-or-terminal'; this.observer?.workCompleted?.(this.workPath!); return;
    }
    if (event.type === 'process.completed') {
      this.validateCompleted(event); this.terminal = event; return;
    }
    if (event.type === 'process.failed') {
      this.terminal = event; this.protocolFailureProjected = true;
      this.observer?.workFailed?.(event.work!.status, event.error?.message ?? 'React process failed.', event.work!.work_path);
      return;
    }
    throw new Error(`Unexpected Process Pile event: ${event.type}`);
  }

  finish(exitCode: number | null, stderr: string): string {
    if (!this.terminal) throw new Error('React Process Pile ended before terminal.');
    if (this.terminal.type === 'process.failed') throw new Error(this.terminal.error?.message ?? (stderr || 'React process failed.'));
    if (exitCode !== 0) throw new Error(stderr || 'React completed but the child exit code was nonzero.');
    return this.terminal.final?.content ?? '';
  }

  private phaseStarted(event: ProcessEvent): void {
    if (this.active) throw new Error('React Process Pile phase overlap.');
    if (event.phase === 'final') {
      if (this.expectedPhase !== 'final-or-terminal') throw new Error('React Final started before work.ready.');
      this.active = { phase: 'final' }; this.expectedPhase = 'terminal'; this.observer?.outputStarted?.(); return;
    }
    if (event.phase !== this.expectedPhase) throw new Error('React Process Pile phase started out of order.');
    const expectedStep = this.checkCompletions;
    if (event.step_index !== expectedStep || expectedStep >= this.maxSteps) throw new Error('React Process Pile step index is invalid.');
    this.active = { phase: event.phase!, stepIndex: event.step_index };
  }

  private phaseDelta(event: ProcessEvent): void {
    if (!this.active || event.phase !== this.active.phase || event.step_index !== this.active.stepIndex) throw new Error('React Process Pile delta is outside its active phase.');
    if (event.phase === 'final') { this.finalText += event.content!; this.observer?.outputDelta?.(event.content!); }
    else this.observer?.workDelta?.(event.phase!, event.step_index!, event.content!);
  }

  private phaseCompleted(event: ProcessEvent): void {
    if (!this.active || event.phase !== this.active.phase || event.step_index !== this.active.stepIndex) throw new Error('React Process Pile phase completion is out of order.');
    this.active = null;
    if (event.phase === 'thought') this.expectedPhase = 'observe';
    else if (event.phase === 'observe') this.expectedPhase = 'check';
    else if (event.phase === 'check') {
      this.checkCompletions += 1;
      this.expectedPhase = event.continue === true && this.checkCompletions < this.maxSteps ? 'thought' : 'ready';
    } else this.expectedPhase = 'terminal';
  }

  private validateCompleted(event: ProcessEvent): void {
    if (this.active || event.steps_completed !== this.checkCompletions) throw new Error('React Process Pile terminal step count is inconsistent.');
    if (event.final?.status === 'completed') {
      if (this.expectedPhase !== 'terminal' || event.stop_reason !== 'final' || event.final.content !== this.finalText) throw new Error('React Process Pile Final evidence is inconsistent.');
    } else if (this.expectedPhase !== 'final-or-terminal' || event.stop_reason !== 'max_step' || this.finalText !== '') {
      throw new Error('React Process Pile skipped Final evidence is inconsistent.');
    } else throw new Error('React Final was skipped.');
  }
}
