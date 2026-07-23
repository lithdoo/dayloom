import { createRuntimeError, isAbortError, toRuntimeError } from '../errors';
import { noopCoreLogger, type CoreLogger } from '../infrastructure/logger';
import { validateSessionSubmission } from '../schemas/validators';
import { isSessionSubmittable } from '../session-status';
import type {
  RuntimeError,
  RuntimeInput,
  RuntimeSession,
  SessionContext,
  SessionEvent,
  SessionKind,
  SessionSnapshot,
  SessionSubmitResult,
  SessionWorkspace,
  WorldSnapshot,
} from '../types';
import { emptySessionSnapshot } from '../types';

/** SessionManager 发出的管理事件。 */
export type SessionManagerEvent =
  | { type: 'session-created'; sessionId: string; kind: SessionKind }
  | { type: 'session-ended'; sessionId: string; status: 'completed' | 'cancelled' }
  | { type: 'session-event'; sessionId: string; event: SessionEvent };

/** Session 工厂收到的创建参数。 */
export interface SessionFactoryArgs {
  kind: SessionKind;
  context: SessionContext;
}

/** 创建具体 RuntimeSession 的工厂。 */
export type SessionFactory = (args: SessionFactoryArgs) => RuntimeSession;

/** SessionManager 配置。 */
export interface SessionManagerOptions {
  sessionFactory: SessionFactory;
  logger?: CoreLogger;
  onEvent?: (event: SessionManagerEvent) => void;
}

/** 准备 Session 所需、但不包含事件权限的上下文。 */
export interface SessionPreparationContext {
  sessionId: string;
  world: Readonly<WorldSnapshot>;
  workspace: SessionWorkspace;
}

/** 尚未对外可见的候选 Session。 */
export interface PreparedSession {
  readonly session: RuntimeSession;
  readonly bufferedEvents: readonly SessionEvent[];
}

/** active Session 已准备、但尚未正式发布的 submission。 */
export interface PreparedSubmission {
  readonly sessionId: string;
  readonly result: SessionSubmitResult;
}

interface InternalPreparedSession extends PreparedSession {
  state: 'prepared' | 'activated' | 'discarded';
  events: SessionEvent[];
}

/** 管理当前进程内 active RuntimeSession 的生命周期。 */
export class SessionManager {
  private readonly sessionFactory: SessionFactory;
  private readonly logger: CoreLogger;
  private readonly listeners = new Set<(event: SessionManagerEvent) => void>();
  private activeSession: RuntimeSession | null = null;
  private activeTask: Promise<void> | null = null;
  private activeAbortController: AbortController | null = null;
  private disposed = false;

  constructor(options: SessionManagerOptions) {
    this.sessionFactory = options.sessionFactory;
    this.logger = options.logger ?? noopCoreLogger;
    if (options.onEvent) this.listeners.add(options.onEvent);
  }

  /** 订阅 SessionManagerEvent；重复 unsubscribe 安全。 */
  subscribe(listener: (event: SessionManagerEvent) => void): () => void {
    this.listeners.add(listener);
    let subscribed = true;
    return () => {
      if (!subscribed) return;
      subscribed = false;
      this.listeners.delete(listener);
    };
  }

  /** 读取 active Session 快照。 */
  getSnapshot(): SessionSnapshot {
    return this.activeSession?.getSnapshot() ?? { ...emptySessionSnapshot };
  }

  /** 读取当前 active Session。 */
  getActiveSession(): RuntimeSession | null {
    return this.activeSession;
  }

  /** 构造并启动候选 Session，启动事件只进入候选缓冲区。 */
  async prepareSession(
    kind: SessionKind,
    preparation: SessionPreparationContext,
  ): Promise<PreparedSession> {
    this.assertOpen();
    if (this.activeSession) {
      throw createRuntimeError('SESSION_ALREADY_ACTIVE', 'A session is already active.');
    }

    const events: SessionEvent[] = [];
    let candidate: InternalPreparedSession | null = null;
    const context: SessionContext = {
      sessionId: preparation.sessionId,
      world: Object.freeze({ ...preparation.world }),
      workspace: preparation.workspace,
      emit: (event) => {
        if (candidate?.state === 'activated') {
          this.handleSessionEvent(candidate.session.id, event);
        } else if (candidate?.state !== 'discarded') {
          events.push(event);
        }
      },
    };
    const session = this.sessionFactory({ kind, context });
    if (session.id !== preparation.sessionId) {
      await this.disposeCandidate(session);
      throw createRuntimeError(
        'SESSION_FAILED',
        'Session id must match SessionContext.sessionId.',
        { expected: preparation.sessionId, actual: session.id },
      );
    }
    if (session.kind !== kind) {
      await this.disposeCandidate(session);
      throw createRuntimeError('SESSION_KIND_MISMATCH', 'Session factory returned the wrong kind.');
    }

    const prepared: InternalPreparedSession = {
      session,
      events,
      get bufferedEvents() {
        return [...events];
      },
      state: 'prepared',
    };
    candidate = prepared;
    try {
      await session.start();
      return prepared;
    } catch (error) {
      prepared.state = 'discarded';
      await this.disposeCandidate(session);
      throw toRuntimeError(error);
    }
  }

