import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { ChildProcess } from 'node:child_process';
import { CoreInitializationError, CoreOperationError, failure, success, type CoreResult } from './errors';
import type { CoreEvent } from './events';
import { buildState, type CoreSessionKind, type CoreState, type CoreWorldState } from './state';
import { classifyWorld, type ClassifiedWorld, type PublishedWorld } from './world/read';
import { publishMutation, publishPlay, type PublishMutationInput } from './world/publish';
import { resolvePackagedBoundaries, type PackagedBoundaries } from './promptpile/binaries';
import { readCallerConfig, type CallerConfig } from './promptpile/config';
import { appendUser, nodeProcessRunner, type ProcessRunner } from './promptpile/conversation';
import { runCompressedCompletion } from './promptpile/compression';
import { runReact } from './promptpile/react-runner';
import { buildContextMessage, createPlayWorkspace } from './session/play';
import { buildLifecycleContext, createInitWorkspace, createPlanningWorkspace, createReviseWorkspace } from './session/lifecycle';
import type { CoreSession } from './session/common';
import {
  parseInitSubmissionV1, parsePlanningSubmissionV1, parsePlaySubmissionV1, parseReviseSubmissionV1,
  validateAndBuildPlayDocuments,
} from './session/submission';

export interface CreateDayloomCoreOptions { worldRoot: string; llmConfigPath: string }
export interface DayloomCore {
  getState(): CoreState;
  subscribe(listener: (event: CoreEvent) => void): () => void;
  startSession(kind: CoreSessionKind): Promise<CoreResult>;
  send(text: string): Promise<CoreResult>;
  submit(): Promise<CoreResult>;
  cancel(): Promise<CoreResult>;
  settle(): Promise<CoreResult>;
  abandonDay(): Promise<CoreResult>;
  dispose(): Promise<void>;
}
interface InternalOptions {
  runner?: ProcessRunner; boundaries?: PackagedBoundaries;
  publisher?: typeof publishPlay; mutationPublisher?: typeof publishMutation;
}
const encoder = new TextEncoder();
const json = (value: unknown) => encoder.encode(`${JSON.stringify(value, null, 2)}\n`);

