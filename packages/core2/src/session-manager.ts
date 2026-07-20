import { createRuntimeError, isAbortError, toRuntimeError } from './errors';
import type {
  RuntimeInput,
  RuntimeSession,
  SessionContext,
  SessionEvent,
  SessionKind,
  SessionSnapshot,
  SessionSubmitResult,
} from './types';
import { emptySessionSnapshot } from './types';

/** SessionManager 发出的管理事件。 */
export type SessionManagerEvent =
  /** active Session 已创建。 */
  | { type: 'session-created'; sessionId: string; kind: SessionKind }
  /** active Session 结束。 */
  | { type: 'session-ended'; sessionId: string; status: 'completed' | 'cancelled' }
  /** active Session 发出的窄化 SessionEvent。 */
  | { type: 'session-event'; sessionId: string; event: SessionEvent };

/** Session 工厂收到的创建参数。 */
export interface SessionFactoryArgs {
  /** 将要创建的 Session 类型。 */
  kind: SessionKind;

  /** Session 可使用的上下文。 */
  context: SessionContext;
}

/** 创建具体 RuntimeSession 的工厂。 */
export type SessionFactory = (args: SessionFactoryArgs) => RuntimeSession;

/** SessionManager 配置。 */
export interface SessionManagerOptions {
  /** 当前 world 根目录。 */
  worldRoot: string;

  /** 当前 day id；world 尚未初始化时为 null。 */
  day?: string | null;

  /** 创建 RuntimeSession 的工厂。 */
  sessionFactory: SessionFactory;

  /** 可选事件监听器。 */
  onEvent?: (event: SessionManagerEvent) => void;
}

/** 管理当前进程内 active RuntimeSession 的生命周期。 */
export class SessionManager {
  private readonly worldRoot: string;
  private readonly sessionFactory: SessionFactory;
  private readonly listeners = new Set<(event: SessionManagerEvent) => void>();
  private activeSession: RuntimeSession | null = null;
  private activeAbortController: AbortController | null = null;
  private day: string | null;

  constructor(options: SessionManagerOptions) {
    this.worldRoot = options.worldRoot;
    this.day = options.day ?? null;
    this.sessionFactory = options.sessionFactory;
    if (options.onEvent) {
      this.listeners.add(options.onEvent);
    }
  }

  /** 订阅 SessionManagerEvent。 */
  subscribe(listener: (event: SessionManagerEvent) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** 更新当前 day，供后续创建 Session 时使用。 */
  setDay(day: string | null): void {
    this.day = day;
  }

  /** 读取 active Session 快照；没有 active Session 时返回 none 快照。 */
  getSnapshot(): SessionSnapshot {
    return this.activeSession?.getSnapshot() ?? { ...emptySessionSnapshot };
  }

  /** 读取当前 active Session；主要供 Runtime 内部测试与整合使用。 */
  getActiveSession(): RuntimeSession | null {
    return this.activeSession;
  }

  /** 创建并启动新的 active Session。 */
  async createSession(kind: SessionKind): Promise<RuntimeSession> {
    if (this.activeSession) {
      throw createRuntimeError('SESSION_ALREADY_ACTIVE', 'A session is already active.');
    }

    let session: RuntimeSession | null = null;
    const context: SessionContext = {
      worldRoot: this.worldRoot,
      day: this.day,
      emit: (event) => {
        if (session) {
          this.handleSessionEvent(session.id, event);
        }
      },
    };
    session = this.sessionFactory({ kind, context });
    this.activeSession = session;
    this.emit({ type: 'session-created', sessionId: session.id, kind: session.kind });

    try {
      await session.start();
      return session;
    } catch (error) {
      const runtimeError = toRuntimeError(error);
      this.handleSessionEvent(session.id, {
        type: 'status-changed',
        status: 'failed',
      });
      this.handleSessionEvent(session.id, {
        type: 'message-added',
        message: {
          id: `${session.id}:start-error`,
          role: 'error',
          text: runtimeError.message,
          status: 'error',
        },
      });
      throw runtimeError;
    }
  }

  /** 向 active Session 转发自然语言输入，并启动可取消后台任务。 */
  sendInput(input: RuntimeInput): void {
    const session = this.requireActiveSession();
    const snapshot = session.getSnapshot();
    if (snapshot.status !== 'waiting-input') {
      throw createRuntimeError('INPUT_NOT_EXPECTED', 'Active session is not waiting for input.', {
        status: snapshot.status,
      });
    }

    this.abortBackgroundTask();
    const abortController = new AbortController();
    this.activeAbortController = abortController;

    try {
      const task = session.sendInput(input, abortController.signal);
      void task.catch((error) => {
        if (isAbortError(error)) {
          return;
        }
        const runtimeError = toRuntimeError(error);
        this.handleSessionEvent(session.id, {
          type: 'message-added',
          message: {
            id: `${session.id}:task-error:${Date.now()}`,
            role: 'error',
            text: runtimeError.message,
            status: 'error',
          },
        });
        this.handleSessionEvent(session.id, {
          type: 'status-changed',
          status: 'failed',
        });
      });
    } catch (error) {
      this.activeAbortController = null;
      throw toRuntimeError(error);
    }
  }

  /** 提交 active Session 的产物。 */
  async submit(): Promise<SessionSubmitResult> {
    const session = this.requireActiveSession();
    const snapshot = session.getSnapshot();
    if (snapshot.status !== 'ready-to-submit') {
      throw createRuntimeError('COMMAND_NOT_AVAILABLE', 'Active session is not ready to submit.', {
        status: snapshot.status,
      });
    }

    const result = await session.submit();
    this.emit({ type: 'session-ended', sessionId: session.id, status: 'completed' });
    this.clearActiveSession();
    return result;
  }

  /** 取消 active Session，并中断后台任务。 */
  async cancel(): Promise<void> {
    const session = this.requireActiveSession();
    const snapshot = session.getSnapshot();
    if (snapshot.status === 'submitting' || snapshot.status === 'completed' || snapshot.status === 'cancelled') {
      throw createRuntimeError('COMMAND_NOT_AVAILABLE', 'Active session cannot be cancelled.', {
        status: snapshot.status,
      });
    }

    this.abortBackgroundTask();
    await session.cancel();
    this.emit({ type: 'session-ended', sessionId: session.id, status: 'cancelled' });
    this.clearActiveSession();
  }

  /** 释放 active Session 与后台任务。 */
  async dispose(): Promise<void> {
    const session = this.activeSession;
    this.abortBackgroundTask();
    if (session) {
      await session.dispose();
    }
    this.clearActiveSession();
  }

  private requireActiveSession(): RuntimeSession {
    if (!this.activeSession) {
      throw createRuntimeError('SESSION_NOT_ACTIVE', 'No active session.');
    }
    return this.activeSession;
  }

  private handleSessionEvent(sessionId: string, event: SessionEvent): void {
    if (!this.activeSession || this.activeSession.id !== sessionId) {
      return;
    }
    this.emit({ type: 'session-event', sessionId, event });
  }

  private abortBackgroundTask(): void {
    if (!this.activeAbortController) {
      return;
    }
    this.activeAbortController.abort();
    this.activeAbortController = null;
  }

  private clearActiveSession(): void {
    this.activeSession = null;
    this.activeAbortController = null;
  }

  private emit(event: SessionManagerEvent): void {
    for (const listener of this.listeners) {
      listener(event);
    }
  }
}
