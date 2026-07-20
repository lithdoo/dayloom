import { createRuntimeError, toRuntimeError } from './errors';
import { getCommandAvailability, getSingleCommandAvailability } from './commands';
import { SessionManager, type SessionFactory, type SessionManagerEvent } from './session-manager';
import {
  transitionSessionCancel,
  transitionSessionSubmit,
  transitionWorldCommand,
} from './transitions';
import { WorldStore } from './world-store';
import type {
  CommandAvailability,
  DayloomRuntime,
  OperationId,
  RuntimeCommandRequest,
  RuntimeEvent,
  RuntimeEventListener,
  RuntimeInput,
  RuntimeResult,
  RuntimeSnapshot,
  RuntimeUnsubscribe,
  SessionEvent,
  WorldSnapshot,
} from './types';

let nextOperationId = 1;

/** Core2Runtime 配置。 */
export interface Core2RuntimeOptions {
  /** 当前 world 根目录。 */
  worldRoot: string;

  /** 当前 day id；world 尚未初始化时为 null。 */
  day?: string | null;

  /** 创建 RuntimeSession 的工厂。 */
  sessionFactory: SessionFactory;

  /** 初始 world 快照；不传时使用 uninitialized 占位快照。 */
  world?: Partial<WorldSnapshot>;
}

/** Runtime 会话外壳：连接 SessionManager、事件订阅与输入通道。 */
export class Core2Runtime implements DayloomRuntime {
  private readonly listeners = new Set<RuntimeEventListener>();
  private readonly sessionManager: SessionManager;
  private readonly worldStore: WorldStore;
  private world: WorldSnapshot;
  private mutationActive = false;
  private disposed = false;
  private deferredSessionEnded: Extract<RuntimeEvent, { type: 'session-ended' }>[] = [];

  constructor(options: Core2RuntimeOptions) {
    this.worldStore = new WorldStore(options.worldRoot);
    this.world = {
      ...this.worldStore.readSnapshot(),
      ...(options.day !== undefined ? { day: options.day } : {}),
      ...options.world,
    };
    this.sessionManager = new SessionManager({
      worldRoot: this.world.worldRoot,
      day: this.world.day,
      sessionFactory: options.sessionFactory,
      onEvent: (event) => this.handleSessionManagerEvent(event),
    });
  }

  getSnapshot(): RuntimeSnapshot {
    return {
      world: { ...this.world },
      session: this.sessionManager.getSnapshot(),
    };
  }

  getAvailableCommands(): CommandAvailability[] {
    return getCommandAvailability(this.world, this.sessionManager.getSnapshot());
  }

  async sendInput(input: RuntimeInput): Promise<RuntimeResult> {
    const operationId = input.operationId ?? createOperationId();
    try {
      return await this.runMutation(async () => {
        const sessionId = this.sessionManager.getSnapshot().id;
        if (!sessionId) {
          const error = createRuntimeError('INPUT_NOT_EXPECTED', 'No active session.');
          this.emit({ type: 'input-failed', operationId, sessionId: null, error });
          return { operationId, ok: false, error };
        }

        this.emit({ type: 'input-started', operationId, sessionId });
        try {
          this.sessionManager.sendInput({ ...input, operationId });
          this.emit({ type: 'input-succeeded', operationId, sessionId });
          return { operationId, ok: true };
        } catch (error) {
          const runtimeError = toRuntimeError(error, 'INPUT_NOT_EXPECTED');
          this.emit({ type: 'input-failed', operationId, sessionId, error: runtimeError });
          return { operationId, ok: false, error: runtimeError };
        }
      });
    } catch (error) {
      const runtimeError = toRuntimeError(error);
      this.emit({ type: 'input-failed', operationId, sessionId: null, error: runtimeError });
      return { operationId, ok: false, error: runtimeError };
    }
  }

