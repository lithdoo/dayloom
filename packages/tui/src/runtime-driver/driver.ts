import type { CoreError, CoreEvent, CoreResult, CoreSessionKind, CoreState, DayloomCore } from '@dayloom/core';
import type { DiagnosticLogger } from '@bindtty/terminal';
import { summarizeCoreEvent, summarizeDriverState } from '../diagnostics.js';
import { projectHubActions } from '../hub/actions.js';
import { closePresentation, isWorking, reducePresentation, type PresentationState } from './presentation-reducer.js';
import type {
  HubMode, TuiBusinessActionId, TuiDriverState, TuiHubAction, TuiMessage, TuiPresentationItem, WorkVisibility,
  TuiRecentResult, TuiSessionControls, TuiSessionPresentation, TuiWorldView,
} from '../types.js';

export interface TuiRuntimeDriver {
  getState(): TuiDriverState;
  subscribe(listener: (state: TuiDriverState) => void): () => void;
  runHubAction(actionId: string): Promise<'continue' | 'exit'>;
  submitSessionText(text: string): Promise<void>;
  setHubMode(mode: HubMode): void;
  selectHubAction(actionId: string): void;
  dispose(): Promise<void>;
}

interface PendingHubRequest {
  actionId: TuiBusinessActionId;
  frozenActions: readonly TuiHubAction[];
  frozenSelectedId: string | null;
}
interface ActiveSendRequest { sessionId: string; assistantMessageId: string | null; cancelRequested: boolean }
interface PendingSessionCancel { sessionId: string }

const MAX_MESSAGES = 500;
const MAX_TEXT_CHARS = 250_000;

