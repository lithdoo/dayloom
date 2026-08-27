import { cp, mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
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
import { buildContextMessage, createPlayWorkspace } from './session/play';
import { buildLifecycleContext, createInitWorkspace, createPlanningWorkspace, createReviseWorkspace } from './session/lifecycle';
import type { CoreSession } from './session/common';
import { buildSettlementMutationV1 } from './world/builders/settlement';
import { readStructuredDayEventsV1 } from './world/profile/events';
import { openDraftV2, type DraftHandleV2 } from './session/draft-store-v2';
import type { AggregateHeadV1 } from './session/aggregate-head';
import { compareAndSwapAggregateHeadV1, readAggregateHeadV1 } from './session/aggregate-head';
import { verifySnapshotDirectoryV2 } from './session/markdown-draft-snapshot';
import { materializeConversationRevisionV1 } from './session/conversation-revision';
import { runTurnCoordinatorV1 } from './session/turn-coordinator';
import { writeTurnRecordV1, readTurnRecordV1, type TurnAuditV1 } from './session/turn-record';
import { AiTurnAgentV2 } from './session/turn-agent-v2';
import { runSubmissionPipelineV2, SubmissionPipelineErrorV2 } from './session/submission-pipeline-v2';
import { AiSubmissionConverterV2, AiSubmissionPlannerV2, AiSubmissionReviewerV2 } from './session/submission-agent-v2';
import { acquireWorldRuntimeLockV1, type WorldRuntimeLockV1 } from './session/runtime-lock';
import { createHash } from 'node:crypto';

export interface CreateDayloomCoreOptions { worldRoot: string; llmConfigPath: string; runtimeRoot?: string }
export interface DayloomCore {
  getState(): CoreState;
  subscribe(listener: (event: CoreEvent) => void): () => void;
  startSession(kind: CoreSessionKind): Promise<CoreResult>;
  send(text: string): Promise<CoreResult>;
  submit(): Promise<CoreResult>;
  retryDraftSync(): Promise<CoreResult>;
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
  turnAgentFactory?:(input:any)=>Pick<AiTurnAgentV2,'generate'|'arbitrate'|'prepareConversation'|'discardResponse'|'curate'>;
  submissionAgents?:{planner:any;converter:any;reviewer:any};
}
interface ActiveSessionRuntime { readonly workspace: CoreSession; readonly draft: DraftHandleV2; readonly persistentRoot:string; head:Readonly<AggregateHeadV1> }
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
  private readonly listeners = new Set<(event: CoreEvent) => void>();
  constructor(
    classified: ClassifiedWorld, private readonly worldRoot: string, private readonly runtimeRoot: string, private readonly persistentRuntimeRoot: string,
    private readonly config: CallerConfig, private readonly boundaries: PackagedBoundaries,
    private readonly runner: ProcessRunner, private readonly mutationPublisher: typeof publishMutation,
    private readonly remove: typeof rm,
    private readonly classifier: typeof classifyWorld,
    private readonly runtimeLock: WorldRuntimeLockV1,
    private readonly turnAgentFactory:(input:any)=>Pick<AiTurnAgentV2,'generate'|'arbitrate'|'prepareConversation'|'discardResponse'|'curate'>,
    private readonly injectedSubmissionAgents:{planner:any;converter:any;reviewer:any}|null,
  ) { this.world = classified.published; this.worldState = classified.state; }
  private workspace(): CoreSession | null { return this.activeSession?.workspace ?? null; }
  private publicSession(): CoreState['session'] {
    if(!this.activeSession||!this.sessionPhase)return null;const pending=this.activeSession.head.activeSession?.pendingDraftSync;return { id: this.activeSession.workspace.id, kind: this.activeSession.workspace.kind, status: this.sessionPhase, draftSync: pending?{status:'pending' as const,turnId:pending.turnId}:{ status: 'clean' as const } };
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
  async restorePersistentSession(): Promise<void> {
    const activeRoot = path.join(this.persistentRuntimeRoot, 'drafts', 'active');
    let entries;
    try { entries = await readdir(activeRoot, { withFileTypes: true }); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return; throw error; }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const slotRoot = path.join(activeRoot, entry.name);
      const raw = JSON.parse(await readFile(path.join(slotRoot, 'meta.json'), 'utf8')) as any;
      if (raw.baseCommitId !== (this.world?.commit.id ?? null) || raw.baseRootTreeHash !== (this.world?.commit.rootTreeHash ?? null)) continue;
      const draft = await openDraftV2({ runtimeRoot: this.persistentRuntimeRoot, kind: raw.kind, worldIdentity: raw.worldIdentity, baseCommitId: raw.baseCommitId, baseRootTreeHash: raw.baseRootTreeHash, targetDay: raw.targetDay });
      const head = await draft.head();
      if (head.activeSession === null) continue;
      if (this.activeSession) throw new Error('Multiple active persistent Sessions exist.');
      const id = head.activeSession.sessionId;
      let session: CoreSession;
      if (raw.kind === 'init') session = await createInitWorkspace(this.runtimeRoot, id, this.config);
      else if (raw.kind === 'planning') session = await createPlanningWorkspace(this.runtimeRoot, id, this.world!, this.config);
      else if (raw.kind === 'revise') session = await createReviseWorkspace(this.runtimeRoot, id, this.world!, this.config);
      else session = await createPlayWorkspace(this.runtimeRoot, id, this.world!, this.config);
      this.activeSession = { workspace: session, draft, persistentRoot: path.join(draft.root, 'sessions', id), head };
      this.sessionPhase = 'ready';
    }
  }
  startSession(kind: CoreSessionKind) { return this.operation(async () => {
    if (!this.canStart(kind)) return failure('NOT_AVAILABLE', `${kind} Session is not available.`);
    const id = randomUUID(), sessionRoot = path.join(this.runtimeRoot, 'sessions', id);
    let session: CoreSession | null = null;
    try {
      const targetDay = kind === 'planning' ? (await import('./world/read')).nextDay(this.world?.commit.control.lastSettledDay ?? null) : kind === 'play' ? this.world!.commit.control.day : null;
      const worldIdentity = this.world?.manifest.worldId ?? createHash('sha256').update(this.worldRoot.toLowerCase()).digest('hex');
      const draft = await openDraftV2({ runtimeRoot: this.persistentRuntimeRoot, kind, worldIdentity, baseCommitId: this.world?.commit.id ?? null, baseRootTreeHash: this.world?.commit.rootTreeHash ?? null, targetDay });
      const initialHead=await draft.head();if(initialHead.activeSession!==null)throw new CoreOperationError('NOT_AVAILABLE','This Draft already has an active Session.');
      if (kind === 'init') session = await createInitWorkspace(this.runtimeRoot, id, this.config);
      else if (kind === 'planning') session = await createPlanningWorkspace(this.runtimeRoot, id, this.world!, this.config);
      else if (kind === 'revise') session = await createReviseWorkspace(this.runtimeRoot, id, this.world!, this.config);
      else session = await createPlayWorkspace(this.runtimeRoot, id, this.world!, this.config);
      const context = kind === 'play' ? buildContextMessage(this.world!) : buildLifecycleContext(session);
      if (context !== null) await this.appendConversation(session.contextDir, context);
      if (this.disposed) throw new CoreOperationError('DISPOSED', 'Core is disposed.');
      const persistentRoot=path.join(draft.root,'sessions',id),conversationId=`conv_${randomUUID().replaceAll('-','')}`;await mkdir(path.join(persistentRoot,'turns'),{recursive:true});await writeFile(path.join(persistentRoot,'meta.json'),`${JSON.stringify({schemaVersion:1,sessionId:id,kind,targetDay,createdAt:new Date().toISOString()},null,2)}\n`);await materializeConversationRevisionV1({sessionRoot:persistentRoot,conversationId,source:session.conversationDir});const head=await compareAndSwapAggregateHeadV1({slotRoot:draft.root,expectedRevision:initialHead.revision,next:{schemaVersion:1,revision:initialHead.revision+1,draftHash:initialHead.draftHash,activeSession:{sessionId:id,conversationId,pendingDraftSync:null}}});
      this.activeSession = { workspace: session, draft,persistentRoot,head }; this.sessionPhase = 'ready'; return success();
    } catch (error) {
      await this.cleanupSessionRoot(session?.root ?? sessionRoot);
      if (error instanceof ArchiveRetrievalError || error instanceof SessionFileRuntimeError) return failure('AGENT_FAILED', error.message);
      if (error instanceof CoreOperationError) return failure(error.code, error.message);
      return failure(session ? 'CONVERSATION_FAILED' : 'INTERNAL_ERROR', messageOf(error));
    }
  }); }
  send(text: string) { return this.operation(async () => {
    const active = this.activeSession;
    if (!active || this.sessionPhase !== 'ready' || active.head.activeSession?.pendingDraftSync!==null) return failure('NOT_AVAILABLE', 'send is not available.');
    if (typeof text !== 'string' || text.trim() === '') return failure('INVALID_INPUT', 'Input must be non-empty.');
    const session = active.workspace; this.sessionPhase = 'running'; this.changed();
    try {
      if (this.disposed) throw new CoreOperationError('DISPOSED', 'Core is disposed.');
      const authority = await active.draft.head();
      if (authority.revision !== active.head.revision || authority.activeSession?.sessionId !== session.id) throw new CoreOperationError('DRAFT_CONFLICT', 'Session authority changed.');
      const snapshot = await active.draft.snapshot();
      const conversationRoot = path.join(active.persistentRoot, 'conversations', authority.activeSession.conversationId);
      const operationRoot = path.join(session.root, 'turn-operations');
      let projectedOperationId: string | null = null, projectedTurnId: string | null = null, projectedKind: import('./session/turn-coordinator').OperationKindV1 | null = null;
      const agent = this.turnAgentFactory({
        worldRoot: this.worldRoot, operationRoot, slotRoot: active.draft.root,
        persistentSessionRoot: active.persistentRoot, sessionId: session.id, sessionKind: session.kind, userInput: text,
        baseConversationRoot: conversationRoot, baseSnapshot: snapshot, world: this.world,
        config: this.config, boundaries: this.boundaries, runner: this.runner,
        requestsDir: session.requestsDir, summaryConfigPath: session.summaryConfigPath, summaryPromptPath: session.summaryPromptPath,
        onChild: (child: ChildProcess) => this.childStarted(child, session.id),
        onChildEnd: (child: ChildProcess) => this.childEnded(child),
        observer: () => ({
          workDelta: (phase: any, _step: number, textDelta: string) => { if (projectedOperationId) this.emit({ type: 'operation.delta', sessionId: session.id, turnId: projectedTurnId, operationId: projectedOperationId, channel: phase, text: textDelta }); },
          outputDelta: (textDelta: string) => { if (projectedOperationId && projectedKind === 'response') this.emit({ type: 'operation.delta', sessionId: session.id, turnId: projectedTurnId, operationId: projectedOperationId, channel: 'response', text: textDelta }); },
        }),
      });
      const result = await runTurnCoordinatorV1({
        slotRoot: active.draft.root, sessionId: session.id, userInput: text, base: authority,
        effects: {
          generate: async (op, attempt, repair) => { projectedOperationId = op; projectedKind = 'response'; return agent.generate(op, attempt, repair); },
          arbitrate: async (op, response, attempt) => { projectedOperationId = op; projectedKind = 'arbitration'; return agent.arbitrate(op, response, attempt); },
          prepareConversation: (response) => agent.prepareConversation(response),
          discardResponse: (response) => agent.discardResponse(response),
          curate: async (op, request) => { projectedOperationId = op; projectedKind = 'draft-curation'; return agent.curate(op, request); },
          persist: (record) => writeTurnRecordV1(path.join(active.persistentRoot, 'turns', `${record.turnId}.json`), record),
          emit: (event) => { if (event.type === 'operation.started') { projectedTurnId = event.turnId; projectedKind = event.kind; } this.emit(event); }, cancelled: () => this.isCancelRequested(session) || this.disposed,
        },
      });
      active.head = result.head; this.sessionPhase = 'ready'; this.changed();
      if(result.status==='committed')return success();if(result.status==='draft-sync-pending')return failure('DRAFT_SYNC_FAILED','The response was accepted, but Draft synchronization is pending.');if(result.status==='policy-rejected')return failure('TURN_POLICY_REJECTED','The response did not pass Turn policy after repair.');if(result.status==='cancelled')return this.cancelledResult();return failure('TURN_REVIEW_FAILED','The Turn could not be accepted.');
    } catch (error) {
      this.sessionPhase='ready';this.changed();if(this.isCancelRequested(session))return this.cancelledResult();throw error;
    }
  }); }
  submit() { return this.operation(async () => {
    const active = this.activeSession;
    if (!active || this.sessionPhase !== 'ready' || active.head.activeSession?.pendingDraftSync!==null) return failure('NOT_AVAILABLE', 'submit is not available.');
    const session = active.workspace, groupId = `submission_${randomUUID().replaceAll('-', '')}`;
    let operationId = `op_${randomUUID().replaceAll('-', '')}`, operationKind: 'submission-conversion'|'submission-repair'|'submission-review' = 'submission-conversion';
    this.sessionPhase = 'submitting'; this.changed();
    this.emit({type:'operation.started',sessionId:session.id,turnId:null,operationId,groupId,kind:operationKind,attempt:1});
    try {
      if (this.disposed) throw new CoreOperationError('DISPOSED', 'Core is disposed.');
      const observer = {
        workDelta: (phase: 'thought' | 'observe' | 'check', _stepIndex: number, text: string) => this.emit({ type: 'operation.delta', sessionId: session.id,turnId:null, operationId, channel:phase, text }),
      };
      const agentOptions = { worldRoot: this.worldRoot, config: this.config, boundaries: this.boundaries, runner: this.runner, onChild: (child: ChildProcess) => this.childStarted(child, session.id), observer };
      const turns:TurnAuditV1[]=[];for(const entry of await readdir(path.join(active.persistentRoot,'turns'),{withFileTypes:true}))if(entry.isFile()&&entry.name.endsWith('.json'))turns.push(await readTurnRecordV1(path.join(active.persistentRoot,'turns',entry.name)) as TurnAuditV1);
      const submissionAgents=this.injectedSubmissionAgents??{planner:new AiSubmissionPlannerV2(agentOptions),converter:new AiSubmissionConverterV2(agentOptions),reviewer:new AiSubmissionReviewerV2(agentOptions)};
      const projectStage = (stage: import('./session/submission-pipeline-v2').SubmissionStageV2, attempt: number) => {
        const nextKind = stage === 'repair' ? 'submission-repair' : stage === 'review' ? 'submission-review' : operationKind;
        if (nextKind !== operationKind || (nextKind === 'submission-repair' && stage === 'repair')) {
          this.emit({ type: 'operation.finished', sessionId: session.id, turnId: null, operationId, disposition: nextKind === 'submission-review' ? 'committed' : 'superseded' });
          operationKind = nextKind; operationId = `op_${randomUUID().replaceAll('-', '')}`;
          this.emit({ type: 'operation.started', sessionId: session.id, turnId: null, operationId, groupId, kind: operationKind, attempt });
        }
        this.emit({ type: 'operation.stage', sessionId: session.id, turnId: null, operationId, stage: stage === 'publish' ? 'publish' : stage === 'validate' ? 'validate' : stage === 'review' ? 'verify' : 'materialize' });
      };
      const result = await runSubmissionPipelineV2({ worldRoot: this.worldRoot, transientRoot: session.root, session, draft: active.draft,turns, planner:submissionAgents.planner, converter:submissionAgents.converter, reviewer:submissionAgents.reviewer, stage: projectStage, publish: (request) => this.mutationPublisher(this.worldRoot, request) });
      if (this.disposed) throw new CoreOperationError('DISPOSED', 'Core is disposed.'); this.activeChild = null;
      this.installPublished(result.published);
      this.emit({type:'operation.produced',sessionId:session.id,turnId:null,operationId,artifactId:result.published.commit.id});this.emit({type:'operation.finished',sessionId:session.id,turnId:null,operationId,disposition:'committed'});
      await this.terminalize(session);
      return success();
    } catch (error) {
      this.activeChild = null;
      if (this.isCancelRequested(session)) {
        this.emit({type:'operation.finished',sessionId:session.id,turnId:null,operationId,disposition:'cancelled',message:'Submission was cancelled.'});
        this.sessionPhase = 'ready'; this.changed(); return this.cancelledResult();
      }
      if (error instanceof SubmissionPipelineErrorV2) {
        if (error.diagnostics.length > 0) this.emit({ type: 'operation.diagnostics', sessionId: session.id,turnId:null, operationId, items:error.diagnostics });
        this.emit({type:'operation.finished',sessionId:session.id,turnId:null,operationId,disposition:'failed',message:error.message});
        this.sessionPhase = 'ready'; this.changed(); return failure(error.code, error.message, error.diagnostics);
      }
      this.sessionPhase = 'ready'; this.changed(); throw error;
    }
  }); }
  retryDraftSync() { return this.operation(async () => {
    const active=this.activeSession,pending=active?.head.activeSession?.pendingDraftSync;if(!active||this.sessionPhase!=='ready'||!pending)return failure('NOT_AVAILABLE','retryDraftSync is not available.');const session=active.workspace;this.sessionPhase='running';this.changed();const recordPath=path.join(active.persistentRoot,'turns',`${pending.turnId}.json`),record=structuredClone(await readTurnRecordV1(recordPath)) as TurnAuditV1,generation=record.generationAttempts.find((item)=>item.generationId===pending.acceptedGenerationId);if(!generation){this.sessionPhase='ready';this.changed();return failure('DRAFT_SYNC_FAILED','Pending Turn evidence is missing.');}const snapshot=await active.draft.snapshot(),operationId=`op_${randomUUID().replaceAll('-','')}`,attempt=Math.min(2,record.curationAttempts.length+1) as 1|2;this.emit({type:'operation.started',sessionId:session.id,turnId:null,operationId,groupId:`retry_${pending.turnId}`,kind:'draft-curation',attempt});
    try {
      const response = { generationId: generation.generationId, operationId: generation.operationId, responseText: generation.responseText, stagedConversationRoot: path.join(active.persistentRoot, 'conversations', active.head.activeSession!.conversationId) };
      const agent = this.turnAgentFactory({
        worldRoot: this.worldRoot, operationRoot: path.join(session.root, 'retry-operations'), slotRoot: active.draft.root,
        persistentSessionRoot: active.persistentRoot, sessionId: session.id, userInput: record.userInput,
        baseConversationRoot: path.join(active.persistentRoot, 'conversations', active.head.activeSession!.conversationId), baseSnapshot: snapshot,
        world: this.world, config: this.config, boundaries: this.boundaries, runner: this.runner,
        requestsDir: session.requestsDir, summaryConfigPath: session.summaryConfigPath, summaryPromptPath: session.summaryPromptPath,
        onChild: (child: ChildProcess) => this.childStarted(child, session.id),
        onChildEnd: (child: ChildProcess) => this.childEnded(child),
        observer: () => ({ workDelta: (phase: any, _step: number, text: string) => this.emit({ type: 'operation.delta', sessionId: session.id, turnId: null, operationId, channel: phase, text }) }),
      });
      const curated = await agent.curate(operationId, { turnId: pending.turnId, accepted: response, baseDraftHash: pending.baseDraftHash, attempt });
      if (this.isCancelRequested(session)) throw new CoreOperationError('CANCELLED', 'Draft retry was cancelled.');
      const head = await compareAndSwapAggregateHeadV1({ slotRoot: active.draft.root, expectedRevision: active.head.revision, next: { schemaVersion: 1, revision: active.head.revision + 1, draftHash: curated.snapshot.hash, activeSession: { sessionId: session.id, conversationId: active.head.activeSession!.conversationId, pendingDraftSync: null } } });
      active.head = head; record.resultDraftHash = curated.snapshot.hash;
      record.curationAttempts.push({ operationId, attempt, disposition: 'committed', baseDraftHash: pending.baseDraftHash, resultDraftHash: curated.snapshot.hash, diagnostics: [] });
      record.terminalStatus = 'committed'; await writeTurnRecordV1(recordPath, record);
      this.emit({ type: 'operation.produced', sessionId: session.id, turnId: null, operationId, artifactId: curated.snapshot.hash });
      this.emit({ type: 'turn.commit', sessionId: session.id, turnId: pending.turnId, commit: 'draft', headRevision: head.revision });
      this.emit({ type: 'operation.finished', sessionId: session.id, turnId: null, operationId, disposition: 'committed' });
      this.sessionPhase = 'ready'; this.changed(); return success();
    }
    catch(error){record.curationAttempts.push({operationId,attempt,disposition:this.isCancelRequested(session)?'cancelled':'failed',baseDraftHash:pending.baseDraftHash,resultDraftHash:null,diagnostics:[]});await writeTurnRecordV1(recordPath,record).catch(()=>undefined);this.emit({type:'operation.finished',sessionId:session.id,turnId:null,operationId,disposition:this.isCancelRequested(session)?'cancelled':'failed',message:messageOf(error)});this.sessionPhase='ready';this.changed();return this.isCancelRequested(session)?this.cancelledResult():failure('DRAFT_SYNC_FAILED',messageOf(error));}
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
      const active = this.activeSession!;
      const head = await active.draft.head();
      if (head.activeSession?.sessionId !== current.id) return failure('DRAFT_CONFLICT', 'Session authority changed.');
      const next = await compareAndSwapAggregateHeadV1({ slotRoot: active.draft.root, expectedRevision: head.revision, next: { schemaVersion: 1, revision: head.revision + 1, draftHash: head.draftHash, activeSession: null } });
      active.head = next;
      const pending = head.activeSession.pendingDraftSync;
      if (pending) {
        const recordPath = path.join(active.persistentRoot, 'turns', `${pending.turnId}.json`);
        try {
          const record = structuredClone(await readTurnRecordV1(recordPath)) as TurnAuditV1;
          record.terminalStatus = 'abandoned-after-accept';
          await writeTurnRecordV1(recordPath, record);
        } catch { /* Head is authoritative; the retained Session remains inspectable. */ }
      }
      const abandonedRoot = path.join(this.persistentRuntimeRoot, 'drafts', 'abandoned-sessions');
      await mkdir(abandonedRoot, { recursive: true });
      let target = path.join(abandonedRoot, current.id);
      let persistentCleanupError: Error | null = null;
      try { await rename(active.persistentRoot, target); }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'EEXIST' || (error as NodeJS.ErrnoException).code === 'ENOTEMPTY') {
          target = path.join(abandonedRoot, `${current.id}-${Date.now()}`);
          try { await rename(active.persistentRoot, target); } catch (retryError) { persistentCleanupError = retryError instanceof Error ? retryError : new Error('Could not retain abandoned Session.'); }
        } else persistentCleanupError = error instanceof Error ? error : new Error('Could not retain abandoned Session.');
      }
      const cleanupError = await this.terminalize(current);
      const terminalError = persistentCleanupError ?? cleanupError;
      return terminalError === null ? success() : failure('INTERNAL_ERROR', terminalError.message);
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
      this.activeChild = null;
      const active = this.activeSession; this.activeSession = null; this.sessionPhase = null;
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
    await recoverDraftSlotsForWorld(persistentRuntimeRoot, classified.published);
    const core = new DayloomCoreImpl(classified, worldRoot, runtimeRoot, persistentRuntimeRoot, config, boundaries, internal.runner ?? nodeProcessRunner, internal.mutationPublisher ?? publishMutation, internal.remove ?? rm, classifier, runtimeLock, internal.turnAgentFactory ?? ((input) => new AiTurnAgentV2(input)), internal.submissionAgents ?? null);
    await core.restorePersistentSession();
    return core;
  } catch (error) { await runtimeLock?.release().catch(() => undefined); const code = codeOf(error) === 'WORLD_BUSY' ? 'WORLD_BUSY' : messageOf(error).startsWith('DRAFT_MIGRATION_FAILED')?'DRAFT_MIGRATION_FAILED':'INTERNAL_ERROR'; throw new CoreInitializationError(code, code === 'WORLD_BUSY' ? messageOf(error) : code==='DRAFT_MIGRATION_FAILED'?messageOf(error):'Could not initialize Core runtime.', { cause: error }); }
}

