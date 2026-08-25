import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { ChildProcess } from 'node:child_process';
import { ArchiveRetrievalError, CoreInitializationError, CoreOperationError, SessionFileRuntimeError, failure, success, type CoreResult } from './errors';
import type { CoreEvent } from './events';
import { buildState, type CoreSessionKind, type CoreSessionStatus, type CoreState, type CoreWorldState } from './state';
import { classifyWorld, type ClassifiedWorld, type PublishedWorld } from './world/read';
import { publishMutation, type WorldChange } from './world/publish';
import { resolvePackagedBoundaries, type PackagedBoundaries } from './promptpile/binaries';
import { readCallerConfig, type CallerConfig } from './promptpile/config';
import { appendUser, nodeProcessRunner, type ProcessRunner } from './promptpile/conversation';
import { runCompressedCompletion } from './promptpile/compression';
import { runReact } from './promptpile/react-runner';
import { ARCHIVE_FILE_TOOLS, DRAFT_FILE_TOOLS, startSessionFileRuntimeV1, type SessionFileRuntimeV1 } from './promptpile/session-file-runtime';
import { materializeArchiveView } from './world/archive-view';
import { buildContextMessage, createPlayWorkspace } from './session/play';
import { buildLifecycleContext, createInitWorkspace, createPlanningWorkspace, createReviseWorkspace } from './session/lifecycle';
import type { CoreSession } from './session/common';
import { buildSettlementMutationV1 } from './world/builders/settlement';
import { readStructuredDayEventsV1 } from './world/profile/events';
import { openDraftV1, type DraftHandleV1 } from './session/draft-store';
import { acquireWorldRuntimeLockV1, type WorldRuntimeLockV1 } from './session/runtime-lock';
import { SESSION_FILE_LIMITS } from './session/file-limits';
import { runSubmissionPipelineV1, SubmissionPipelineErrorV1 } from './session/submission-pipeline';
import { AiSubmissionConverterV1, AiSubmissionReviewerV1 } from './session/submission-agent';
import { createHash } from 'node:crypto';

