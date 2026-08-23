import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { ChildProcess } from 'node:child_process';
import { CoreInitializationError, CoreOperationError, failure, success, type CoreResult } from './errors';
import type { CoreEvent, CoreEventFor, CoreEventProtocol } from './events';
import { buildState, type CoreSessionKind, type CoreState, type CoreWorldState } from './state';
import { classifyWorld, type ClassifiedWorld, type PublishedWorld } from './world/read';
import { publishMutation, publishPlay, type PublishMutationInput, type WorldChange } from './world/publish';
import { resolvePackagedBoundaries, type PackagedBoundaries } from './promptpile/binaries';
import { readCallerConfig, type CallerConfig } from './promptpile/config';
import { appendUser, nodeProcessRunner, type ProcessRunner } from './promptpile/conversation';
import { runCompressedCompletion } from './promptpile/compression';
import { runReact } from './promptpile/react-runner';
import { buildContextMessage, createPlayWorkspace } from './session/play';
import { buildLifecycleContext, createInitWorkspace, createPlanningWorkspace, createReviseWorkspace } from './session/lifecycle';
import type { CoreSession } from './session/common';
import {
  parsePlanningSubmissionV1, parsePlaySubmissionV1, parseReviseSubmissionV1,
  validateAndBuildPlayDocuments,
} from './session/submission';
import { parseInitSubmissionV2, parsePlanningSubmissionV2, parsePlaySubmissionV2, parseReviseSubmissionV2 } from './session/submission-v2';
import { buildInitMutationV1 } from './world/builders/init';
import { buildSessionAuditV1 } from './world/builders/audit';
import { buildPlanningMutationV1 } from './world/builders/planning';
import { buildPlayMutationV1 } from './world/builders/play-v1';
import { buildSettlementMutationV1 } from './world/builders/settlement';
import { readStructuredDayEventsV1 } from './world/profile/events';
import { buildReviseMutationV1 } from './world/builders/revise';

export interface CreateDayloomCoreOptions { worldRoot: string; llmConfigPath: string; eventProtocol?: CoreEventProtocol }
export interface DayloomCore<P extends CoreEventProtocol = CoreEventProtocol> {
  getState(): CoreState;
  subscribe(listener: (event: CoreEventFor<P>) => void): () => void;
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
  remove?: typeof rm;
  classifier?: typeof classifyWorld;
}
const encoder = new TextEncoder();
const json = (value: unknown) => encoder.encode(`${JSON.stringify(value, null, 2)}\n`);