export function createDriverFromCore(options: {
  worldRoot: string;
  core: DayloomCore;
  diagnostic?: DiagnosticLogger;
  workVisibility?: WorkVisibility;
}): TuiRuntimeDriver {
  const { core, diagnostic } = options;
  const listeners = new Set<(state: TuiDriverState) => void>();
  let latestCoreState = core.getState();
  let hubMode: HubMode = 'status';
  let selectedHubActionId: string | null = null;
  let pendingHubRequest: PendingHubRequest | null = null;
  let activeSendRequest: ActiveSendRequest | null = null;
  let pendingSessionCancel: PendingSessionCancel | null = null;
  let recent: TuiRecentResult | null = null;
  let presentedSession: TuiSessionPresentation | null = null;
  let messages: TuiMessage[] = [];
  let presentation: PresentationState = { items: [], operation: null };
  let page: TuiDriverState['page'] = { kind: 'hub', mode: hubMode, busy: null };
  let nextMessageId = 1;
  let disposed = false;
  let disposePromise: Promise<void> | null = null;

  const unsubscribeCore = core.subscribe((event) => {
    applyCoreEvent(event);
    diagnostic?.log('core-event', { ...summarizeCoreEvent(event), ...summarizeDriverState(getState()) });
    emit();
  });

  diagnostic?.log('driver-created', {
    worldRoot: options.worldRoot,
    worldStatus: latestCoreState.world.status,
    sessionId: latestCoreState.session?.id,
  });

  return {
    getState,
    subscribe(listener) {
      if (disposed) { listener(getState()); return () => {}; }
      listeners.add(listener); listener(getState());
      return () => { listeners.delete(listener); };
    },
    async runHubAction(actionId) {
      if (disposed) return 'exit';
      if (page.kind !== 'hub' || pendingHubRequest) return 'continue';
      const projection = projectedActions();
      const action = projection.actions.find((candidate) => candidate.id === actionId);
      if (!action) return 'continue';
      if (action.kind === 'local') {
        if (action.id === 'quit') return 'exit';
        hubMode = action.id;
        page = { kind: 'hub', mode: hubMode, busy: null };
        emit();
        return 'continue';
      }

      const request: PendingHubRequest = {
        actionId: action.id,
        frozenActions: projection.actions.map((candidate) => ({ ...candidate })),
        frozenSelectedId: projection.selectedId,
      };
      pendingHubRequest = request;
      page = { kind: 'hub', mode: hubMode, busy: { actionId: action.id, label: loadingForAction(action.id) } };
      emit();
      let result: CoreResult;
      try { result = await callBusiness(core, action.id); }
      catch (error) {
        diagnostic?.error('hub-action-error', error, { actionId: action.id });
        result = internalFailure(error);
      }
      if (disposed || pendingHubRequest !== request) return disposed ? 'exit' : 'continue';
      latestCoreState = core.getState();
      pendingHubRequest = null;
      if (isSessionAction(action.id)) reduceStartSession(action.id, result);
      else reduceStableMutation(action.id, result);
      reconcileSelection();
      emit();
      return 'continue';
    },
    async submitSessionText(text) {
      if (disposed || !presentedSession || page.kind !== 'session') return;
      const trimmed = text.trim();
      if (trimmed === '') return;
      const token = trimmed.split(/\s+/, 1)[0]!.toLowerCase();

      if (presentedSession.status === 'failed') {
        if (token === '/exit' || token === '/cancel') dismissFailedPresentation();
        else appendLocal('warn', '会话已经失败，请输入 /exit 或 /cancel 返回 Hub。');
        emit(); return;
      }
      if (presentedSession.status === 'running') {
        if (token === '/exit' || token === '/cancel') await requestSessionCancel(presentedSession.id);
        else appendLocal('warn', 'AI 正在回复；如需中断，请输入 /exit 或 /cancel。');
        emit(); return;
      }
      if (presentedSession.status === 'submitting') {
        if (token === '/exit' || token === '/cancel') await requestSessionCancel(presentedSession.id);
        else appendLocal('warn', '正在提交；如需中断，请输入 /exit 或 /cancel。');
        emit(); return;
      }
      if (presentedSession.status === 'cancelling') return;
      if (trimmed.startsWith('/')) { await handleReadySlash(token); return; }
      if (!sessionControls().input) { appendLocal('warn', '当前会话暂不接受普通输入。'); emit(); return; }
      await requestSend(trimmed);
    },
    setHubMode(mode) {
      if (disposed || page.kind !== 'hub' || pendingHubRequest) return;
      hubMode = mode; page = { kind: 'hub', mode, busy: null }; emit();
    },
    selectHubAction(actionId) {
      if (disposed || page.kind !== 'hub' || pendingHubRequest) return;
      const actions = projectedActions().actions;
      if (!actions.some((action) => action.id === actionId)) return;
      selectedHubActionId = actionId; emit();
    },
    async dispose() {
      if (disposePromise) return disposePromise;
      disposed = true;
      unsubscribeCore(); listeners.clear(); discardTranscript();
      pendingHubRequest = null; pendingSessionCancel = null; presentedSession = null;
      disposePromise = core.dispose();
      await disposePromise;
    },
  };

  function getState(): TuiDriverState {
    const projection = projectedActions();
    return {
      page,
      world: projectWorld(latestCoreState, options.worldRoot),
      session: presentedSession ? { ...presentedSession, error: presentedSession.error ? { ...presentedSession.error } : null } : null,
      sessionControls: sessionControls(),
      hubActions: projection.actions,
      selectedHubActionId: projection.selectedId,
      recent: recent ? { ...recent } : null,
      presentationItems: presentation.items.map(clonePresentationItem),
      messages: messages.map((message) => ({ ...message })),
    };
  }

  function projectedActions(): { actions: readonly TuiHubAction[]; selectedId: string | null } {
    if (pendingHubRequest) return { actions: pendingHubRequest.frozenActions, selectedId: pendingHubRequest.frozenSelectedId };
    const projection = projectHubActions(latestCoreState.capabilities, selectedHubActionId);
    selectedHubActionId = projection.selectedId;
    return projection;
  }

  function reconcileSelection(): void { selectedHubActionId = projectHubActions(latestCoreState.capabilities, selectedHubActionId).selectedId; }

  function applyCoreEvent(event: CoreEvent): void {
    if (event.type === 'state.changed') {
      latestCoreState = event.state;
      const current = event.state.session;
      if (presentedSession && current?.id === presentedSession.id && !['cancelling', 'failed'].includes(presentedSession.status)) {
        presentedSession = { ...presentedSession, kind: current.kind, status: current.status, error: null };
      }
      return;
    }
    const request = activeSendRequest;
    if (presentedSession?.id !== event.sessionId) return;
    const projected = event.type === 'operation.delta' && event.channel!=='response' && !isPhaseVisible(options.workVisibility ?? 'all', event.channel) ? { ...event, text: '' } : event;
    presentation = reducePresentation(presentation, projected);
    messages = presentation.items.filter((item): item is TuiMessage => !isWorking(item));
    if (event.type === 'operation.started' && event.kind==='response' && request?.sessionId === event.sessionId) request.assistantMessageId = `response:${event.operationId}`;
    enforceTranscriptLimits();
  }

  function reduceStartSession(actionId: TuiBusinessActionId, result: CoreResult): void {
    const expectedKind = sessionKindFor(actionId);
    const finalSession = latestCoreState.session;
    if (result.ok && expectedKind && finalSession?.kind === expectedKind) {
      discardTranscript();
      presentedSession = { id: finalSession.id, kind: finalSession.kind, status: finalSession.status, error: null };
      page = { kind: 'session', sessionId: finalSession.id, sessionKind: finalSession.kind };
      appendLocal('system', openingFor(finalSession.kind));
      return;
    }
    page = { kind: 'hub', mode: hubMode, busy: null };
    const error = result.ok
      ? { code: 'INTERNAL_ERROR', message: 'Core did not install the requested Session.' }
      : result.error;
    recent = { kind: 'failed', label: `${actionLabel(actionId)}失败`, detail: error.message };
  }

  function reduceStableMutation(actionId: TuiBusinessActionId, result: CoreResult): void {
    page = { kind: 'hub', mode: hubMode, busy: null };
    recent = result.ok
      ? { kind: 'completed', label: `${actionLabel(actionId)}完成`, detail: null }
      : { kind: 'failed', label: `${actionLabel(actionId)}失败`, detail: result.error.message };
  }

  async function requestSend(text: string): Promise<void> {
    const session = presentedSession;
    if (!session) return;
    appendLocal('user', text);
    const request: ActiveSendRequest = { sessionId: session.id, assistantMessageId: null, cancelRequested: false };
    activeSendRequest = request;
    presentation = { ...presentation, operation: { sessionId: session.id, operationId: null, closed: false } };
    emit();
    let result: CoreResult;
    try { result = await core.send(text); }
    catch (error) { result = internalFailure(error); }
    latestCoreState = core.getState();
    if (presentedSession?.id !== request.sessionId || activeSendRequest !== request) return;
    if (!result.ok && result.error.code === 'CANCELLED' && request.cancelRequested) {
      activeSendRequest = null;
      emit(); return;
    }
    const assistant = request.assistantMessageId
      ? messages.find((message) => message.id === request.assistantMessageId)
      : null;
    activeSendRequest = null;
    presentation = closePresentation(presentation);
    if (result.ok && latestCoreState.session?.id === request.sessionId && latestCoreState.session.status === 'ready') {
      if (assistant?.status === 'streaming') assistant.status = 'complete';
      presentedSession = { ...presentedSession, status: 'ready', error: null };
    } else if (!result.ok) {
      if (assistant?.status === 'streaming') assistant.status = 'error';
      appendLocal('error', result.error.message);
      if (latestCoreState.session?.id === request.sessionId) {
        presentedSession = { ...presentedSession, status: latestCoreState.session.status, error: result.error };
      } else {
        presentedSession = { ...presentedSession, status: 'failed', error: result.error };
        recent = { kind: 'failed', label: '会话失败', detail: result.error.message };
      }
    }
    enforceTranscriptLimits(); emit();
  }

  async function handleReadySlash(token: string): Promise<void> {
    switch (token) {
      case '/submit': await requestSubmit(); return;
      case '/retry': await requestRetry(); return;
      case '/exit': case '/cancel': if (presentedSession) await requestSessionCancel(presentedSession.id); return;
      case '/status': appendLocal('system', '当前正在 Session 中，请先输入 /exit 回到 Hub 再查看状态。'); break;
      case '/help': appendLocal('system', '当前正在 Session 中，请先输入 /exit 回到 Hub 再查看帮助。'); break;
      case '/next': appendLocal('warn', 'TUI 不提供 /next，请回到 Hub 选择具体流程。'); break;
      case '/revise': appendLocal('warn', '请先回到 Hub，再选择修订流程。'); break;
      default: appendLocal('warn', `未知指令：${token}`);
    }
    emit();
  }

  async function requestSubmit(): Promise<void> {
    const session = presentedSession;
    if (!session || !sessionControls().submit) { appendLocal('warn', '当前会话不可提交。'); emit(); return; }
    presentation = { ...presentation, operation: { sessionId: session.id, operationId: null, closed: false } };
    let result: CoreResult;
    try { result = await core.submit(); }
    catch (error) { result = internalFailure(error); }
    latestCoreState = core.getState();
    presentation = closePresentation(presentation);
    if (presentedSession?.id !== session.id) return;
    if (result.ok && latestCoreState.session === null) {
      discardTranscript(); presentedSession = null; page = { kind: 'hub', mode: 'status', busy: null }; hubMode = 'status';
      recent = { kind: 'completed', label: '会话已提交', detail: null };
    } else if (!result.ok && result.error.code === 'CANCELLED' && latestCoreState.session?.id === session.id) {
      presentedSession = { ...presentedSession, status: latestCoreState.session.status, error: null };
      recent = { kind: 'cancelled', label: '提交已取消', detail: null };
    } else if (!result.ok && latestCoreState.session?.id === session.id) {
      appendLocal('error', result.error.message);
      presentedSession = { ...presentedSession, status: latestCoreState.session.status, error: result.error };
      recent = { kind: 'failed', label: '会话提交失败', detail: result.error.message };
    } else if (!result.ok) {
      appendLocal('error', result.error.message);
      presentedSession = { ...presentedSession, status: 'failed', error: result.error };
      recent = { kind: 'failed', label: '会话提交失败', detail: result.error.message };
    }
    emit();
  }

  async function requestRetry():Promise<void>{const session=presentedSession;if(!session||!sessionControls().retry){appendLocal('warn','当前没有可重试的 Draft 同步。');emit();return;}presentation={...presentation,operation:{sessionId:session.id,operationId:null,closed:false}};let result:CoreResult;try{result=await core.retryDraftSync();}catch(error){result=internalFailure(error);}latestCoreState=core.getState();presentation=closePresentation(presentation);if(result.ok){appendLocal('system','Draft 同步已恢复。');presentedSession={...session,status:'ready',error:null};}else{appendLocal('error',result.error.message);presentedSession={...session,status:latestCoreState.session?.status??'failed',error:result.error};}emit();}

  async function requestSessionCancel(sessionId: string): Promise<void> {
    if (pendingSessionCancel || presentedSession?.id !== sessionId) return;
    pendingSessionCancel = { sessionId };
    if (activeSendRequest?.sessionId === sessionId) activeSendRequest.cancelRequested = true;
    presentedSession = { ...presentedSession, status: 'cancelling' };
    emit();
    let result: CoreResult;
    try { result = await core.cancel(); }
    catch (error) { result = internalFailure(error); }
    latestCoreState = core.getState();
    if (presentedSession?.id !== sessionId || pendingSessionCancel?.sessionId !== sessionId) return;
    pendingSessionCancel = null;
    if (latestCoreState.session === null) {
      activeSendRequest = null; discardTranscript(); presentedSession = null;
      page = { kind: 'hub', mode: 'status', busy: null }; hubMode = 'status';
      recent = result.ok
        ? { kind: 'cancelled', label: '会话已取消', detail: null }
        : { kind: 'failed', label: '取消会话失败', detail: result.error.message };
    } else if (!result.ok && latestCoreState.session.id === sessionId) {
      if (activeSendRequest?.sessionId === sessionId) activeSendRequest.cancelRequested = false;
      presentedSession = { ...presentedSession, status: latestCoreState.session.status, error: result.error };
      appendLocal('error', result.error.message);
    } else if (result.ok) {
      activeSendRequest = null; presentation = closePresentation(presentation);
      presentedSession = { ...presentedSession, status: latestCoreState.session.status, error: null };
      recent = { kind: 'cancelled', label: '当前操作已取消', detail: null };
    }
    emit();
  }

  function dismissFailedPresentation(): void {
    discardTranscript(); presentedSession = null; page = { kind: 'hub', mode: 'status', busy: null }; hubMode = 'status';
  }

  function sessionControls(): TuiSessionControls {
    if (!presentedSession) return { input: false, submit: false,retry:false, cancel: false, dismiss: false };
    if (presentedSession.status === 'failed') return { input: false, submit: false,retry:false, cancel: false, dismiss: true };
    if (presentedSession.status === 'cancelling') return { input: false, submit: false,retry:false, cancel: false, dismiss: false };
    if (presentedSession.status === 'submitting') return { input: false, submit: false,retry:false, cancel: latestCoreState.capabilities.cancel, dismiss: false };
    if (presentedSession.status === 'running') return { input: false, submit: false,retry:false, cancel: latestCoreState.capabilities.cancel, dismiss: false };
    return {
      input: latestCoreState.capabilities.send,
      submit: latestCoreState.capabilities.submit,
      retry:latestCoreState.capabilities.retryDraftSync,
      cancel: latestCoreState.capabilities.cancel,
      dismiss: false,
    };
  }

  function appendLocal(role: TuiMessage['role'], text: string): void {
    const message: TuiMessage = { id: messageId(role), role, text: normalize(text), status: 'complete' };
    messages.push(message); presentation = { ...presentation, items: [...presentation.items, message] };
    enforceTranscriptLimits();
  }
  function messageId(role: string): string { return `tui:${role}:${nextMessageId++}`; }
  function discardTranscript(): void { messages = []; presentation = { items: [], operation: null }; activeSendRequest = null; }
  function enforceTranscriptLimits(): void {
    const textChars = () => messages.reduce((total, message) => total + message.text.length, 0);
    while (messages.length > MAX_MESSAGES || textChars() > MAX_TEXT_CHARS) {
      const removable = messages.findIndex((message, index) => message.status !== 'streaming' && index !== messages.length - 1);
      if (removable < 0) break;
      const [removed] = messages.splice(removable, 1);
      presentation = { ...presentation, items: presentation.items.filter((item) => item.id !== removed?.id) };
    }
  }
  function emit(): void {
    if (disposed) return;
    const state = getState();
    for (const listener of [...listeners]) {
      try { listener(state); }
      catch (error) { diagnostic?.error('driver-listener-error', error); }
    }
  }
}