export interface CreateDayloomCoreOptions { worldRoot: string; llmConfigPath: string; runtimeRoot?: string }
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
  mutationPublisher?: typeof publishMutation;
  remove?: typeof rm;
  classifier?: typeof classifyWorld;
  fileRuntimeFactory?: typeof startSessionFileRuntimeV1;
}
interface ActiveSessionRuntime { readonly workspace: CoreSession; readonly files: SessionFileRuntimeV1; readonly draft: DraftHandleV1 }
class DayloomCoreImpl implements DayloomCore {
  private world: PublishedWorld | null;
  private worldState: CoreWorldState;
  private activeSession: ActiveSessionRuntime | null = null;
  private sessionPhase: CoreSessionStatus | null = null;
  private mutation = false;
  private disposed = false;
  private activeChild: ChildProcess | null = null;
  private currentOperationDone: Promise<void> | null = null;
  private cancelRequestedSessionId: string | null = null;
  private interruptCancelPromise: Promise<CoreResult> | null = null;
  private disposal: Promise<void> | null = null;
  private activeReactOperation: { id: string; sessionId: string; workPath: string | null; messageId: string | null; terminalProjected: boolean } | null = null;
  private readonly listeners = new Set<(event: CoreEvent) => void>();
  constructor(
    classified: ClassifiedWorld, private readonly worldRoot: string, private readonly runtimeRoot: string, private readonly persistentRuntimeRoot: string,
    private readonly config: CallerConfig, private readonly boundaries: PackagedBoundaries,
    private readonly runner: ProcessRunner, private readonly mutationPublisher: typeof publishMutation,
    private readonly remove: typeof rm,
    private readonly classifier: typeof classifyWorld,
    private readonly fileRuntimeFactory: typeof startSessionFileRuntimeV1, private readonly runtimeLock: WorldRuntimeLockV1,
  ) { this.world = classified.published; this.worldState = classified.state; }
  private workspace(): CoreSession | null { return this.activeSession?.workspace ?? null; }
  private publicSession(): CoreState['session'] {
    return this.activeSession && this.sessionPhase ? { id: this.activeSession.workspace.id, kind: this.activeSession.workspace.kind, status: this.sessionPhase } : null;
  }
  getState() { return buildState(this.worldState, this.publicSession(), this.mutation, this.disposed, this.cancelRequestedSessionId); }
  subscribe(listener: (event: CoreEvent) => void) { if (this.disposed) return () => {}; this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }
  private emit(event: CoreEvent) { if (this.disposed) return; for (const listener of [...this.listeners]) try { listener(event); } catch { /* listener isolation */ } }
  private changed() { this.emit({ type: 'state.changed', state: this.getState() }); }
  private childStarted(child: ChildProcess, sessionId?: string) {
    this.activeChild = child;
    if (this.disposed || (sessionId !== undefined && this.cancelRequestedSessionId === sessionId)) child.kill();
  }
  private childEnded(child: ChildProcess) { if (this.activeChild === child) this.activeChild = null; }
  private async appendConversation(directory: string, content: string, sessionId?: string): Promise<void> {
    let child: ChildProcess | null = null;
    try { await appendUser(this.runner, this.boundaries.promptpileBin, directory, content, (started) => { child = started; this.childStarted(started, sessionId); }); }
    finally { if (child) this.childEnded(child); }
  }
  private compressAndComplete<T>(session: CoreSession, completion: () => Promise<T>): Promise<T> {
    return runCompressedCompletion({
      runner: this.runner, promptpileBin: this.boundaries.promptpileBin, conversationDir: session.conversationDir,
      requestsDir: session.requestsDir, summaryConfigPath: session.summaryConfigPath, summaryPromptPath: session.summaryPromptPath,
      onChildStart: (child) => this.childStarted(child, session.id), onChildEnd: (child) => this.childEnded(child), completion,
    });
  }
  private async runSessionReact(session: CoreSession, config: string): Promise<string> {
    let child: ChildProcess | null = null;
    const operation = { id: `op_${randomUUID().replaceAll('-', '')}`, sessionId: session.id, workPath: null as string | null, messageId: null as string | null, terminalProjected: false };
    let messageId: string | null = null;
    this.activeReactOperation = operation;
    const live = () => this.activeReactOperation === operation && !operation.terminalProjected && !this.disposed && !this.isCancelRequested(session);
    const fail = (message: string, status: 'failed' | 'cancelled' = 'failed') => {
      if (!live()) return;
      operation.terminalProjected = true;
      if (messageId) this.emit({ type: 'output.failed', sessionId: session.id, operationId: operation.id, messageId, message });
      else this.emit({ type: 'work.failed', sessionId: session.id, operationId: operation.id, status, message, workPath: operation.workPath });
    };
    try {
      return await runReact({
        runner: this.runner, reactBin: this.boundaries.reactBin,
        validateProcessPile: this.boundaries.validateProcessPile,
        config, context: session.contextDir, conversation: session.conversationDir,
        assertBeforeFinal: this.activeSession?.workspace === session
          ? (workPath) => this.activeSession?.files.assertReadyForFinal(workPath)
          : undefined,
        onChild: (started) => { child = started; this.childStarted(started, session.id); },
        observer: {
          workStarted: (workPath) => { if (live()) { operation.workPath = workPath; this.emit({ type: 'work.started', sessionId: session.id, operationId: operation.id, workPath }); } },
          workDelta: (phase, stepIndex, text) => { if (live()) this.emit({ type: 'work.delta', sessionId: session.id, operationId: operation.id, phase, stepIndex, text }); },
          workCompleted: (workPath) => { if (live()) this.emit({ type: 'work.completed', sessionId: session.id, operationId: operation.id, workPath }); },
          workFailed: (status, message, workPath) => { operation.workPath = workPath; fail(message, status); },
          outputStarted: () => { if (live()) { messageId = `msg_${randomUUID().replaceAll('-', '')}`; operation.messageId = messageId; this.emit({ type: 'output.started', sessionId: session.id, operationId: operation.id, messageId }); } },
          outputDelta: (text) => { if (live() && messageId) this.emit({ type: 'output.delta', sessionId: session.id, operationId: operation.id, messageId, text }); },
          outputCompleted: () => { if (live() && messageId) { operation.terminalProjected = true; this.emit({ type: 'output.completed', sessionId: session.id, operationId: operation.id, messageId }); } },
        },
      });
    } catch (error) {
      fail(messageOf(error));
      throw error;
    } finally {
      if (child) this.childEnded(child);
      if (this.activeReactOperation === operation) this.activeReactOperation = null;
    }
  }
  private operation(action: () => Promise<CoreResult>): Promise<CoreResult> {
    if (this.disposed) return Promise.resolve(failure('DISPOSED', 'Core is disposed.'));
    if (this.mutation) return Promise.resolve(failure('BUSY', 'Another mutation is in flight.'));
    let resolveOperation!: () => void;
    const operationDone = new Promise<void>((resolve) => { resolveOperation = resolve; });
    this.mutation = true;
    this.currentOperationDone = operationDone;
    this.changed();
    return (async () => {
      try {
        if (this.disposed) return failure('DISPOSED', 'Core is disposed.');
        return await action();
      }
      catch (error) {
        const code = codeOf(error);
        if (code === 'WORLD_INVALID' || code === 'WORLD_CONFLICT') {
          await this.recoverWorldState();
          return failure(code, messageOf(error));
        }
        if (error instanceof CoreOperationError) return failure(error.code, error.message);
        if (error instanceof ArchiveRetrievalError || error instanceof SessionFileRuntimeError) return failure('AGENT_FAILED', error.message);
        await this.recoverWorldState();
        return failure('INTERNAL_ERROR', messageOf(error));
      } finally {
        this.mutation = false;
        this.changed();
        if (this.currentOperationDone === operationDone) this.currentOperationDone = null;
        resolveOperation();
      }
    })();
  }
  private async recoverWorldState(): Promise<void> {
    try {
      const classified = await this.classifier(this.worldRoot);
      this.world = classified.published;
      this.worldState = classified.state;
    } catch { /* error recovery must not replace the original operation result */ }
  }
  startSession(kind: CoreSessionKind) { return this.operation(async () => {
    if (!this.canStart(kind)) return failure('NOT_AVAILABLE', `${kind} Session is not available.`);
    const id = randomUUID(), sessionRoot = path.join(this.runtimeRoot, 'sessions', id);
    let session: CoreSession | null = null, files: SessionFileRuntimeV1 | null = null;
    try {
      const targetDay = kind === 'planning' ? (await import('./world/read')).nextDay(this.world?.commit.control.lastSettledDay ?? null) : kind === 'play' ? this.world!.commit.control.day : null;
      const worldIdentity = this.world?.manifest.worldId ?? createHash('sha256').update(this.worldRoot.toLowerCase()).digest('hex');
      const draft = await openDraftV1({ runtimeRoot: this.persistentRuntimeRoot, kind, worldIdentity, baseCommitId: this.world?.commit.id ?? null, baseRootTreeHash: this.world?.commit.rootTreeHash ?? null, targetDay });
      let archiveRoot: string | null = null;
      if (this.world) archiveRoot = (await materializeArchiveView({ worldRoot: this.worldRoot, sessionRoot, world: this.world })).root;
      files = await this.fileRuntimeFactory({ runtimeRoot: path.join(sessionRoot, 'file-runtime'), promptpileMcpBin: this.boundaries.promptpileMcpBin, filesystemMcp: this.boundaries.filesystemMcp, runner: this.runner, servers: [...(archiveRoot ? [{ id: 'archive' as const, root: archiveRoot, writable: false, tools: ARCHIVE_FILE_TOOLS }] : []), { id: 'draft' as const, root: draft.root, writable: true, tools: DRAFT_FILE_TOOLS }], workspaces: [{ serverId: 'draft', root: draft.root, maxFiles: SESSION_FILE_LIMITS.draftMaxFiles, maxFileBytes: SESSION_FILE_LIMITS.draftMaxFileBytes, maxTotalBytes: SESSION_FILE_LIMITS.draftMaxTotalBytes }], maxToolCallsPerThought: SESSION_FILE_LIMITS.conversationMaxToolCallsPerThought, maxToolResultLineBytes: SESSION_FILE_LIMITS.maxToolResultLineBytes });
      if (kind === 'init') session = await createInitWorkspace(this.runtimeRoot, id, this.config, files.binding);
      else if (kind === 'planning') session = await createPlanningWorkspace(this.runtimeRoot, id, this.world!, this.config, files.binding);
      else if (kind === 'revise') session = await createReviseWorkspace(this.runtimeRoot, id, this.world!, this.config, files.binding);
      else session = await createPlayWorkspace(this.runtimeRoot, id, this.world!, this.config, files.binding);
      const context = kind === 'play' ? buildContextMessage(this.world!) : buildLifecycleContext(session);
      if (context !== null) await this.appendConversation(session.contextDir, context);
      if (this.disposed) throw new CoreOperationError('DISPOSED', 'Core is disposed.');
      this.activeSession = Object.freeze({ workspace: session, files, draft }); this.sessionPhase = 'ready'; return success();
    } catch (error) {
      if (files) await files.close().catch(() => undefined);
      await this.cleanupSessionRoot(session?.root ?? sessionRoot);
      if (error instanceof ArchiveRetrievalError || error instanceof SessionFileRuntimeError) return failure('AGENT_FAILED', error.message);
      if (error instanceof CoreOperationError) return failure(error.code, error.message);
      return failure(session ? 'CONVERSATION_FAILED' : 'INTERNAL_ERROR', messageOf(error));
    }
  }); }
  send(text: string) { return this.operation(async () => {
    const active = this.activeSession;
    if (!active || this.sessionPhase !== 'ready') return failure('NOT_AVAILABLE', 'send is not available.');
    if (typeof text !== 'string' || text.trim() === '') return failure('INVALID_INPUT', 'Input must be non-empty.');
    const session = active.workspace; this.sessionPhase = 'running'; this.changed();
    try {
      if (this.disposed) throw new CoreOperationError('DISPOSED', 'Core is disposed.');
      active.files.assertHealthy();
      try { await this.appendConversation(session.conversationDir, text, session.id); }
      catch (error) {
        if (this.isCancelRequested(session)) return this.cancelledResult();
        throw new CoreOperationError('CONVERSATION_FAILED', messageOf(error));
      }
      if (this.isCancelRequested(session)) return this.cancelledResult();
      await this.compressAndComplete(session, () => this.runSessionReact(session, session.sendConfig));
      if (this.isCancelRequested(session)) return this.cancelledResult();
      if (this.disposed) throw new CoreOperationError('DISPOSED', 'Core is disposed.');
      this.sessionPhase = 'ready'; return success();
    } catch (error) {
      if (this.isCancelRequested(session)) return this.cancelledResult();
      await this.terminalize(session); throw error;
    }
  }); }
  submit() { return this.operation(async () => {
    const active = this.activeSession;
    if (!active || this.sessionPhase !== 'ready') return failure('NOT_AVAILABLE', 'submit is not available.');
    const session = active.workspace, operationId = `op_${randomUUID().replaceAll('-', '')}`; this.sessionPhase = 'submitting'; this.changed();
    try {
      if (this.disposed) throw new CoreOperationError('DISPOSED', 'Core is disposed.');
      active.files.assertHealthy();
      const observer = {
        workStarted: (workPath: string) => this.emit({ type: 'work.started', sessionId: session.id, operationId, workPath }),
        workDelta: (phase: 'thought' | 'observe' | 'check', stepIndex: number, text: string) => this.emit({ type: 'work.delta', sessionId: session.id, operationId, phase, stepIndex, text }),
        workCompleted: (workPath: string) => this.emit({ type: 'work.completed', sessionId: session.id, operationId, workPath }),
      };
      const agentOptions = { worldRoot: this.worldRoot, config: this.config, boundaries: this.boundaries, runner: this.runner, onChild: (child: ChildProcess) => this.childStarted(child, session.id), observer };
      const result = await runSubmissionPipelineV1({ worldRoot: this.worldRoot, transientRoot: session.root, session, draft: active.draft, converter: new AiSubmissionConverterV1(agentOptions), reviewer: new AiSubmissionReviewerV1(agentOptions), stage: (stage, attempt) => this.emit({ type: 'submission.stage', sessionId: session.id, operationId, stage, attempt }), publish: (request) => this.mutationPublisher(this.worldRoot, request) });
      if (this.disposed) throw new CoreOperationError('DISPOSED', 'Core is disposed.'); this.activeChild = null;
      this.installPublished(result.published);
      this.emit({ type: 'work.completed', sessionId: session.id, operationId, workPath: path.join(session.root, 'submission') });
      await this.terminalize(session);
      return success();
    } catch (error) {
      this.activeChild = null;
      if (this.isCancelRequested(session)) {
        this.emit({ type: 'work.failed', sessionId: session.id, operationId, status: 'cancelled', message: '提交已取消。', workPath: null });
        this.sessionPhase = 'ready'; this.changed(); return this.cancelledResult();
      }
      if (error instanceof SubmissionPipelineErrorV1) {
        if (error.diagnostics.length > 0) this.emit({ type: 'submission.diagnostics', sessionId: session.id, operationId, diagnostics: error.diagnostics });
        this.emit({ type: 'work.failed', sessionId: session.id, operationId, status: 'failed', message: error.message, workPath: null });
        this.sessionPhase = 'ready'; this.changed(); return failure(error.code, error.message, error.diagnostics);
      }
      this.sessionPhase = 'ready'; this.changed(); throw error;
    }
  }); }
  cancel(): Promise<CoreResult> {
    if (this.disposed) return Promise.resolve(failure('DISPOSED', 'Core is disposed.'));
    const session = this.workspace();
    if (session && this.cancelRequestedSessionId === session.id && this.interruptCancelPromise) {
      return this.interruptCancelPromise;
    }
    if (session && (this.sessionPhase === 'running' || this.sessionPhase === 'submitting')) {
      return this.beginInterruptCancel(session);
    }
    return this.operation(async () => {
      const current = this.workspace();
      if (!current || this.sessionPhase !== 'ready') return failure('NOT_AVAILABLE', 'cancel is not available.');
      const cleanupError = await this.terminalize(current);
      return cleanupError === null ? success() : failure('INTERNAL_ERROR', cleanupError.message);
    });
  }
  settle() { return this.operation(async () => {
    if (!this.world || this.worldState.status !== 'published' || this.activeSession !== null || this.world.commit.control.phase !== 'awaiting-settle' || this.world.commit.control.day === null) return failure('NOT_AVAILABLE', 'settle is not available.');
    const base = this.world, day = base.commit.control.day as string;
    let changes: WorldChange[] = [];
    if (base.tree.entries.some((entry) => entry.path === `days/${day}/play-index.json`)) {
      // Awaiting-settle deliberately exposes no playContext, so read and validate the
      // persisted plan from the verified tree through the structured event reader's input.
      const { parsePlayPlanV1, readTextDocument } = await import('./world/read');
      const planText = await readTextDocument(this.worldRoot, base.tree, `days/${day}/plan.json`);
      const persistedPlan = parsePlayPlanV1(JSON.parse(planText));
      const events = await readStructuredDayEventsV1(this.worldRoot, base.tree, day, persistedPlan, base.profileV1);
      changes = buildSettlementMutationV1(base, events);
    }
    const published = await this.mutationPublisher(this.worldRoot, { operationType: 'settle', base, changes, control: { phase: 'idle', day: null, lastSettledDay: day } });
    this.installPublished(published); return success();
  }); }
  abandonDay() { return this.operation(async () => {
    if (!this.world || this.worldState.status !== 'published' || this.activeSession !== null || !['planned', 'awaiting-settle'].includes(this.world.commit.control.phase) || this.world.commit.control.day === null) return failure('NOT_AVAILABLE', 'abandonDay is not available.');
    const base = this.world, day = base.commit.control.day;
    const paths = base.tree.entries.map((entry) => entry.path).filter((candidate) => candidate.startsWith(`days/${day}/`));
    const published = await this.mutationPublisher(this.worldRoot, { operationType: 'abandon-day', base, changes: paths.map((documentPath) => ({ op: 'delete' as const, path: documentPath })), control: { phase: 'idle', day: null, lastSettledDay: base.commit.control.lastSettledDay } });
    this.installPublished(published); return success();
  }); }
  private canStart(kind: CoreSessionKind): boolean {
    if (this.activeSession !== null) return false;
    if (this.worldState.status === 'uninitialized') return kind === 'init';
    if (this.worldState.status !== 'published') return false;
    if (this.worldState.phase === 'idle') return kind === 'planning' || kind === 'revise';
    return this.worldState.phase === 'planned' && kind === 'play';
  }
  private installPublished(world: PublishedWorld) { this.world = world; this.worldState = world.view; }
  private isCancelRequested(session: CoreSession): boolean { return this.cancelRequestedSessionId === session.id; }
  private cancelledResult(): CoreResult { return failure('CANCELLED', 'The active Session operation was cancelled.'); }
  private beginInterruptCancel(session: CoreSession): Promise<CoreResult> {
    this.cancelRequestedSessionId = session.id;
    const reactOperation = this.activeReactOperation;
    if (reactOperation?.sessionId === session.id && !reactOperation.terminalProjected) {
      reactOperation.terminalProjected = true;
      if (reactOperation.messageId) this.emit({ type: 'output.failed', sessionId: session.id, operationId: reactOperation.id, messageId: reactOperation.messageId, message: 'The active output was cancelled.' });
      else this.emit({ type: 'work.failed', sessionId: session.id, operationId: reactOperation.id, status: 'cancelled', message: 'The active work was cancelled.', workPath: reactOperation.workPath });
    }
    const operation = this.currentOperationDone;
    let cancelPromise!: Promise<CoreResult>;
    cancelPromise = (async () => {
      try {
        if (operation) await operation;
        if (this.activeSession?.workspace === session) { this.sessionPhase = 'ready'; this.changed(); }
        return success();
      } finally {
        if (this.cancelRequestedSessionId === session.id) this.cancelRequestedSessionId = null;
        if (this.interruptCancelPromise === cancelPromise) this.interruptCancelPromise = null;
        this.changed();
      }
    })();
    this.interruptCancelPromise = cancelPromise;
    this.changed();
    this.activeChild?.kill();
    return cancelPromise;
  }
  private async terminalize(session: CoreSession): Promise<Error | null> {
    const active = this.activeSession?.workspace === session ? this.activeSession : null;
    if (active) { this.activeSession = null; this.sessionPhase = null; this.changed(); }
    let first: Error | null = null;
    if (active?.files) try { await active.files.close(); } catch (error) { first = error instanceof Error ? error : new Error('Could not close Session File Runtime.'); }
    const cleanup = await this.cleanupSessionRoot(session.root);
    return first ?? cleanup;
  }
  private async cleanupSessionRoot(root: string): Promise<Error | null> {
    try { await this.remove(root, { recursive: true, force: true }); return null; }
    catch (error) { return error instanceof Error ? error : new Error('Could not remove terminal Session workspace.'); }
  }
  dispose(): Promise<void> {
    if (this.disposal) return this.disposal;
    this.disposed = true; this.listeners.clear(); this.activeChild?.kill();
    const interruptCancel = this.interruptCancelPromise;
    this.disposal = (async () => {
      const operation = this.currentOperationDone;
      if (operation) await operation;
      if (interruptCancel) await interruptCancel;
      this.activeChild = null;
      const active = this.activeSession; this.activeSession = null; this.sessionPhase = null;
      if (active?.files) await active.files.close().catch(() => undefined);
      await this.remove(this.runtimeRoot, { recursive: true, force: true });
      await this.runtimeLock.release().catch(() => undefined);
    })();
    return this.disposal;
  }
}

