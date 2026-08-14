import {
  MessageStore,
  createArchiveV2Repository,
  createArchiveV2SessionWorldReadModel,
  createDayloomRuntime,
  createNaturalLanguageSessionFactory,
  createPromptpileConversationClient,
  type DayloomRuntime,
  type RuntimeCommand,
  type RuntimeEvent,
  type RuntimeMessage,
  type RuntimeSnapshot,
  type SessionFactory,
} from '@dayloom/core';
import type { DiagnosticLogger } from '@bindtty/terminal';
import { summarizeDriverState, summarizeRuntimeEvent } from '../diagnostics.js';
import { projectHubActions } from '../hub/actions.js';
import type { HubMode, TuiDriverState, TuiHubAction, TuiRecentResult } from '../types.js';

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
  runtime?: DayloomRuntime;
  sessionFactory?: SessionFactory;
  diagnostic?: DiagnosticLogger;
}

let nextLocalMessageId = 1;

export async function createRuntimeDriver(options: CreateRuntimeDriverOptions): Promise<TuiRuntimeDriver> {
  const diagnostic = options.diagnostic;
  const archive = options.runtime ? null : createArchiveV2Repository({ worldRoot: options.worldRoot });
  const runtime = options.runtime ?? await createDayloomRuntime({
    worldRoot: options.worldRoot,
    archiveV2Repository: archive ?? undefined,
    sessionFactory: options.sessionFactory ?? createNaturalLanguageSessionFactory({
      readModel: createArchiveV2SessionWorldReadModel(archive!),
      client: createPromptpileConversationClient(),
    }),
  });
  const messages = new MessageStore({
    maxMessagesPerSession: 500,
    maxTextCharsPerSession: 250_000,
  });
  const listeners = new Set<(state: TuiDriverState) => void>();
  let snapshot = runtime.getSnapshot();
  let commands = runtime.getAvailableCommands();
  let mode: HubMode = 'status';
  let loading = null as TuiDriverState['loading'];
  let recent: TuiRecentResult | null = null;
  let selectedHubActionId: string | null = null;
  let activeSessionId = snapshot.session.id;
  let disposed = false;
  let disposePromise: Promise<void> | null = null;
  let page: TuiDriverState['page'] = activeSessionId && snapshot.session.kind
    ? { kind: 'session', sessionId: activeSessionId, sessionKind: snapshot.session.kind }
    : { kind: 'hub', mode, busy: null };

  diagnostic?.log('driver-created', {
    worldRoot: options.worldRoot,
    suppliedRuntime: options.runtime !== undefined,
    sessionId: snapshot.session.id,
    sessionKind: snapshot.session.kind,
    sessionStatus: snapshot.session.status,
    page: page.kind,
  });

  const unsubscribeRuntime = runtime.subscribe((event) => {
    applyRuntimeEvent(event);
    refreshFromRuntime();
    if (diagnostic?.enabled) {
      diagnostic.log('runtime-event', {
        ...summarizeRuntimeEvent(event),
        ...summarizeDriverState(getState()),
      });
    }
    emit();
  });

  refreshFromRuntime();

  return {
    getState,
    subscribe(listener) {
      if (disposed) {
        listener(getState());
        return () => {};
      }
      listeners.add(listener);
      listener(getState());
      return () => {
        listeners.delete(listener);
      };
    },
    async runHubAction(actionId) {
      if (disposed) return 'exit';
      diagnostic?.log('hub-action', { actionId });
      const action = getState().hubActions.find((candidate) => candidate.id === actionId);
      if (!action) return 'continue';
      if (action.kind === 'local') {
        if (action.id === 'quit') return 'exit';
        mode = action.id;
        page = { kind: 'hub', mode, busy: null };
        emit();
        return 'continue';
      }

      loading = action.command === 'settle' || action.command === 'abandon-day'
        ? { operation: action.command, label: `${action.label}...` }
        : null;
      if (page.kind === 'hub') {
        page = { ...page, busy: loading };
      }
      emit();
      try {
        const result = await runtime.executeCommand({ command: action.command });
        diagnostic?.log('hub-action-result', {
          actionId,
          command: action.command,
          ok: result.ok,
          errorCode: result.error?.code,
        });
        if (!result.ok && recent?.kind !== 'failed') {
          recent = { kind: 'failed', label: '操作失败', detail: result.error?.message ?? null };
        }
      } catch (error) {
        diagnostic?.error('hub-action-error', error, {
          actionId,
          command: action.command,
        });
        recent = {
          kind: 'failed',
          label: '操作失败',
          detail: error instanceof Error ? error.message : String(error),
        };
      } finally {
        loading = null;
        refreshFromRuntime();
        emit();
      }
      return 'continue';
    },
    async submitSessionText(text) {
      if (disposed) return;
      const trimmed = text.trim();
      if (trimmed === '') return;
      diagnostic?.log('session-input-submit', {
        sessionId: snapshot.session.id,
        textLength: trimmed.length,
        slashCommand: trimmed.startsWith('/'),
      });
      if (trimmed.startsWith('/')) {
        await handleSlashCommand(trimmed);
        return;
      }
      const result = await runtime.sendInput({ text: trimmed });
      diagnostic?.log('session-input-result', {
        sessionId: snapshot.session.id,
        ok: result.ok,
        errorCode: result.error?.code,
      });
      if (!result.ok) {
        appendLocalSessionMessage('error', result.error?.message ?? 'Input failed.');
      }
      refreshFromRuntime();
      emit();
    },
    setHubMode(nextMode) {
      if (disposed) return;
      mode = nextMode;
      if (page.kind === 'hub') {
        page = { kind: 'hub', mode, busy: loading };
      }
      refreshFromRuntime();
      emit();
    },
    selectHubAction(actionId) {
      if (disposed) return;
      selectedHubActionId = actionId;
      refreshFromRuntime();
      emit();
    },
    async dispose() {
      if (disposePromise) {
        await disposePromise;
        return;
      }
      disposed = true;
      diagnostic?.log('driver-dispose-begin', summarizeDriverState(getState()));
      unsubscribeRuntime();
      listeners.clear();
      loading = null;
      disposePromise = runtime.dispose();
      await disposePromise;
      diagnostic?.log('driver-dispose-end');
    },
  };

  function getState(): TuiDriverState {
    const sessionId = snapshot.session.id;
    return {
      page,
      snapshot,
      commands,
      hubActions: projectActions().actions,
      selectedHubActionId,
      recent,
      loading,
      messages: sessionId ? messages.getMessages(sessionId) : [],
    };
  }

  function refreshFromRuntime(): void {
    snapshot = runtime.getSnapshot();
    commands = runtime.getAvailableCommands();
    const previousSessionId = activeSessionId;
    activeSessionId = snapshot.session.id;
    const projected = projectActions();
    selectedHubActionId = projected.selectedId;

    if (snapshot.session.active && snapshot.session.id && snapshot.session.kind) {
      page = {
        kind: 'session',
        sessionId: snapshot.session.id,
        sessionKind: snapshot.session.kind,
      };
      return;
    }

    if (previousSessionId && !snapshot.session.active && page.kind === 'session') {
      page = { kind: 'hub', mode: 'status', busy: null };
      mode = 'status';
    } else if (page.kind === 'hub') {
      page = { kind: 'hub', mode, busy: loading };
    }
  }

  function projectActions(): { actions: TuiHubAction[]; selectedId: string | null } {
    return projectHubActions(snapshot.world.phase, commands, selectedHubActionId, mode);
  }

  function applyRuntimeEvent(event: RuntimeEvent): void {
    switch (event.type) {
      case 'message-added':
        if (!event.message.sessionId) {
          break;
        }
        messages.applySessionEvent(event.message.sessionId, {
          type: 'message-added',
          message: stripSessionId(event.message),
        });
        break;
      case 'assistant-message-start':
      case 'assistant-message-delta':
      case 'assistant-message-end':
      case 'assistant-message-error':
        messages.applySessionEvent(event.sessionId, event);
        break;
      case 'loading-started':
      case 'loading-updated':
        loading = {
          operation: event.loading.operation,
          label: event.loading.detail ?? event.loading.operation,
        };
        break;
      case 'loading-ended':
        loading = null;
        break;
      case 'command-started':
        if (event.command === 'settle' || event.command === 'abandon-day') {
          loading = { operation: event.command, label: `${event.command}...` };
        }
        break;
      case 'command-succeeded':
        if (event.command === 'settle' || event.command === 'abandon-day') {
          recent = { kind: 'completed', label: `${event.command} 完成`, detail: null };
        }
        loading = null;
        break;
      case 'command-failed':
        recent = { kind: 'failed', label: `${event.command} 失败`, detail: event.error.message };
        loading = null;
        break;
      case 'command-rejected':
        recent = { kind: 'failed', label: `${event.command} 不可用`, detail: event.error.message };
        loading = null;
        break;
      case 'session-ended':
        recent = {
          kind: event.status === 'completed' ? 'completed' : 'cancelled',
          label: event.status === 'completed' ? '会话已提交' : '会话已取消',
          detail: null,
        };
        break;
      default:
        break;
    }
  }

  async function handleSlashCommand(input: string): Promise<void> {
    const [token] = input.split(/\s+/, 1);
    switch (token.toLowerCase()) {
      case '/submit':
        await runSessionCommand('submit');
        return;
      case '/exit':
      case '/cancel':
        await runSessionCommand('cancel');
        return;
      case '/status':
        appendLocalSessionMessage('system', '当前正在 Session 中，请先输入 /exit 回到 Hub 再查看状态。');
        return;
      case '/help':
        appendLocalSessionMessage('system', '当前正在 Session 中，请先输入 /exit 回到 Hub 再查看帮助。');
        return;
      case '/next':
        appendLocalSessionMessage('warn', 'tui 不提供 /next，请回到 Hub 选择具体流程。');
        return;
      case '/revise':
        appendLocalSessionMessage('warn', '请先回到 Hub，再选择修订流程。');
        return;
      default:
        appendLocalSessionMessage('warn', `未知指令：${token}`);
    }
  }

  async function runSessionCommand(command: Extract<RuntimeCommand, 'submit' | 'cancel'>): Promise<void> {
    const result = await runtime.executeCommand({ command });
    if (!result.ok) {
      appendLocalSessionMessage('error', result.error?.message ?? `${command} failed.`);
    }
    refreshFromRuntime();
    emit();
  }

  function appendLocalSessionMessage(role: RuntimeMessage['role'] | 'warn', text: string): void {
    const sessionId = snapshot.session.id;
    if (!sessionId) return;
    const messageId = `local:${nextLocalMessageId++}`;
    messages.applySessionEvent(sessionId, {
      type: 'message-added',
      message: {
        id: messageId,
        role: role === 'warn' ? 'system' : role,
        text,
        status: role === 'error' ? 'error' : 'complete',
      },
    });
    diagnostic?.log('local-message-added', {
      sessionId,
      messageId,
      role,
      textLength: text.length,
    });
  }

  function emit(): void {
    if (disposed) return;
    const state = getState();
    for (const listener of listeners) {
      listener(state);
    }
  }
}

function stripSessionId(message: RuntimeMessage): Omit<RuntimeMessage, 'sessionId'> {
  return {
    id: message.id,
    role: message.role,
    text: message.text,
    status: message.status,
  };
}