function projectWorld(state: CoreState, worldRoot: string): TuiWorldView {
  if (state.world.status === 'uninitialized') return { status: 'uninitialized', worldRoot };
  if (state.world.status === 'invalid') return { status: 'invalid', worldRoot, error: state.world.error.message };
  return {
    status: 'published', worldRoot, worldId: state.world.worldId, title: state.world.title,
    revision: state.world.revision, commitId: state.world.commitId, phase: state.world.phase,
    day: state.world.day, lastSettledDay: state.world.lastSettledDay,
  };
}

function callBusiness(core: DayloomCore, actionId: TuiBusinessActionId): Promise<CoreResult> {
  switch (actionId) {
    case 'init': return core.startSession('init');
    case 'daily': return core.startSession('planning');
    case 'revise': return core.startSession('revise');
    case 'play': return core.startSession('play');
    case 'settle': return core.settle();
    case 'abandon-day': return core.abandonDay();
  }
}
function isSessionAction(id: TuiBusinessActionId): boolean { return sessionKindFor(id) !== null; }
function sessionKindFor(id: TuiBusinessActionId): CoreSessionKind | null {
  return ({ init: 'init', daily: 'planning', revise: 'revise', play: 'play', settle: null, 'abandon-day': null })[id] as CoreSessionKind | null;
}
function loadingForAction(id: TuiBusinessActionId): string {
  return ({ init: '正在启动初始化会话...', daily: '正在启动计划会话...', revise: '正在启动修订会话...', play: '正在启动行动会话...', settle: '正在结算当日...', 'abandon-day': '正在放弃当日...' })[id];
}
function openingFor(kind: CoreSessionKind): string {
  return ({ init: '你想从什么样的世界开始？', planning: '今天想怎么展开？可以先说你希望发生什么。', play: '行动会话已开始。你想先做什么？', revise: '你想修订哪些 World 设定？' })[kind];
}
function actionLabel(id: TuiBusinessActionId): string {
  return ({ init: '初始化会话', daily: '计划会话', revise: '修订会话', play: '行动会话', settle: '结算', 'abandon-day': '放弃当日' })[id];
}
function internalFailure(error: unknown): { ok: false; error: CoreError } {
  return { ok: false, error: { code: 'INTERNAL_ERROR', message: error instanceof Error ? error.message : 'Unexpected Core failure.' } };
}
function normalize(text: string): string { return text.replace(/\r\n/g, '\n').replace(/^\n+|\n+$/g, ''); }
function clonePresentationItem(item: TuiPresentationItem): TuiPresentationItem { return { ...item }; }
function isPhaseVisible(visibility: WorkVisibility, phase: 'thought' | 'observe' | 'check'): boolean {
  return visibility === 'all' || visibility === 'thought-observe' && phase !== 'check' || visibility === 'thought' && phase === 'thought';
}
