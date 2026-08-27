import type { ValidateFunction } from 'ajv';
import type { ChildProcess } from 'node:child_process';
import { mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import type { ReactWorkPhase } from '../events';
import type { ProcessRunner } from './conversation';
import { SESSION_FILE_LIMITS } from '../session/file-limits';

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
  validateProcessPile: ValidateFunction;
  config: string;
  context: string;
  conversation: string;
  workRoot: string;
  observer?: ReactProcessObserver;
  onChild?: (child: ChildProcess) => void;
  assertBeforeFinal?: (workPath: string) => void;
  timeoutMs?: number;
}

type ReactProtocolErrorCode = 'JSONL' | 'SCHEMA' | 'SEQUENCE' | 'PHASE' | 'STOP_REASON' | 'FINAL_EVIDENCE' | 'CHILD_EXIT';

class ReactProtocolError extends Error {
  readonly name = 'ReactProtocolError';
  constructor(readonly code: ReactProtocolErrorCode, message: string) { super(message); }
}

function protocolError(code: ReactProtocolErrorCode, message: string): ReactProtocolError {
  return new ReactProtocolError(code, message);
}

export async function runReact(input: RunReactInput): Promise<string> {
  return runProcessPile(input);
}

async function runProcessPile(input: RunReactInput): Promise<string> {
  const workRoot = resolveOwnedWorkRoot(input);
  await rm(workRoot, { recursive: true, force: true });
  await mkdir(workRoot, { recursive: true });
  const args = [...baseArgs(input), '--work-root', workRoot, '--work-lifecycle', 'caller', '--quiet', '--process-pile-fd', '3', '--process-pile-format', 'json'];
  const reducer = new ProcessPileReducer(input.validateProcessPile, workRoot, input.observer, input.assertBeforeFinal);
  let buffer = '';
  let failedProjected = false;
  const projectLocalFailure = (message: string) => {
    if (failedProjected || reducer.protocolFailureProjected) return;
    failedProjected = true;
    input.observer?.workFailed?.('failed', message, reducer.workPath);
  };
  const consume = (chunk: string) => {
    buffer += chunk;
    if (buffer.length > 1024 * 1024 && !buffer.includes('\n')) throw protocolError('JSONL', 'React Process Pile line exceeds the size limit.');
    for (;;) {
      const newline = buffer.indexOf('\n');
      if (newline < 0) break;
      const line = buffer.slice(0, newline); buffer = buffer.slice(newline + 1);
      reducer.consume(line.endsWith('\r') ? line.slice(0, -1) : line);
    }
  };
  try {
    const result = await input.runner.run(input.reactBin, args, { onChild: input.onChild, onExtraPipe: consume, timeoutMs: input.timeoutMs });
    if (buffer.length > 0) throw protocolError('JSONL', 'React emitted truncated Process Pile JSONL.');
    const final = reducer.finish(result.code, result.stderr);
    if (final.trim() === '') throw protocolError('FINAL_EVIDENCE', 'React Final was empty.');
    input.observer?.outputCompleted?.();
    return final;
  } catch (error) {
    projectLocalFailure(error instanceof Error ? error.message : 'React Process Pile failed.');
    throw error;
  } finally {
    await rm(workRoot, { recursive: true, force: true }).catch(() => undefined);
  }
}

function resolveOwnedWorkRoot(input: RunReactInput): string {
  const config = path.resolve(input.config);
  const expected = path.join(path.dirname(path.dirname(config)), 'react-work');
  const supplied = path.resolve(input.workRoot);
  if (supplied !== expected) throw new Error('React work root must be the operation-local react-work directory.');
  return supplied;
}

function baseArgs(input: RunReactInput): string[] {
  return ['--config', input.config, '-d', input.context, '--output-dir', input.conversation, '--continue', '--max-step', String(SESSION_FILE_LIMITS.reactMaxSteps)];
}

class ProcessPileReducer {
  private expectedSequence = 0;
  private processId: string | null = null;
  private workId: string | null = null;
  private maxSteps = 0;
  private expectedPhase: ReactWorkPhase | 'ready' | 'final-or-terminal' | 'terminal' = 'thought';
  private active: { phase: ReactWorkPhase | 'final'; stepIndex?: number } | null = null;
  private checkCompletions = 0;
  private expectedStopReason: 'final' | 'max_step' | null = null;
  private terminal: ProcessEvent | null = null;
  private finalText = '';
  workPath: string | null = null;
  protocolFailureProjected = false;

  constructor(
    private readonly validate: ValidateFunction,
    private readonly expectedWorkRoot: string,
    private readonly observer?: ReactProcessObserver,
    private readonly assertBeforeFinal?: (workPath: string) => void,
  ) {}

