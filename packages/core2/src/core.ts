import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { ChildProcess } from 'node:child_process';
import { CoreInitializationError, CoreOperationError, failure, success, type CoreResult } from './errors';
import type { CoreEvent } from './events';
import { buildState, type CoreState } from './state';
import { readPublishedWorld, type PublishedWorld } from './world/read';
import { resolvePackagedBoundaries, type PackagedBoundaries } from './promptpile/binaries';
import { readCallerConfig, type CallerConfig } from './promptpile/config';
import { appendUser, nodeProcessRunner, type ProcessRunner } from './promptpile/conversation';
import { runReact } from './promptpile/react-runner';
import { buildContextMessage, createPlayWorkspace, SUBMIT_MARKER, type PlaySession } from './session/play';
import { parsePlaySubmissionV1, validateAndBuildPlayDocuments } from './session/submission';
import { publishPlay } from './world/publish';

export interface CreateDayloomCoreOptions { worldRoot: string; llmConfigPath: string }
export interface DayloomCore {
  getState(): CoreState;
  subscribe(listener: (event: CoreEvent) => void): () => void;
  startSession(kind: 'play'): Promise<CoreResult>;
  send(text: string): Promise<CoreResult>;
  submit(): Promise<CoreResult>;
  cancel(): Promise<CoreResult>;
  dispose(): Promise<void>;
}
interface InternalOptions { runner?: ProcessRunner; boundaries?: PackagedBoundaries; publisher?: typeof publishPlay }

class DayloomCoreImpl implements DayloomCore {
  private session: PlaySession | null = null;
  private sessionStatus: CoreState['session'] = null;
  private mutation = false;
  private disposed = false;
  private activeChild: ChildProcess | null = null;
  private readonly listeners = new Set<(event: CoreEvent) => void>();
  constructor(private world: PublishedWorld, private readonly worldRoot: string, private readonly runtimeRoot: string, private readonly config: CallerConfig, private readonly boundaries: PackagedBoundaries, private readonly runner: ProcessRunner, private readonly publisher: typeof publishPlay) {}
  getState() { return buildState(this.world.view, this.sessionStatus, this.mutation, this.disposed); }
  subscribe(listener: (event: CoreEvent) => void) { if (this.disposed) return () => {}; this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }
  private emit(event: CoreEvent) { for (const listener of [...this.listeners]) try { listener(event); } catch { /* listener isolation */ } }
  private changed() { this.emit({ type: 'state.changed', state: this.getState() }); }
  private begin(): CoreResult | null { if (this.disposed) return failure('DISPOSED', 'Core is disposed.'); if (this.mutation) return failure('BUSY', 'Another mutation is in flight.'); this.mutation = true; this.changed(); return null; }
  private end() { this.mutation = false; }
  private async operation(action: () => Promise<CoreResult>): Promise<CoreResult> {
    const unavailable = this.begin(); if (unavailable) return unavailable;
    let result: CoreResult;
    try { return await action(); } catch (error) {
      if (error instanceof CoreOperationError) result = failure(error.code, error.message);
      else {
        const code = typeof error === 'object' && error !== null && 'code' in error ? (error as { code: string }).code : 'INTERNAL_ERROR';
        if (['SUBMISSION_INVALID', 'WORLD_CONFLICT'].includes(code)) result = failure(code as 'SUBMISSION_INVALID' | 'WORLD_CONFLICT', (error as Error).message);
        else result = failure('INTERNAL_ERROR', error instanceof Error ? error.message : 'Internal Core error.');
      }
      return result;
    } finally { this.end(); this.changed(); }
  }
  startSession(kind: 'play') { return this.operation(async () => {
    if (kind !== 'play' || this.session !== null || this.world.view.phase !== 'planned' || this.world.view.day === null) return failure('NOT_AVAILABLE', 'Play Session is not available.');
    const id = randomUUID();
    let session: PlaySession;
    try { session = await createPlayWorkspace(this.runtimeRoot, id, this.world, this.config); }
    catch (error) { await rm(path.join(this.runtimeRoot, 'sessions', id), { recursive: true, force: true }); return failure('INTERNAL_ERROR', error instanceof Error ? error.message : 'Could not create Session workspace.'); }
    try {
      await appendUser(this.runner, this.boundaries.promptpileBin, session.contextDir, buildContextMessage(this.world), (child) => { this.activeChild = child; });
      this.activeChild = null;
      if (this.disposed) return failure('DISPOSED', 'Core is disposed.');
      this.session = session; this.sessionStatus = { id, kind: 'play', status: 'ready' }; return success();
    } catch (error) { await rm(path.join(this.runtimeRoot, 'sessions', id), { recursive: true, force: true }); return failure('CONVERSATION_FAILED', error instanceof Error ? error.message : 'Could not start Conversation.'); }
  }); }
  send(text: string) { return this.operation(async () => {
    if (!this.session || this.sessionStatus?.status !== 'ready') return failure('NOT_AVAILABLE', 'send is not available.');
    if (typeof text !== 'string' || text.trim() === '') return failure('INVALID_INPUT', 'Input must be non-empty.');
    const session = this.session; this.sessionStatus = { ...this.sessionStatus, status: 'running' }; this.changed();
    try {
      await appendUser(this.runner, this.boundaries.promptpileBin, session.conversationDir, text, (child) => { this.activeChild = child; });
      this.activeChild = null;
    } catch (error) {
      this.session = null; this.sessionStatus = null; this.changed(); return failure('CONVERSATION_FAILED', error instanceof Error ? error.message : 'Conversation append failed.');
    }
    try {
      await runReact({ runner: this.runner, reactBin: this.boundaries.reactBin, validate: this.boundaries.validateAgentEvent, config: session.sendConfig, context: session.contextDir, conversation: session.conversationDir, onChild: (child) => { this.activeChild = child; }, onDelta: (delta) => this.emit({ type: 'output.delta', sessionId: session.id, text: delta }) });
      if (this.disposed) return failure('DISPOSED', 'Core is disposed.');
      this.activeChild = null; this.sessionStatus = { id: session.id, kind: 'play', status: 'ready' }; return success();
    } catch (error) { this.activeChild = null; this.session = null; this.sessionStatus = null; return failure('AGENT_FAILED', error instanceof Error ? error.message : 'Agent failed.'); }
  }); }
  submit() { return this.operation(async () => {
    if (!this.session || this.sessionStatus?.status !== 'ready') return failure('NOT_AVAILABLE', 'submit is not available.');
    const session = this.session; this.sessionStatus = { ...this.sessionStatus, status: 'submitting' }; this.changed();
    try {
      await appendUser(this.runner, this.boundaries.promptpileBin, session.conversationDir, SUBMIT_MARKER, (child) => { this.activeChild = child; });
      this.activeChild = null;
    } catch (error) {
      this.session = null; this.sessionStatus = null; this.changed(); return failure('CONVERSATION_FAILED', error instanceof Error ? error.message : 'Conversation append failed.');
    }
    let final: string;
    try { final = await runReact({ runner: this.runner, reactBin: this.boundaries.reactBin, validate: this.boundaries.validateAgentEvent, config: session.submitConfig, context: session.contextDir, conversation: session.conversationDir, onChild: (child) => { this.activeChild = child; } }); }
    catch (error) { this.activeChild = null; this.session = null; this.sessionStatus = null; return failure('AGENT_FAILED', error instanceof Error ? error.message : 'Agent failed.'); }
    this.activeChild = null;
    let documents;
    try { documents = validateAndBuildPlayDocuments(session.pinned.playContext!.plan, parsePlaySubmissionV1(final)); }
    catch (error) { this.session = null; this.sessionStatus = null; return failure('SUBMISSION_INVALID', error instanceof Error ? error.message : 'Submission is invalid.'); }
    if (this.disposed) return failure('DISPOSED', 'Core is disposed.');
    try { this.world = await this.publisher(this.worldRoot, session.pinned, session.day, documents); }
    catch (error) {
      this.session = null; this.sessionStatus = null;
      const code = typeof error === 'object' && error !== null && 'code' in error ? (error as { code: string }).code : '';
      return failure(code === 'WORLD_CONFLICT' ? 'WORLD_CONFLICT' : code === 'SUBMISSION_INVALID' ? 'SUBMISSION_INVALID' : 'INTERNAL_ERROR', error instanceof Error ? error.message : 'World publication failed.');
    }
    this.session = null; this.sessionStatus = null; return success();
  }); }
  cancel() { return this.operation(async () => {
    if (!this.session || this.sessionStatus?.status !== 'ready') return failure('NOT_AVAILABLE', 'cancel is not available.');
    this.session = null; this.sessionStatus = null; return success();
  }); }
  async dispose() {
    if (this.disposed) return; this.disposed = true; this.activeChild?.kill(); this.activeChild = null; this.session = null; this.sessionStatus = null; this.listeners.clear(); await rm(this.runtimeRoot, { recursive: true, force: true });
  }
}