class DayloomCoreImpl implements DayloomCore<CoreEventProtocol> {
  private world: PublishedWorld | null;
  private worldState: CoreWorldState;
  private session: CoreSession | null = null;
  private sessionStatus: CoreState['session'] = null;
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
    classified: ClassifiedWorld, private readonly worldRoot: string, private readonly runtimeRoot: string,
    private readonly config: CallerConfig, private readonly boundaries: PackagedBoundaries,
    private readonly runner: ProcessRunner, private readonly playPublisher: typeof publishPlay,
    private readonly mutationPublisher: typeof publishMutation, private readonly remove: typeof rm,
    private readonly classifier: typeof classifyWorld, private readonly eventProtocol: CoreEventProtocol,
  ) { this.world = classified.published; this.worldState = classified.state; }
  getState() { return buildState(this.worldState, this.sessionStatus, this.mutation, this.disposed, this.cancelRequestedSessionId); }
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
  private async runSessionReact(session: CoreSession, config: string, onDelta?: (delta: string) => void): Promise<string> {
    let child: ChildProcess | null = null;
    if (this.eventProtocol === 'core-event-v1') {
      try { return await runReact({ runner: this.runner, reactBin: this.boundaries.reactBin, validate: this.boundaries.validateAgentEvent, config, context: session.contextDir, conversation: session.conversationDir, workRoot: session.reactWorkRoot, onChild: (started) => { child = started; this.childStarted(started, session.id); }, onDelta }); }
      finally { if (child) this.childEnded(child); }
    }
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
        validate: this.boundaries.validateAgentEvent, validateProcessPile: this.boundaries.validateProcessPile,
        eventProtocol: 'core-event-v2', config, context: session.contextDir, conversation: session.conversationDir,
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
        if (code === 'SUBMISSION_INVALID') return failure('SUBMISSION_INVALID', messageOf(error));
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
    const id = randomUUID(); let session: CoreSession;
    try {
      if (kind === 'init') session = await createInitWorkspace(this.runtimeRoot, id, this.config);
      else if (kind === 'planning') session = await createPlanningWorkspace(this.runtimeRoot, id, this.world!, this.config);
      else if (kind === 'revise') session = await createReviseWorkspace(this.runtimeRoot, id, this.world!, this.config);
      else session = await createPlayWorkspace(this.runtimeRoot, id, this.world!, this.config);
    } catch (error) { await this.cleanupSessionRoot(path.join(this.runtimeRoot, 'sessions', id)); return failure('INTERNAL_ERROR', messageOf(error)); }
    try {
      const context = kind === 'play' ? buildContextMessage(this.world!) : buildLifecycleContext(session);
      if (context !== null) await this.appendConversation(session.contextDir, context);
      if (this.disposed) { await this.cleanupSessionRoot(session.root); return failure('DISPOSED', 'Core is disposed.'); }
      this.session = session; this.sessionStatus = { id, kind, status: 'ready' }; return success();
    } catch (error) { await this.cleanupSessionRoot(session.root); return failure('CONVERSATION_FAILED', messageOf(error)); }
  }); }
  send(text: string) { return this.operation(async () => {
    if (!this.session || this.sessionStatus?.status !== 'ready') return failure('NOT_AVAILABLE', 'send is not available.');
    if (typeof text !== 'string' || text.trim() === '') return failure('INVALID_INPUT', 'Input must be non-empty.');
    const session = this.session; this.sessionStatus = { ...this.sessionStatus, status: 'running' }; this.changed();
    try {
      if (this.disposed) throw new CoreOperationError('DISPOSED', 'Core is disposed.');
      try { await this.appendConversation(session.conversationDir, text, session.id); }
      catch (error) {
        if (this.isCancelRequested(session)) return this.cancelledResult();
        throw new CoreOperationError('CONVERSATION_FAILED', messageOf(error));
      }
      if (this.isCancelRequested(session)) return this.cancelledResult();
      await this.compressAndComplete(session, () => this.runSessionReact(session, session.sendConfig, (delta) => {
        if (!this.isCancelRequested(session)) this.emit({ type: 'output.delta', sessionId: session.id, text: delta });
      }));
      if (this.isCancelRequested(session)) return this.cancelledResult();
      if (this.disposed) throw new CoreOperationError('DISPOSED', 'Core is disposed.');
      this.sessionStatus = { id: session.id, kind: session.kind, status: 'ready' }; return success();
    } catch (error) {
      if (this.isCancelRequested(session)) return this.cancelledResult();
      await this.terminalize(session); throw error;
    }
  }); }
  submit() { return this.operation(async () => {
    if (!this.session || this.sessionStatus?.status !== 'ready') return failure('NOT_AVAILABLE', 'submit is not available.');
    const session = this.session; this.sessionStatus = { ...this.sessionStatus, status: 'submitting' }; this.changed();
    try {
      if (this.disposed) throw new CoreOperationError('DISPOSED', 'Core is disposed.');
      try { await this.appendConversation(session.conversationDir, session.submitMarker); }
      catch (error) { throw new CoreOperationError('CONVERSATION_FAILED', messageOf(error)); }
      const final = await this.compressAndComplete(session, () => this.runSessionReact(session, session.submitConfig));
      if (this.disposed) throw new CoreOperationError('DISPOSED', 'Core is disposed.');
      const published = await this.publishSubmission(session, final);
      this.installPublished(published);
      await this.terminalize(session);
      return success();
    } catch (error) { await this.terminalize(session); throw error; }
  }); }
  cancel(): Promise<CoreResult> {
    if (this.disposed) return Promise.resolve(failure('DISPOSED', 'Core is disposed.'));
    const session = this.session;
    if (session && this.cancelRequestedSessionId === session.id && this.interruptCancelPromise) {
      return this.interruptCancelPromise;
    }
    if (session && this.sessionStatus?.id === session.id && this.sessionStatus.status === 'running') {
      return this.beginInterruptCancel(session);
    }
    return this.operation(async () => {
      if (!this.session || this.sessionStatus?.status !== 'ready') return failure('NOT_AVAILABLE', 'cancel is not available.');
      const cleanupError = await this.terminalize(this.session);
      return cleanupError === null ? success() : failure('INTERNAL_ERROR', cleanupError.message);
    });
  }
  settle() { return this.operation(async () => {
    if (!this.world || this.worldState.status !== 'published' || this.session !== null || this.world.commit.control.phase !== 'awaiting-settle' || this.world.commit.control.day === null) return failure('NOT_AVAILABLE', 'settle is not available.');
    const base = this.world, day = base.commit.control.day as string;
    let changes: WorldChange[] = [];
    if (base.profileVersion === 1 && base.tree.entries.some((entry) => entry.path === `days/${day}/play-index.json`)) {
      if (base.profileV1 === null) throw new Error('Profile V1 is unavailable during settlement.');
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
    if (!this.world || this.worldState.status !== 'published' || this.session !== null || !['planned', 'awaiting-settle'].includes(this.world.commit.control.phase) || this.world.commit.control.day === null) return failure('NOT_AVAILABLE', 'abandonDay is not available.');
    const base = this.world, day = base.commit.control.day;
    const paths = base.profileVersion === 1 ? base.tree.entries.map((entry) => entry.path).filter((candidate) => candidate.startsWith(`days/${day}/`)) : [`days/${day}/plan.json`, `days/${day}/play.json`, `days/${day}/summary.md`].filter((candidate) => base.tree.entries.some((entry) => entry.path === candidate));
    const published = await this.mutationPublisher(this.worldRoot, { operationType: 'abandon-day', base, changes: paths.map((documentPath) => ({ op: 'delete' as const, path: documentPath })), control: { phase: 'idle', day: null, lastSettledDay: base.commit.control.lastSettledDay } });
    this.installPublished(published); return success();
  }); }
  private async publishSubmission(session: CoreSession, final: string): Promise<PublishedWorld> {
    if (session.kind === 'play') {
      if (session.pinned!.profileVersion === 1) {
        let rich: { submission: ReturnType<typeof parsePlaySubmissionV2>; changes: ReturnType<typeof buildPlayMutationV1> } | null = null;
        try {
          const submission = parsePlaySubmissionV2(final); rich = { submission, changes: buildPlayMutationV1(session.pinned!, submission) };
        } catch { /* Profile V0 submission compatibility falls through during staged rollout. */ }
        if (rich !== null) return this.mutationPublisher(this.worldRoot, { operationType: 'play', base: session.pinned!, changes: [...rich.changes, ...await buildSessionAuditV1(session, rich.submission, final)], control: { phase: 'awaiting-settle', day: session.day, lastSettledDay: session.pinned!.commit.control.lastSettledDay } });
      }
      let documents;
      try { documents = validateAndBuildPlayDocuments(session.pinned!.playContext!.plan, parsePlaySubmissionV1(final)); }
      catch (error) { throw new CoreOperationError('SUBMISSION_INVALID', messageOf(error)); }
      return this.playPublisher(this.worldRoot, session.pinned!, session.day!, documents);
    }
    if (session.kind === 'init') {
      let submission; try { submission = parseInitSubmissionV2(final); } catch (error) { throw new CoreOperationError('SUBMISSION_INVALID', messageOf(error)); }
      const changes = [...buildInitMutationV1(submission), ...await buildSessionAuditV1(session, submission, final)];
      return this.mutationPublisher(this.worldRoot, { operationType: 'init', base: null, initialManifest: { worldId: `world_${randomUUID().replaceAll('-', '')}`, title: submission.title.trim() }, changes, control: { phase: 'idle', day: null, lastSettledDay: null } });
    }
    if (session.kind === 'planning') {
      if (session.pinned!.profileVersion === 1) {
        let submission; try { submission = parsePlanningSubmissionV2(final); } catch (error) { throw new CoreOperationError('SUBMISSION_INVALID', messageOf(error)); }
        const changes = [...buildPlanningMutationV1(session.day!, submission), ...await buildSessionAuditV1(session, submission, final)];
        return this.mutationPublisher(this.worldRoot, { operationType: 'planning', base: session.pinned!, changes, control: { phase: 'planned', day: session.day, lastSettledDay: session.pinned!.commit.control.lastSettledDay } });
      }
      let submission; try { submission = parsePlanningSubmissionV1(final); } catch (error) { throw new CoreOperationError('SUBMISSION_INVALID', messageOf(error)); }
      const plan = { intent: submission.intent, beats: submission.beats.map((beat, index) => ({ id: `beat${index + 1}`, intent: beat.intent })) };
      return this.mutationPublisher(this.worldRoot, { operationType: 'planning', base: session.pinned!, changes: [{ op: 'put', path: `days/${session.day}/plan.json`, mediaType: 'application/json', bytes: json(plan) }], control: { phase: 'planned', day: session.day, lastSettledDay: session.pinned!.commit.control.lastSettledDay } });
    }
    if (session.pinned!.profileVersion === 1) {
      try {
        const submission = parseReviseSubmissionV2(final);
        const changes = [...buildReviseMutationV1(session.pinned!, submission), ...await buildSessionAuditV1(session, submission, final)];
        return this.mutationPublisher(this.worldRoot, { operationType: 'revise', base: session.pinned!, changes, control: { ...session.pinned!.commit.control } });
      } catch (error) {
        // Temporary compatibility for worlds initialized through the former V1 prompt.
        try { const legacy = parseReviseSubmissionV1(final); return this.mutationPublisher(this.worldRoot, { operationType: 'revise', base: session.pinned!, changes: canonChanges(legacy.canon), control: { ...session.pinned!.commit.control } }); }
        catch { throw new CoreOperationError('SUBMISSION_INVALID', messageOf(error)); }
      }
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
        const cleanupError = await this.terminalize(session);
        return cleanupError === null ? success() : failure('INTERNAL_ERROR', cleanupError.message);
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
    if (this.session === session) { this.session = null; this.sessionStatus = null; this.changed(); }
    return this.cleanupSessionRoot(session.root);
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
      this.activeChild = null; this.session = null; this.sessionStatus = null;
      await this.remove(this.runtimeRoot, { recursive: true, force: true });
    })();
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

export function createDayloomCore(options: CreateDayloomCoreOptions & { eventProtocol: 'core-event-v2' }): Promise<DayloomCore<'core-event-v2'>>;
export function createDayloomCore(options: CreateDayloomCoreOptions & { eventProtocol?: 'core-event-v1' }): Promise<DayloomCore<'core-event-v1'>>;
export function createDayloomCore(options: CreateDayloomCoreOptions): Promise<DayloomCore> { return createDayloomCoreInternal(options); }
export async function createDayloomCoreInternal(options: CreateDayloomCoreOptions, internal: InternalOptions = {}): Promise<DayloomCore> {
  if (!options || typeof options.worldRoot !== 'string' || options.worldRoot.trim() === '' || typeof options.llmConfigPath !== 'string' || options.llmConfigPath.trim() === '') throw new CoreInitializationError('INVALID_OPTIONS', 'worldRoot and llmConfigPath are required.');
  if (options.eventProtocol !== undefined && options.eventProtocol !== 'core-event-v1' && options.eventProtocol !== 'core-event-v2') throw new CoreInitializationError('INVALID_OPTIONS', 'eventProtocol must be core-event-v1 or core-event-v2.');
  const eventProtocol = options.eventProtocol ?? 'core-event-v1';
  const worldRoot = path.resolve(options.worldRoot), llmConfigPath = path.resolve(options.llmConfigPath);
  try { await mkdir(worldRoot, { recursive: true }); } catch (error) { throw new CoreInitializationError('INTERNAL_ERROR', 'Could not create worldRoot directory.', { cause: error }); }
  let config: CallerConfig; try { config = await readCallerConfig(llmConfigPath); } catch (error) { throw new CoreInitializationError('INVALID_OPTIONS', 'Invalid caller LLM config.', { cause: error }); }
  let boundaries: PackagedBoundaries; try { boundaries = internal.boundaries ?? await resolvePackagedBoundaries(); } catch (error) { throw new CoreInitializationError('INTERNAL_ERROR', 'Could not initialize packaged Promptpile boundaries.', { cause: error }); }
  try {
    const classifier = internal.classifier ?? classifyWorld;
    const classified = await classifier(worldRoot), runtimeRoot = await mkdtemp(path.join(os.tmpdir(), 'dayloom-core2-'));
    await mkdir(path.join(runtimeRoot, 'sessions'));
    return new DayloomCoreImpl(classified, worldRoot, runtimeRoot, config, boundaries, internal.runner ?? nodeProcessRunner, internal.publisher ?? publishPlay, internal.mutationPublisher ?? publishMutation, internal.remove ?? rm, classifier, eventProtocol);
  } catch (error) { throw new CoreInitializationError('INTERNAL_ERROR', 'Could not initialize Core runtime.', { cause: error }); }
}