  consume(line: string): void {
    if (line.length === 0) return;
    let event: ProcessEvent;
    try { event = JSON.parse(line); } catch { throw protocolError('JSONL', 'React emitted malformed Process Pile JSONL.'); }
    if (!this.validate(event)) throw protocolError('SCHEMA', 'React emitted an event that violates Process Pile v1.');
    if (this.terminal) throw protocolError('SEQUENCE', 'React emitted a Process Pile event after terminal.');
    if (event.sequence !== this.expectedSequence++) throw protocolError('SEQUENCE', 'React Process Pile sequence is not contiguous.');
    if (this.processId === null) {
      if (event.type !== 'process.started' || event.sequence !== 0) throw protocolError('SEQUENCE', 'First Process Pile event must be process.started.');
      if (event.work_lifecycle !== 'caller' || !isDescendant(this.expectedWorkRoot, event.work_path!)) throw protocolError('PHASE', 'React Process Pile work ownership is invalid.');
      this.processId = event.process_id; this.workId = event.work_id!; this.workPath = event.work_path!; this.maxSteps = event.max_steps!;
      this.observer?.workStarted?.(this.workPath);
      return;
    }
    if (event.process_id !== this.processId) throw protocolError('SEQUENCE', 'React Process Pile process_id changed.');
    if (event.type === 'phase.started') return this.phaseStarted(event);
    if (event.type === 'phase.delta') return this.phaseDelta(event);
    if (event.type === 'phase.completed') return this.phaseCompleted(event);
    if (event.type === 'work.ready') {
      if (this.active || this.expectedPhase !== 'ready' || event.work_id !== this.workId || event.work_path !== this.workPath) throw protocolError('PHASE', 'React Process Pile work.ready is out of order.');
      this.assertBeforeFinal?.(this.workPath!);
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
    throw protocolError('SEQUENCE', `Unexpected Process Pile event: ${event.type}`);
  }

  finish(exitCode: number | null, stderr: string): string {
    if (!this.terminal) throw protocolError('SEQUENCE', 'React Process Pile ended before terminal.');
    if (this.terminal.type === 'process.failed') throw new Error(this.terminal.error?.message ?? (stderr || 'React process failed.'));
    if (exitCode !== 0) throw protocolError('CHILD_EXIT', stderr || 'React completed but the child exit code was nonzero.');
    return this.terminal.final?.content ?? '';
  }

  private phaseStarted(event: ProcessEvent): void {
    if (this.active) throw protocolError('PHASE', 'React Process Pile phase overlap.');
    if (event.phase === 'final') {
      if (this.expectedPhase !== 'final-or-terminal') throw protocolError('PHASE', 'React Final started before work.ready.');
      this.active = { phase: 'final' }; this.expectedPhase = 'terminal'; this.observer?.outputStarted?.(); return;
    }
    if (event.phase !== this.expectedPhase) throw protocolError('PHASE', 'React Process Pile phase started out of order.');
    const expectedStep = this.checkCompletions;
    if (event.step_index !== expectedStep || expectedStep >= this.maxSteps) throw protocolError('PHASE', 'React Process Pile step index is invalid.');
    this.active = { phase: event.phase!, stepIndex: event.step_index };
  }

  private phaseDelta(event: ProcessEvent): void {
    if (!this.active || event.phase !== this.active.phase || event.step_index !== this.active.stepIndex) throw protocolError('PHASE', 'React Process Pile delta is outside its active phase.');
    if (event.phase === 'final') { this.finalText += event.content!; this.observer?.outputDelta?.(event.content!); }
    else {
      this.observer?.workDelta?.(event.phase!, event.step_index!, event.content!);
    }
  }

  private phaseCompleted(event: ProcessEvent): void {
    if (!this.active || event.phase !== this.active.phase || event.step_index !== this.active.stepIndex) throw protocolError('PHASE', 'React Process Pile phase completion is out of order.');
    this.active = null;
    if (event.phase === 'thought') this.expectedPhase = 'observe';
    else if (event.phase === 'observe') this.expectedPhase = 'check';
    else if (event.phase === 'check') {
      this.checkCompletions += 1;
      if (event.continue === true && this.checkCompletions < this.maxSteps) {
        this.expectedPhase = 'thought';
        this.expectedStopReason = null;
      } else {
        this.expectedPhase = 'ready';
        this.expectedStopReason = event.continue === true ? 'max_step' : 'final';
      }
    } else this.expectedPhase = 'terminal';
  }

  private validateCompleted(event: ProcessEvent): void {
    if (this.active || event.steps_completed !== this.checkCompletions) throw protocolError('SEQUENCE', 'React Process Pile terminal step count is inconsistent.');
    if (event.final?.status === 'completed') {
      if (this.expectedPhase !== 'terminal' || event.final.content !== this.finalText) throw protocolError('FINAL_EVIDENCE', 'React Process Pile Final evidence is inconsistent.');
      if (event.stop_reason !== this.expectedStopReason) throw protocolError('STOP_REASON', 'React Process Pile Final evidence is inconsistent.');
    } else if (this.expectedPhase !== 'final-or-terminal' || event.stop_reason !== this.expectedStopReason || this.finalText !== '') {
      throw protocolError(event.stop_reason !== this.expectedStopReason ? 'STOP_REASON' : 'FINAL_EVIDENCE', 'React Process Pile skipped Final evidence is inconsistent.');
    } else throw protocolError('FINAL_EVIDENCE', 'React Final was skipped.');
  }
}

function isDescendant(root: string, candidate: string): boolean {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return relative !== '' && !relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative);
}