export async function createDayloomCore(options: CreateDayloomCoreOptions): Promise<DayloomCore> { return createDayloomCoreInternal(options); }
export async function createDayloomCoreInternal(options: CreateDayloomCoreOptions, internal: InternalOptions = {}): Promise<DayloomCore> {
  if (!options || typeof options.worldRoot !== 'string' || options.worldRoot.trim() === '' || typeof options.llmConfigPath !== 'string' || options.llmConfigPath.trim() === '') throw new CoreInitializationError('INVALID_OPTIONS', 'worldRoot and llmConfigPath are required.');
  const worldRoot = path.resolve(options.worldRoot), llmConfigPath = path.resolve(options.llmConfigPath);
  let config: CallerConfig;
  try { config = await readCallerConfig(llmConfigPath); } catch (error) { throw new CoreInitializationError('INVALID_OPTIONS', 'Invalid caller LLM config.', { cause: error }); }
  let boundaries: PackagedBoundaries;
  try { boundaries = internal.boundaries ?? await resolvePackagedBoundaries(); } catch (error) { throw new CoreInitializationError('INTERNAL_ERROR', 'Could not initialize packaged Promptpile boundaries.', { cause: error }); }
  let world: PublishedWorld;
  try { world = await readPublishedWorld(worldRoot); } catch (error) { throw new CoreInitializationError('WORLD_INVALID', 'Published World is invalid.', { cause: error }); }
  try {
    const runtimeRoot = await mkdtemp(path.join(os.tmpdir(), 'dayloom-core2-'));
    await mkdirSessions(runtimeRoot);
    return new DayloomCoreImpl(world, worldRoot, runtimeRoot, config, boundaries, internal.runner ?? nodeProcessRunner, internal.publisher ?? publishPlay);
  } catch (error) { throw new CoreInitializationError('INTERNAL_ERROR', 'Could not initialize Core runtime.', { cause: error }); }
}
async function mkdirSessions(runtimeRoot: string) { const { mkdir } = await import('node:fs/promises'); await mkdir(path.join(runtimeRoot, 'sessions')); }