  async executeCommand(request: RuntimeCommandRequest): Promise<RuntimeResult> {
    const operationId = request.operationId ?? createOperationId();
    try {
      return await this.runMutation(async () => {
        try {
          const availability = getSingleCommandAvailability(
            this.world,
            this.sessionManager.getSnapshot(),
            request.command,
          );
          if (!availability.enabled) {
            const error = createRuntimeError(
              this.world.phase === 'invalid' ? 'WORLD_INVALID' : 'COMMAND_NOT_AVAILABLE',
              availability.reason ?? 'Command is not available.',
            );
            this.emit({
              type: 'command-rejected',
              operationId,
              command: request.command,
              reason: error.message,
            });
            return { operationId, ok: false, error };
          }

          this.emit({ type: 'command-started', operationId, command: request.command });
          if (request.command === 'submit') {
            const result = await this.sessionManager.submit();
            const transitioned = transitionSessionSubmit(this.world, result);
            if (!transitioned.ok) {
              this.flushDeferredSessionEnded();
              return this.commandRejected(operationId, request, transitioned.error);
            }
            this.commitWorld(operationId, transitioned.world);
            this.flushDeferredSessionEnded();
            this.emit({ type: 'command-succeeded', operationId, command: request.command });
            return { operationId, ok: true };
          }
          if (request.command === 'cancel') {
            await this.sessionManager.cancel();
            const transitioned = transitionSessionCancel(this.world);
            if (!transitioned.ok) {
              this.flushDeferredSessionEnded();
              return this.commandRejected(operationId, request, transitioned.error);
            }
            this.commitWorld(operationId, transitioned.world);
            this.flushDeferredSessionEnded();
            this.emit({ type: 'command-succeeded', operationId, command: request.command });
            return { operationId, ok: true };
          }

          const transitioned = transitionWorldCommand(
            this.world,
            this.sessionManager.getSnapshot(),
            request.command,
          );
          if (!transitioned.ok) {
            return this.commandRejected(operationId, request, transitioned.error);
          }
          const nextWorld = this.applyWorldOperation(request.command, transitioned.world);
          this.commitWorld(operationId, nextWorld);
          if (transitioned.createSessionKind) {
            await this.sessionManager.createSession(transitioned.createSessionKind);
          }
          this.emit({ type: 'command-succeeded', operationId, command: request.command });
          return { operationId, ok: true };
        } catch (error) {
          const runtimeError = toRuntimeError(error, 'COMMAND_NOT_AVAILABLE');
          if (runtimeError.code === 'COMMAND_NOT_AVAILABLE') {
            this.emit({
              type: 'command-rejected',
              operationId,
              command: request.command,
              reason: runtimeError.message,
            });
          } else {
            this.emit({
              type: 'command-failed',
              operationId,
              command: request.command,
              error: runtimeError,
            });
          }
          return { operationId, ok: false, error: runtimeError };
        }
      });
    } catch (error) {
      const runtimeError = toRuntimeError(error);
      this.emit({
        type: 'command-failed',
        operationId,
        command: request.command,
        error: runtimeError,
      });
      return { operationId, ok: false, error: runtimeError };
    }
  }

  private commandRejected(
    operationId: OperationId,
    request: RuntimeCommandRequest,
    error: ReturnType<typeof createRuntimeError>,
  ): RuntimeResult {
    this.emit({
      type: 'command-rejected',
      operationId,
      command: request.command,
      reason: error.message,
    });
    return { operationId, ok: false, error };
  }