function codeOf(error: unknown): string { return typeof error === 'object' && error !== null && 'code' in error ? String((error as { code: unknown }).code) : ''; }
function messageOf(error: unknown): string { return error instanceof Error ? error.message : 'Internal Core error.'; }

export function createDayloomCore(options: CreateDayloomCoreOptions): Promise<DayloomCore> { return createDayloomCoreInternal(options); }
export async function createDayloomCoreInternal(options: CreateDayloomCoreOptions, internal: InternalOptions = {}): Promise<DayloomCore> {
  if (!options || typeof options.worldRoot !== 'string' || options.worldRoot.trim() === '' || typeof options.llmConfigPath !== 'string' || options.llmConfigPath.trim() === '' || (options.runtimeRoot !== undefined && (typeof options.runtimeRoot !== 'string' || options.runtimeRoot.trim() === ''))) throw new CoreInitializationError('INVALID_OPTIONS', 'worldRoot and llmConfigPath are required, and runtimeRoot must be a non-empty path when provided.');
  const worldRoot = path.resolve(options.worldRoot), llmConfigPath = path.resolve(options.llmConfigPath), persistentRuntimeRoot = path.resolve(options.runtimeRoot ?? path.join(worldRoot, '.dayloom-runtime'));
  try { await mkdir(worldRoot, { recursive: true }); } catch (error) { throw new CoreInitializationError('INTERNAL_ERROR', 'Could not create worldRoot directory.', { cause: error }); }
  let config: CallerConfig; try { config = await readCallerConfig(llmConfigPath); } catch (error) { throw new CoreInitializationError('INVALID_OPTIONS', 'Invalid caller LLM config.', { cause: error }); }
  let boundaries: PackagedBoundaries; try { boundaries = internal.boundaries ?? await resolvePackagedBoundaries(); } catch (error) { throw new CoreInitializationError('INTERNAL_ERROR', 'Could not initialize packaged Promptpile boundaries.', { cause: error }); }
  let runtimeLock: WorldRuntimeLockV1 | null = null;
  try {
    const classifier = internal.classifier ?? classifyWorld;
    runtimeLock = await acquireWorldRuntimeLockV1(persistentRuntimeRoot);
    const classified = await classifier(worldRoot), runtimeRoot = path.join(persistentRuntimeRoot, 'transient', runtimeLock.instanceId);
    await mkdir(path.join(runtimeRoot, 'sessions'), { recursive: true });
    const fileRuntimeFactory = internal.fileRuntimeFactory ?? (internal.runner ? startTestSessionFileRuntime : startSessionFileRuntimeV1);
    return new DayloomCoreImpl(classified, worldRoot, runtimeRoot, persistentRuntimeRoot, config, boundaries, internal.runner ?? nodeProcessRunner, internal.mutationPublisher ?? publishMutation, internal.remove ?? rm, classifier, fileRuntimeFactory, runtimeLock);
  } catch (error) { await runtimeLock?.release().catch(() => undefined); const code = codeOf(error) === 'WORLD_BUSY' ? 'WORLD_BUSY' : 'INTERNAL_ERROR'; throw new CoreInitializationError(code, code === 'WORLD_BUSY' ? messageOf(error) : 'Could not initialize Core runtime.', { cause: error }); }
}

async function startTestSessionFileRuntime(input: Parameters<typeof startSessionFileRuntimeV1>[0]): Promise<SessionFileRuntimeV1> {
  const retrieval = input.runtimeRoot; await mkdir(retrieval, { recursive: true });
  const toolsFile = path.join(retrieval, 'tools.toml'), afterHookPath = path.join(retrieval, process.platform === 'win32' ? 'after-hook.cmd' : 'after-hook.sh'), toolNames = input.servers.flatMap((server) => server.tools.map((tool) => `mcp__${server.id}__${tool}`));
  await Promise.all([writeFile(toolsFile, 'tools = []\n'), writeFile(afterHookPath, process.platform === 'win32' ? '@exit /b 0\r\n' : '#!/bin/sh\nexit 0\n')]);
  return Object.freeze({ binding: Object.freeze({ toolsFile, afterHookPath, toolNames }), assertHealthy() {}, assertReadyForFinal() {}, async close() {} });
}