async function recoverDraftSlotsForWorld(runtimeRoot: string, world: PublishedWorld | null): Promise<void> {
  const activeRoot = path.join(runtimeRoot, 'drafts', 'active');
  let entries;
  try { entries = await readdir(activeRoot, { withFileTypes: true }); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return; throw error; }
  const currentCommit = world?.commit.id ?? null;
  const currentTree = world?.commit.rootTreeHash ?? null;
  const staleRoot = path.join(runtimeRoot, 'drafts', 'stale');
  await mkdir(staleRoot, { recursive: true });
  for (const entry of entries) {
    if (!entry.isDirectory()) throw new Error('Draft active root contains a non-directory entry.');
    const slotRoot = path.join(activeRoot, entry.name);
    let value: unknown;
    try { value = JSON.parse(await readFile(path.join(slotRoot, 'meta.json'), 'utf8')); }
    catch (error) { throw new Error(`Draft slot ${entry.name} has unreadable meta.`, { cause: error }); }
    if (!isRecoverableDraftMeta(value)) throw new Error(`Draft slot ${entry.name} has invalid meta.`);
    if (value.baseCommitId === currentCommit && value.baseRootTreeHash === currentTree) continue;
    const head = await readAggregateHeadV1(slotRoot);
    const publishedSession = head.activeSession?.sessionId;
    if (world && publishedSession && world.tree.entries.some((item) => item.path === `audit/sessions/${publishedSession}/meta.json`)) {
      await finishPublishedDraftArchive(runtimeRoot, slotRoot, value.draftId, head.draftHash);
      continue;
    }
    const target = path.join(staleRoot, `${value.draftId}-${Date.now()}-${entry.name.slice(0, 8)}`);
    await rename(slotRoot, target);
  }
}