class DayloomCoreImpl implements DayloomCore {
  private world: PublishedWorld | null;
  private worldState: CoreWorldState;
  private session: CoreSession | null = null;
  private sessionStatus: CoreState['session'] = null;
  private mutation = false;
  private disposed = false;
  private activeChild: ChildProcess | null = null;
  private inFlight: Promise<CoreResult> | null = null;
  private disposal: Promise<void> | null = null;
  private readonly listeners = new Set<(event: CoreEvent) => void>();
  constructor(
    classified: ClassifiedWorld, private readonly worldRoot: string, private readonly runtimeRoot: string,
    private readonly config: CallerConfig, private readonly boundaries: PackagedBoundaries,
    private readonly runner: ProcessRunner, private readonly playPublisher: typeof publishPlay,
    private readonly mutationPublisher: typeof publishMutation,
  ) { this.world = classified.published; this.worldState = classified.state; }
  getState() { return buildState(this.worldState, this.sessionStatus, this.mutation, this.disposed); }
  subscribe(listener: (event: CoreEvent) => void) { if (this.disposed) return () => {}; this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }
  private emit(event: CoreEvent) { if (this.disposed) return; for (const listener of [...this.listeners]) try { listener(event); } catch { /* listener isolation */ } }
  private changed() { this.emit({ type: 'state.changed', state: this.getState() }); }
  private childStarted(child: ChildProcess) { this.activeChild = child; }
  private childEnded(child: ChildProcess) { if (this.activeChild === child) this.activeChild = null; }
  private async appendConversation(directory: string, content: string): Promise<void> {
    let child: ChildProcess | null = null;
    try { await appendUser(this.runner, this.boundaries.promptpileBin, directory, content, (started) => { child = started; this.childStarted(started); }); }
    finally { if (child) this.childEnded(child); }
  }
  private compressAndComplete<T>(session: CoreSession, completion: () => Promise<T>): Promise<T> {
    return runCompressedCompletion({
      runner: this.runner, promptpileBin: this.boundaries.promptpileBin, conversationDir: session.conversationDir,
      requestsDir: session.requestsDir, summaryConfigPath: session.summaryConfigPath, summaryPromptPath: session.summaryPromptPath,
      onChildStart: (child) => this.childStarted(child), onChildEnd: (child) => this.childEnded(child), completion,
    });
  }
  private async runSessionReact(session: CoreSession, config: string, onDelta?: (delta: string) => void): Promise<string> {
    let child: ChildProcess | null = null;
    try { return await runReact({ runner: this.runner, reactBin: this.boundaries.reactBin, validate: this.boundaries.validateAgentEvent, config, context: session.contextDir, conversation: session.conversationDir, onChild: (started) => { child = started; this.childStarted(started); }, onDelta }); }
    finally { if (child) this.childEnded(child); }
  }
  private operation(action: () => Promise<CoreResult>): Promise<CoreResult> {
    if (this.disposed) return Promise.resolve(failure('DISPOSED', 'Core is disposed.'));
    if (this.mutation) return Promise.resolve(failure('BUSY', 'Another mutation is in flight.'));
    this.mutation = true; this.changed();
    const run = (async () => {
      try { return await action(); }
      catch (error) {
        if (error instanceof CoreOperationError) return failure(error.code, error.message);
        const code = codeOf(error);
        if (code === 'WORLD_INVALID') {
          const classified = await classifyWorld(this.worldRoot);
          this.world = classified.published; this.worldState = classified.state;
          return failure('WORLD_INVALID', messageOf(error));
        }
        if (['SUBMISSION_INVALID', 'WORLD_CONFLICT'].includes(code)) return failure(code as 'SUBMISSION_INVALID' | 'WORLD_CONFLICT', messageOf(error));
        const classified = await classifyWorld(this.worldRoot);
        if (classified.state.status === 'invalid') { this.world = null; this.worldState = classified.state; }
        return failure('INTERNAL_ERROR', messageOf(error));
      } finally { this.mutation = false; this.changed(); }
    })();
    this.inFlight = run;
    void run.finally(() => { if (this.inFlight === run) this.inFlight = null; });
    return run;
  }
  startSession(kind: CoreSessionKind) { return this.operation(async () => {
    if (!this.canStart(kind)) return failure('NOT_AVAILABLE', `${kind} Session is not available.`);
    const id = randomUUID(); let session: CoreSession;
    try {
      if (kind === 'init') session = await createInitWorkspace(this.runtimeRoot, id, this.config);
      else if (kind === 'planning') session = await createPlanningWorkspace(this.runtimeRoot, id, this.world!, this.config);
      else if (kind === 'revise') session = await createReviseWorkspace(this.runtimeRoot, id, this.world!, this.config);
      else session = await createPlayWorkspace(this.runtimeRoot, id, this.world!, this.config);
    } catch (error) { await rm(path.join(this.runtimeRoot, 'sessions', id), { recursive: true, force: true }); return failure('INTERNAL_ERROR', messageOf(error)); }
    try {
      const context = kind === 'play' ? buildContextMessage(this.world!) : buildLifecycleContext(session);
      if (context !== null) await this.appendConversation(session.contextDir, context);
      if (this.disposed) { await rm(session.root, { recursive: true, force: true }); return failure('DISPOSED', 'Core is disposed.'); }
      this.session = session; this.sessionStatus = { id, kind, status: 'ready' }; return success();
    } catch (error) { await rm(session.root, { recursive: true, force: true }); return failure('CONVERSATION_FAILED', messageOf(error)); }
  }); }
  send(text: string) { return this.operation(async () => {
    if (!this.session || this.sessionStatus?.status !== 'ready') return failure('NOT_AVAILABLE', 'send is not available.');
    if (typeof text !== 'string' || text.trim() === '') return failure('INVALID_INPUT', 'Input must be non-empty.');
    const session = this.session; this.sessionStatus = { ...this.sessionStatus, status: 'running' }; this.changed();
    try {
      try { await this.appendConversation(session.conversationDir, text); }
      catch (error) { throw new CoreOperationError('CONVERSATION_FAILED', messageOf(error)); }
      await this.compressAndComplete(session, () => this.runSessionReact(session, session.sendConfig, (delta) => this.emit({ type: 'output.delta', sessionId: session.id, text: delta })));
      if (this.disposed) throw new CoreOperationError('DISPOSED', 'Core is disposed.');
      this.sessionStatus = { id: session.id, kind: session.kind, status: 'ready' }; return success();
    } catch (error) { await this.terminalize(session); throw error; }
  }); }
  submit() { return this.operation(async () => {
    if (!this.session || this.sessionStatus?.status !== 'ready') return failure('NOT_AVAILABLE', 'submit is not available.');
    const session = this.session; this.sessionStatus = { ...this.sessionStatus, status: 'submitting' }; this.changed();
    try {
      try { await this.appendConversation(session.conversationDir, session.submitMarker); }
      catch (error) { throw new CoreOperationError('CONVERSATION_FAILED', messageOf(error)); }
      const final = await this.compressAndComplete(session, () => this.runSessionReact(session, session.submitConfig));
      if (this.disposed) throw new CoreOperationError('DISPOSED', 'Core is disposed.');
      const published = await this.publishSubmission(session, final);
      this.installPublished(published); await this.terminalize(session); return success();
    } catch (error) { await this.terminalize(session); throw error; }
  }); }
  cancel() { return this.operation(async () => {
    if (!this.session || this.sessionStatus?.status !== 'ready') return failure('NOT_AVAILABLE', 'cancel is not available.');
    await this.terminalize(this.session); return success();
  }); }
  settle() { return this.operation(async () => {
    if (!this.world || this.worldState.status !== 'published' || this.session !== null || this.world.commit.control.phase !== 'awaiting-settle' || this.world.commit.control.day === null) return failure('NOT_AVAILABLE', 'settle is not available.');
    const base = this.world, day = base.commit.control.day;
    const published = await this.mutationPublisher(this.worldRoot, { operationType: 'settle', base, changes: [], control: { phase: 'idle', day: null, lastSettledDay: day } });
    this.installPublished(published); return success();
  }); }
  abandonDay() { return this.operation(async () => {
    if (!this.world || this.worldState.status !== 'published' || this.session !== null || !['planned', 'awaiting-settle'].includes(this.world.commit.control.phase) || this.world.commit.control.day === null) return failure('NOT_AVAILABLE', 'abandonDay is not available.');
    const base = this.world, day = base.commit.control.day;
    const paths = [`days/${day}/plan.json`, `days/${day}/play.json`, `days/${day}/summary.md`].filter((candidate) => base.tree.entries.some((entry) => entry.path === candidate));
    const published = await this.mutationPublisher(this.worldRoot, { operationType: 'abandon-day', base, changes: paths.map((documentPath) => ({ op: 'delete' as const, path: documentPath })), control: { phase: 'idle', day: null, lastSettledDay: base.commit.control.lastSettledDay } });
    this.installPublished(published); return success();
  }); }
  private async publishSubmission(session: CoreSession, final: string): Promise<PublishedWorld> {
    if (session.kind === 'play') {
      let documents;
      try { documents = validateAndBuildPlayDocuments(session.pinned!.playContext!.plan, parsePlaySubmissionV1(final)); }
      catch (error) { throw new CoreOperationError('SUBMISSION_INVALID', messageOf(error)); }
      return this.playPublisher(this.worldRoot, session.pinned!, session.day!, documents);
    }
    if (session.kind === 'init') {
      let submission; try { submission = parseInitSubmissionV1(final); } catch (error) { throw new CoreOperationError('SUBMISSION_INVALID', messageOf(error)); }
      return this.mutationPublisher(this.worldRoot, { operationType: 'init', base: null, initialManifest: { worldId: `world_${randomUUID().replaceAll('-', '')}`, title: submission.title.trim() }, changes: canonChanges(submission.canon), control: { phase: 'idle', day: null, lastSettledDay: null } });
    }
    if (session.kind === 'planning') {
      let submission; try { submission = parsePlanningSubmissionV1(final); } catch (error) { throw new CoreOperationError('SUBMISSION_INVALID', messageOf(error)); }
      const plan = { intent: submission.intent, beats: submission.beats.map((beat, index) => ({ id: `beat${index + 1}`, intent: beat.intent })) };
      return this.mutationPublisher(this.worldRoot, { operationType: 'planning', base: session.pinned!, changes: [{ op: 'put', path: `days/${session.day}/plan.json`, mediaType: 'application/json', bytes: json(plan) }], control: { phase: 'planned', day: session.day, lastSettledDay: session.pinned!.commit.control.lastSettledDay } });
    }
    let submission; try { submission = parseReviseSubmissionV1(final); } catch (error) { throw new CoreOperationError('SUBMISSION_INVALID', messageOf(error)); }
    return this.mutationPublisher(this.worldRoot, { operationType: 'revise', base: session.pinned!, changes: canonChanges(submission.canon), control: { ...session.pinned!.commit.control } });
  }
  private canStart(kind: CoreSessionKind): boolean {
    if (this.session !== null) return false;
    if (this.worldState.status === 'uninitialized') return kind === 'init';
    if (this.worldState.status !== 'published') return false;
    if (this.worldState.phase === 'idle') return kind === 'planning' || kind === 'revise';
    return this.worldState.phase === 'planned' && kind === 'play';
  }
  private installPublished(world: PublishedWorld) { this.world = world; this.worldState = world.view; }
  private async terminalize(session: CoreSession) {
    await rm(session.root, { recursive: true, force: true });
    if (this.session === session) { this.session = null; this.sessionStatus = null; this.changed(); }
  }
  dispose(): Promise<void> {
    if (this.disposal) return this.disposal;
    this.disposed = true; this.listeners.clear(); this.activeChild?.kill();
    this.disposal = (async () => { const operation = this.inFlight; if (operation) await operation.catch(() => undefined); this.activeChild = null; this.session = null; this.sessionStatus = null; await rm(this.runtimeRoot, { recursive: true, force: true }); })();
    return this.disposal;
  }
}