  subscribe(listener: RuntimeEventListener): RuntimeUnsubscribe {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  async dispose(): Promise<void> {
    await this.runMutation(async () => {
      this.disposed = true;
      await this.sessionManager.dispose();
      return undefined;
    });
  }

  private async runMutation<T>(action: () => Promise<T>): Promise<T> {
    if (this.disposed) {
      throw createRuntimeError('RUNTIME_CLOSED', 'Runtime is already disposed.');
    }
    if (this.mutationActive) {
      throw createRuntimeError('RUNTIME_BUSY', 'Runtime is busy.');
    }

    this.mutationActive = true;
    try {
      return await action();
    } finally {
      this.mutationActive = false;
    }
  }

  private handleSessionManagerEvent(event: SessionManagerEvent): void {
    switch (event.type) {
      case 'session-created':
        this.emit({ type: 'session-created', sessionId: event.sessionId, kind: event.kind });
        break;
      case 'session-ended':
        this.deferOrEmitSessionEnded({
          type: 'session-ended',
          sessionId: event.sessionId,
          status: event.status,
        });
        break;
      case 'session-event':
        this.emitSessionEvent(event.sessionId, event.event);
        break;
    }
  }

  private applyWorldOperation(command: RuntimeCommandRequest['command'], nextWorld: WorldSnapshot): WorldSnapshot {
    if (command === 'settle') {
      if (!this.world.day) {
        throw createRuntimeError('OPERATION_FAILED', 'settle requires current day.');
      }
      const { nextDay } = this.worldStore.settleDay(this.world.day);
      return { ...nextWorld, day: nextDay, phase: 'idle', initialized: true };
    }
    if (command === 'abandon-day') {
      if (!this.world.day) {
        throw createRuntimeError('OPERATION_FAILED', 'abandon-day requires current day.');
      }
      const { previousDay } = this.worldStore.abandonDay(this.world.day);
      return { ...nextWorld, day: previousDay, phase: 'idle' };
    }
    return nextWorld;
  }

  private commitWorld(operationId: OperationId, nextWorld: WorldSnapshot): void {
    const previous = { ...this.world };
    this.world = { ...nextWorld };
    this.sessionManager.setDay(this.world.day);
    this.emit({ type: 'world-changed', operationId, previous, current: { ...this.world } });
  }

  private deferOrEmitSessionEnded(event: Extract<RuntimeEvent, { type: 'session-ended' }>): void {
    if (this.mutationActive) {
      this.deferredSessionEnded.push(event);
      return;
    }
    this.emit(event);
  }

  private flushDeferredSessionEnded(): void {
    const events = this.deferredSessionEnded;
    this.deferredSessionEnded = [];
    for (const event of events) {
      this.emit(event);
    }
  }

  private emitSessionEvent(sessionId: string, event: SessionEvent): void {
    switch (event.type) {
      case 'status-changed':
        this.emit({ type: 'session-status-changed', sessionId, status: event.status });
        break;
      case 'message-added':
        this.emit({ type: 'message-added', message: { ...event.message, sessionId } });
        break;
      case 'assistant-message-start':
        this.emit({ type: 'assistant-message-start', sessionId, messageId: event.messageId });
        break;
      case 'assistant-message-delta':
        this.emit({
          type: 'assistant-message-delta',
          sessionId,
          messageId: event.messageId,
          delta: event.delta,
        });
        break;
      case 'assistant-message-end':
        this.emit({ type: 'assistant-message-end', sessionId, messageId: event.messageId });
        break;
      case 'assistant-message-error':
        this.emit({
          type: 'assistant-message-error',
          sessionId,
          messageId: event.messageId,
          error: event.error,
        });
        break;
      case 'input-requested':
        this.emit({ type: 'input-requested', sessionId, request: event.request });
        break;
      case 'input-closed':
        this.emit({ type: 'input-closed', sessionId, requestId: event.requestId });
        break;
      case 'loading-started':
        this.emit({ type: 'loading-started', sessionId, loading: event.loading });
        break;
      case 'loading-updated':
        this.emit({ type: 'loading-updated', sessionId, loading: event.loading });
        break;
      case 'loading-ended':
        this.emit({ type: 'loading-ended', sessionId, loadingId: event.loadingId });
        break;
    }
  }

  private emit(event: RuntimeEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch {
        // Listener errors are intentionally isolated from Runtime state.
      }
    }
  }
}

function createOperationId(): OperationId {
  const operationId = `op-${nextOperationId}`;
  nextOperationId += 1;
  return operationId;
}