async function finishPublishedDraftArchive(runtimeRoot: string, slotRoot: string, draftId: string, draftHash: string): Promise<void> {
  const draftsRoot = path.join(runtimeRoot, 'drafts'), target = path.join(draftsRoot, 'archive', draftId);
  await mkdir(path.dirname(target), { recursive: true });
  try {
    await verifySnapshotDirectoryV2(path.join(target, 'snapshot'), draftHash);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      try { await readFile(path.join(target, 'meta.json')); } catch (missing) { if ((missing as NodeJS.ErrnoException).code !== 'ENOENT') throw missing; else throw error; }
      throw error;
    }
    const staging = path.join(draftsRoot, 'prepared', `${draftId}-recovery-${randomUUID()}`);
    await mkdir(staging, { recursive: true });
    try {
      await cp(path.join(slotRoot, 'meta.json'), path.join(staging, 'meta.json'));
      await cp(path.join(slotRoot, 'snapshots', draftHash), path.join(staging, 'snapshot'), { recursive: true });
      await verifySnapshotDirectoryV2(path.join(staging, 'snapshot'), draftHash);
      await rename(staging, target);
    } finally { await rm(staging, { recursive: true, force: true }).catch(() => undefined); }
  }
  await rm(slotRoot, { recursive: true, force: true });
}

function isRecoverableDraftMeta(value: unknown): value is { schemaVersion: 1 | 2; draftId: string; baseCommitId: string | null; baseRootTreeHash: string | null } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const item = value as Record<string, unknown>;
  return (item.schemaVersion === 1 || item.schemaVersion === 2)
    && typeof item.draftId === 'string' && item.draftId !== ''
    && (item.baseCommitId === null || typeof item.baseCommitId === 'string')
    && (item.baseRootTreeHash === null || typeof item.baseRootTreeHash === 'string');
}