  /** 原子激活候选 Session并按顺序发布启动事件。 */
  activateSession(prepared: PreparedSession): void {
    this.assertOpen();
    const candidate = this.requirePrepared(prepared);
    if (this.activeSession) {
      throw createRuntimeError('SESSION_ALREADY_ACTIVE', 'A session is already active.');
    }

    candidate.state = 'activated';
    this.activeSession = candidate.session;
    this.emit({
      type: 'session-created',
      sessionId: candidate.session.id,
      kind: candidate.session.kind,
    });
    for (const event of candidate.events) {
      this.handleSessionEvent(candidate.session.id, event);
    }
    candidate.events.length = 0;
  }

  /** 丢弃候选 Session，不发布其缓冲事件。 */
  async discardPreparedSession(prepared: PreparedSession): Promise<void> {
    const candidate = this.requirePrepared(prepared);
    candidate.state = 'discarded';
    candidate.events.length = 0;
    await this.disposeCandidate(candidate.session);
  }

  /** 向 active Session 启动一个后台输入任务并立即返回。 */
  sendInput(input: RuntimeInput): void {
    this.assertOpen();
    const session = this.requireActiveSession();
    if (this.activeTask) {
      throw createRuntimeError('RUNTIME_BUSY', 'A Session input task is already running.');
    }
    const snapshot = session.getSnapshot();
    if (snapshot.status !== 'waiting-input') {
      throw createRuntimeError('INPUT_NOT_EXPECTED', 'Active session is not waiting for input.', {
        status: snapshot.status,
      });
    }

    const abortController = new AbortController();
    this.activeAbortController = abortController;
    try {
      const task = Promise.resolve(session.sendInput(input, abortController.signal));
      const tracked = task
        .catch((error) => this.handleBackgroundFailure(session, error))
        .finally(() => {
          if (this.activeTask === tracked) {
            this.activeTask = null;
            this.activeAbortController = null;
          }
        });
      this.activeTask = tracked;
    } catch (error) {
      this.activeAbortController = null;
      throw toRuntimeError(error, 'INPUT_NOT_EXPECTED');
    }
  }

  /** 构建 submission，Session 保持 active/submitting。 */
  async prepareSubmit(): Promise<PreparedSubmission> {
    this.assertOpen();
    const session = this.requireActiveSession();
    if (this.activeTask) {
      throw createRuntimeError('RUNTIME_BUSY', 'Cannot submit while a Session input task is running.');
    }
    const snapshot = session.getSnapshot();
    if (!isSessionSubmittable(snapshot.status)) {
      throw createRuntimeError('COMMAND_NOT_AVAILABLE', 'Active session is not ready to submit.', {
        status: snapshot.status,
      });
    }

    try {
      const result = validateSessionSubmission(await session.prepareSubmit());
      if (result.kind !== session.kind) {
        throw createRuntimeError('SESSION_KIND_MISMATCH', 'Submission kind does not match active Session.');
      }
      return { sessionId: session.id, result };
    } catch (error) {
      const runtimeError = toRuntimeError(error, 'SUBMISSION_INVALID');
      await this.notifySubmitFailure(session, runtimeError);
      throw runtimeError;
    }
  }

  /** Archive 发布成功后完成 Session；清理错误只记录诊断。 */
  async completeSubmit(prepared: PreparedSubmission): Promise<void> {
    const session = this.requirePreparedSubmission(prepared);
    try {
      await session.completeSubmit();
    } catch (error) {
      this.logger.error('Session completeSubmit failed after publication.', error, {
        sessionId: session.id,
      });
    }
    this.emit({ type: 'session-ended', sessionId: session.id, status: 'completed' });
    this.clearActiveSession();
    await this.disposeCompletedSession(session);
  }

  /** Submit 发布失败后保留 active Session 并通知其恢复。 */
  async failSubmit(prepared: PreparedSubmission, error: RuntimeError): Promise<void> {
    const session = this.requirePreparedSubmission(prepared);
    await this.notifySubmitFailure(session, error);
  }

