import path from 'node:path';
import type { DiagnosticLogger } from '@bindtty/terminal';
import {
  createDayloomCore,
  type CoreEvent,
  type CoreResult,
  type CoreState,
  type DayloomCore,
} from '@dayloom/core2';
import { summarizeCoreEvent, summarizeDriverState } from '../diagnostics.js';
import { projectHubActions } from '../hub/actions.js';
import type {
  HubMode,
  TuiDriverState,
  TuiMessage,
  TuiRecentResult,
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

export interface CreateRuntimeDriverOptions {
  worldRoot: string;
  llmConfigPath: string;
  diagnostic?: DiagnosticLogger;
}

interface InternalRuntimeDriverOptions {
  core?: DayloomCore;
  createCore?: typeof createDayloomCore;
}

let nextLocalMessageId = 1;

export async function createRuntimeDriver(
  options: CreateRuntimeDriverOptions,
): Promise<TuiRuntimeDriver> {
  return createRuntimeDriverInternal(options);
}

/** Internal test seam. It is intentionally not re-exported from the package root. */
export async function createRuntimeDriverInternal(
  options: CreateRuntimeDriverOptions,
  internal: InternalRuntimeDriverOptions = {},
): Promise<TuiRuntimeDriver> {
  const resolvedWorldRoot = path.resolve(options.worldRoot);
  const resolvedLlmConfigPath = path.resolve(options.llmConfigPath);
  const core = internal.core ?? await (internal.createCore ?? createDayloomCore)({
    worldRoot: resolvedWorldRoot,
    llmConfigPath: resolvedLlmConfigPath,
  });
  const diagnostic = options.diagnostic;
  const listeners = new Set<(state: TuiDriverState) => void>();
  let latestCoreState = core.getState();
  let hubMode: HubMode = 'status';
  let selectedHubActionId: string | null = null;
  let recent: TuiRecentResult | null = null;
  let messages: TuiMessage[] = [];
  let streamingMessageId: string | null = null;
  let disposed = false;
  let disposePromise: Promise<void> | null = null;

  projectSelection();
  diagnostic?.log('driver-created', {
    worldRoot: resolvedWorldRoot,
    llmConfigPath: resolvedLlmConfigPath,
    sessionId: latestCoreState.session?.id,
  });

  const unsubscribeCore = core.subscribe((event) => {
    if (disposed) return;
    applyCoreEvent(event);
    diagnostic?.log('core-event', {
      ...summarizeCoreEvent(event),
      ...summarizeDriverState(getState()),
    });
    emit();
  });

  return {
    getState,
    subscribe(listener) {
      if (disposed) {
        listener(getState());
        return () => {};
      }
      listeners.add(listener);
      listener(getState());
      return () => listeners.delete(listener);
    },
    async runHubAction(actionId) {
      if (disposed) return 'exit';
      const action = getState().hubActions.find((candidate) => candidate.id === actionId);
      if (!action) return 'continue';
      if (action.kind === 'local') {
        if (action.id === 'quit') return 'exit';
        hubMode = action.id;
        projectSelection();
        emit();
        return 'continue';
      }
      const result = await core.startSession(action.sessionKind);
      if (disposed) return 'exit';
      if (result.ok) {
        recent = null;
        messages = [];
        streamingMessageId = null;
      } else {
        projectFailure(result, '启动会话失败');
      }
      projectSelection();
      emit();
      return 'continue';
    },
    async submitSessionText(text) {
      if (disposed) return;
      const input = text.trim();
      if (input === '') return;
      if (input.startsWith('/')) {
        await handleSlashCommand(input);
        return;
      }
      if (!latestCoreState.capabilities.send) {
        appendLocalMessage('当前会话暂不接受输入。', 'error');
        emit();
        return;
      }
      appendMessage({
        id: localId('user'),
        role: 'user',
        text: input,
        status: 'complete',
      });
      emit();
      const result = await core.send(input);
      if (disposed) return;
      if (result.ok) completeStreamingMessage();
      else {
        failStreamingMessage();
        projectFailure(result, '发送失败');
      }
      projectSelection();
      emit();
    },
    setHubMode(mode) {
      if (disposed) return;
      hubMode = mode;
      projectSelection();
      emit();
    },
    selectHubAction(actionId) {
      if (disposed) return;
      if (!getState().hubActions.some((action) => action.id === actionId)) return;
      selectedHubActionId = actionId;
      emit();
    },
    async dispose() {
      if (disposePromise) return disposePromise;
      disposed = true;
      unsubscribeCore();
      listeners.clear();
      streamingMessageId = null;
      disposePromise = core.dispose();
      await disposePromise;
    },
  };

  function getState(): TuiDriverState {
    const session = latestCoreState.session;
    const projected = projectHubActions(
      latestCoreState.capabilities.startSessions,
      selectedHubActionId,
    );
    return {
      page: session
        ? { kind: 'session', sessionId: session.id, sessionKind: 'play' }
        : { kind: 'hub', mode: hubMode },
      world: { worldRoot: resolvedWorldRoot, ...latestCoreState.world },
      session: session ? { ...session } : null,
      sessionControls: {
        input: latestCoreState.capabilities.send,
        submit: latestCoreState.capabilities.submit,
        cancel: latestCoreState.capabilities.cancel,
      },
      hubActions: projected.actions,
      selectedHubActionId: projected.selectedId,
      recent: recent ? { ...recent } : null,
      messages: messages.map((message) => ({ ...message })),
    };
  }

  function applyCoreEvent(event: CoreEvent): void {
    if (event.type === 'state.changed') {
      const previousSession = latestCoreState.session;
      latestCoreState = event.state;
      if (!previousSession && latestCoreState.session) {
        messages = [];
        streamingMessageId = null;
      }
      if (previousSession && !latestCoreState.session) hubMode = 'status';
      projectSelection();
      return;
    }
    if (event.sessionId !== latestCoreState.session?.id) {
      diagnostic?.log('core-delta-ignored', {
        eventSessionId: event.sessionId,
        activeSessionId: latestCoreState.session?.id,
      });
      return;
    }
    let streaming = streamingMessageId
      ? messages.find((message) => message.id === streamingMessageId)
      : undefined;
    if (!streaming) {
      streaming = {
        id: localId('assistant'),
        role: 'assistant',
        text: '',
        status: 'streaming',
      };
      streamingMessageId = streaming.id;
      appendMessage(streaming);
    }
    streaming.text += event.text;
  }

  async function handleSlashCommand(input: string): Promise<void> {
    const [token] = input.split(/\s+/, 1);
    switch (token!.toLowerCase()) {
      case '/submit':
        if (!latestCoreState.capabilities.submit) {
          appendLocalMessage('当前会话暂不可提交。', 'error');
          emit();
          return;
        }
        await runSessionMutation(() => core.submit(), '会话已提交', '提交失败', 'completed');
        return;
      case '/exit':
      case '/cancel':
        if (!latestCoreState.capabilities.cancel) {
          appendLocalMessage('当前会话暂不可取消。', 'error');
          emit();
          return;
        }
        await runSessionMutation(() => core.cancel(), '会话已取消', '取消失败', 'cancelled');
        return;
      case '/status':
        appendLocalMessage('当前正在 Session 中，请先输入 /exit 回到 Hub 再查看状态。');
        break;
      case '/help':
        appendLocalMessage('当前正在 Session 中，请先输入 /exit 回到 Hub 再查看帮助。');
        break;
      case '/next':
        appendLocalMessage('TUI 不提供 /next，请回到 Hub 选择具体流程。');
        break;
      case '/revise':
        appendLocalMessage('Core2 当前只提供 Play，请先回到 Hub。');
        break;
      default:
        appendLocalMessage(`未知指令：${token}`);
    }
    emit();
  }

  async function runSessionMutation(
    operation: () => Promise<CoreResult>,
    successLabel: string,
    failureLabel: string,
    successKind: 'completed' | 'cancelled',
  ): Promise<void> {
    const result = await operation();
    if (disposed) return;
    if (result.ok) {
      recent = { kind: successKind, label: successLabel, detail: null };
    } else {
      projectFailure(result, failureLabel);
    }
    projectSelection();
    emit();
  }

  function projectFailure(result: Extract<CoreResult, { ok: false }>, label: string): void {
    if (latestCoreState.session) appendLocalMessage(result.error.message, 'error');
    else recent = { kind: 'failed', label, detail: result.error.message };
  }

  function appendLocalMessage(text: string, status: 'complete' | 'error' = 'complete'): void {
    appendMessage({ id: localId('system'), role: 'system', text, status });
  }

  function appendMessage(message: TuiMessage): void {
    messages = [...messages, message];
  }

  function completeStreamingMessage(): void {
    const streaming = messages.find((message) => message.id === streamingMessageId);
    if (streaming) streaming.status = 'complete';
    streamingMessageId = null;
  }

  function failStreamingMessage(): void {
    const streaming = messages.find((message) => message.id === streamingMessageId);
    if (streaming) streaming.status = 'error';
    streamingMessageId = null;
  }

  function projectSelection(): void {
    selectedHubActionId = projectHubActions(
      latestCoreState.capabilities.startSessions,
      selectedHubActionId,
    ).selectedId;
  }

  function emit(): void {
    if (disposed) return;
    const state = getState();
    for (const listener of listeners) listener(state);
  }
}

function localId(kind: string): string {
  return `local:${kind}:${nextLocalMessageId++}`;
}