function canonChanges(canon: { premise: string; rules: string; style: string; userRole: string }): PublishMutationInput['changes'] {
  return [
    { op: 'put', path: 'canon/premise.md', mediaType: 'text/markdown', bytes: encoder.encode(canon.premise) },
    { op: 'put', path: 'canon/rules.md', mediaType: 'text/markdown', bytes: encoder.encode(canon.rules) },
    { op: 'put', path: 'canon/style.md', mediaType: 'text/markdown', bytes: encoder.encode(canon.style) },
    { op: 'put', path: 'canon/user-role.md', mediaType: 'text/markdown', bytes: encoder.encode(canon.userRole) },
  ];
}
function codeOf(error: unknown): string { return typeof error === 'object' && error !== null && 'code' in error ? String((error as { code: unknown }).code) : ''; }
function messageOf(error: unknown): string { return error instanceof Error ? error.message : 'Internal Core error.'; }

export async function createDayloomCore(options: CreateDayloomCoreOptions): Promise<DayloomCore> { return createDayloomCoreInternal(options); }
export async function createDayloomCoreInternal(options: CreateDayloomCoreOptions, internal: InternalOptions = {}): Promise<DayloomCore> {
  if (!options || typeof options.worldRoot !== 'string' || options.worldRoot.trim() === '' || typeof options.llmConfigPath !== 'string' || options.llmConfigPath.trim() === '') throw new CoreInitializationError('INVALID_OPTIONS', 'worldRoot and llmConfigPath are required.');
  const worldRoot = path.resolve(options.worldRoot), llmConfigPath = path.resolve(options.llmConfigPath);
  try { await mkdir(worldRoot, { recursive: true }); } catch (error) { throw new CoreInitializationError('INTERNAL_ERROR', 'Could not create worldRoot directory.', { cause: error }); }
  let config: CallerConfig; try { config = await readCallerConfig(llmConfigPath); } catch (error) { throw new CoreInitializationError('INVALID_OPTIONS', 'Invalid caller LLM config.', { cause: error }); }
  let boundaries: PackagedBoundaries; try { boundaries = internal.boundaries ?? await resolvePackagedBoundaries(); } catch (error) { throw new CoreInitializationError('INTERNAL_ERROR', 'Could not initialize packaged Promptpile boundaries.', { cause: error }); }
  try {
    const classified = await classifyWorld(worldRoot), runtimeRoot = await mkdtemp(path.join(os.tmpdir(), 'dayloom-core2-'));
    await mkdir(path.join(runtimeRoot, 'sessions'));
    return new DayloomCoreImpl(classified, worldRoot, runtimeRoot, config, boundaries, internal.runner ?? nodeProcessRunner, internal.publisher ?? publishPlay, internal.mutationPublisher ?? publishMutation);
  } catch (error) { throw new CoreInitializationError('INTERNAL_ERROR', 'Could not initialize Core runtime.', { cause: error }); }
}