  /** 中断并等待输入任务，之后 Session 可由 Runtime 发布 cancel 边界。 */
  async prepareCancel(): Promise<RuntimeSession> {
    this.assertOpen();
    const session = this.requireActiveSession();
    const snapshot = session.getSnapshot();
    if (snapshot.status === 'submitting' || snapshot.status === 'completed' || snapshot.status === 'cancelled') {
      throw createRuntimeError('COMMAND_NOT_AVAILABLE', 'Active session cannot be cancelled.', {
        status: snapshot.status,
      });
    }
    await this.abortAndWaitForBackgroundTask();
    return session;
  }

  /** Runtime 已发布 cancel 边界后结束并释放 Session。 */
  async completeCancel(session: RuntimeSession): Promise<void> {
    if (this.activeSession !== session) {
      throw createRuntimeError('SESSION_NOT_ACTIVE', 'Cancel target is not the active Session.');
    }
    try {
      await session.cancel();
    } catch (error) {
      this.logger.error('Session cancel cleanup failed after publication.', error, {
        sessionId: session.id,
      });
    }
    this.emit({ type: 'session-ended', sessionId: session.id, status: 'cancelled' });
    this.clearActiveSession();
    await this.disposeCompletedSession(session);
  }

  /** 无 archive 编排场景使用的完整 cancel 辅助方法。 */
  async cancel(): Promise<void> {
    const session = await this.prepareCancel();
    await this.completeCancel(session);
  }

  /** 幂等释放 active Session 和全部后台任务。 */
  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    await this.abortAndWaitForBackgroundTask();
    const session = this.activeSession;
    this.clearActiveSession();
    if (session) await this.disposeCompletedSession(session);
    this.listeners.clear();
  }

  private requirePrepared(prepared: PreparedSession): InternalPreparedSession {
    const candidate = prepared as InternalPreparedSession;
    if (candidate.state !== 'prepared' || !Array.isArray(candidate.events)) {
      throw createRuntimeError('SESSION_FAILED', 'Prepared Session is no longer available.');
    }
    return candidate;
  }

  private requirePreparedSubmission(prepared: PreparedSubmission): RuntimeSession {
    const session = this.requireActiveSession();
    if (session.id !== prepared.sessionId) {
      throw createRuntimeError('SESSION_NOT_ACTIVE', 'Prepared submission does not belong to active Session.');
    }
    return session;
  }

  private requireActiveSession(): RuntimeSession {
    if (!this.activeSession) {
      throw createRuntimeError('SESSION_NOT_ACTIVE', 'No active session.');
    }
    return this.activeSession;
  }

  private assertOpen(): void {
    if (this.disposed) throw createRuntimeError('RUNTIME_CLOSED', 'SessionManager is disposed.');
  }

  private handleSessionEvent(sessionId: string, event: SessionEvent): void {
    if (this.activeSession?.id !== sessionId) return;
    this.emit({ type: 'session-event', sessionId, event });
  }

  private async handleBackgroundFailure(session: RuntimeSession, error: unknown): Promise<void> {
    if (isAbortError(error)) return;
    const runtimeError = toRuntimeError(error);
    this.handleSessionEvent(session.id, {
      type: 'message-added',
      message: {
        id: `${session.id}:task-error`,
        role: 'error',
        text: runtimeError.message,
        status: 'error',
      },
    });
    this.handleSessionEvent(session.id, { type: 'status-changed', status: 'failed' });
  }

  private async notifySubmitFailure(session: RuntimeSession, error: RuntimeError): Promise<void> {
    try {
      await session.failSubmit(error);
    } catch (failureError) {
      this.logger.error('Session failSubmit handler failed.', failureError, {
        sessionId: session.id,
        errorCode: error.code,
      });
    }
  }

  private async abortAndWaitForBackgroundTask(): Promise<void> {
    const task = this.activeTask;
    if (!task) return;
    this.activeAbortController?.abort();
    await task;
  }

  private clearActiveSession(): void {
    this.activeSession = null;
    this.activeAbortController = null;
    this.activeTask = null;
  }

  private async disposeCandidate(session: RuntimeSession): Promise<void> {
    try {
      await session.dispose();
    } catch (error) {
      this.logger.error('Prepared Session disposal failed.', error, { sessionId: session.id });
    }
  }

  private async disposeCompletedSession(session: RuntimeSession): Promise<void> {
    try {
      await session.dispose();
    } catch (error) {
      this.logger.error('Session disposal failed.', error, { sessionId: session.id });
    }
  }

  private emit(event: SessionManagerEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch (error) {
        this.logger.error('SessionManager listener failed.', error, { eventType: event.type });
      }
    }
  }
}
