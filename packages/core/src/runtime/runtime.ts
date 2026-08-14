import { closeCommandAvailability } from '../domain/state-machine';
import type { StateMachine } from '../domain/state-machine';
import { createRuntimeError, toRuntimeError } from '../errors';
import type { IdGenerator } from '../infrastructure/ids';
import type { CoreLogger } from '../infrastructure/logger';
import type { RuntimeError } from '../schemas/common';
import {
  SessionManager,
  type PreparedSession,
  type SessionManagerEvent,
} from '../sessions/session-manager';
import type {
  CommandAvailability,
  DayloomRuntime,
  OperationId,
  RuntimeCommand,
  RuntimeCommandRequest,
  RuntimeEventListener,
  RuntimeInput,
  RuntimeResult,
  RuntimeSnapshot,
  RuntimeUnsubscribe,
  SessionEvent,
  SessionSnapshot,
  WorldSnapshot,
} from '../types';
import { RuntimeEventBroadcaster } from './events';
import { RuntimeMutationLock } from './mutation-lock';
import type { RuntimeOperations, SessionStartCommand } from './types';

export interface RuntimeControllerOptions {
  world: WorldSnapshot;
  stateMachine: StateMachine;
  sessionManager: SessionManager;
  operations: RuntimeOperations;
  ids: IdGenerator;
  logger: CoreLogger;
}

/** Archive 驱动的新 Runtime 内核；由异步 factory 完成初始化后构造。 */
export class RuntimeController implements DayloomRuntime {
  private readonly stateMachine: StateMachine;
  private readonly operations: RuntimeOperations;
  private readonly ids: IdGenerator;
  private readonly logger: CoreLogger;
  private readonly sessionManager: SessionManager;
  private readonly events: RuntimeEventBroadcaster;
  private readonly mutation = new RuntimeMutationLock();
  private world: WorldSnapshot;
  private lifecycleOperationId: OperationId | null = null;
  private disposed = false;

  constructor(options: RuntimeControllerOptions) {
    this.world = cloneWorld(options.world);
    this.stateMachine = options.stateMachine;
    this.operations = options.operations;
    this.ids = options.ids;
    this.logger = options.logger;
    this.events = new RuntimeEventBroadcaster(options.logger);
    this.sessionManager = options.sessionManager;
    this.sessionManager.subscribe((event) => this.handleSessionManagerEvent(event));
  }

  getSnapshot(): RuntimeSnapshot {
    return { world: cloneWorld(this.world), session: cloneSession(this.sessionManager.getSnapshot()) };
  }

  getAvailableCommands(): CommandAvailability[] {
    const commands = this.stateMachine.getAvailableCommands({
      world: this.world,
      session: this.sessionManager.getSnapshot(),
    });
    return this.disposed ? closeCommandAvailability(commands) : commands;
  }

  async sendInput(input: RuntimeInput): Promise<RuntimeResult> {
    const operationId = input.operationId ?? this.ids.nextOperationId();
    try {
      return await this.mutation.run(async () => {
        this.assertOpen();
        if (this.world.phase === 'invalid') return this.inputFailure(operationId, this.world.invalid!);
        const sessionId = this.sessionManager.getSnapshot().id;
        if (!sessionId) return this.inputFailure(
          operationId,
          createRuntimeError('INPUT_NOT_EXPECTED', 'No active Session.'),
        );
        this.events.emit({ type: 'input-started', operationId, sessionId });
        try {
          this.sessionManager.sendInput({ ...input, operationId });
          this.events.emit({ type: 'input-succeeded', operationId, sessionId });
          return { operationId, ok: true };
        } catch (error) {
          return this.inputFailure(operationId, toRuntimeError(error, 'INPUT_NOT_EXPECTED'), sessionId);
        }
      });
    } catch (error) {
      return this.inputFailure(operationId, toRuntimeError(error));
    }
  }

  async executeCommand(request: RuntimeCommandRequest): Promise<RuntimeResult> {
    const operationId = request.operationId ?? this.ids.nextOperationId();
    try {
      return await this.mutation.run(async () => {
        this.assertOpen();
        const session = this.sessionManager.getSnapshot();
        const availability = this.stateMachine.getAvailableCommands({ world: this.world, session })
          .find((item) => item.name === request.command)!;
        if (!availability.enabled) {
          const error = availabilityError(availability.reasonCode, availability.reason);
          this.events.emit({ type: 'command-rejected', operationId, command: request.command, error });
          return { operationId, ok: false, error };
        }

        this.events.emit({ type: 'command-started', operationId, command: request.command });
        try {
          if (request.command === 'submit') return await this.submit(operationId, session);
          if (request.command === 'cancel') return await this.cancel(operationId, session);
          if (request.command === 'settle' || request.command === 'abandon-day') {
            return await this.executeStable(operationId, request.command, session);
          }
          return await this.startSession(operationId, request.command, session);
        } catch (error) {
          const runtimeError = toRuntimeError(error, 'OPERATION_FAILED');
          this.events.emit({ type: 'command-failed', operationId, command: request.command, error: runtimeError });
          return { operationId, ok: false, error: runtimeError };
        }
      });
    } catch (error) {
      const runtimeError = toRuntimeError(error);
      this.events.emit({ type: 'command-failed', operationId, command: request.command, error: runtimeError });
      return { operationId, ok: false, error: runtimeError };
    }
  }

  subscribe(listener: RuntimeEventListener): RuntimeUnsubscribe {
    return this.events.subscribe(listener);
  }

  async dispose(): Promise<void> {
    if (this.disposed) return;
    await this.mutation.run(async () => {
      if (this.disposed) return;
      this.disposed = true;
      await this.sessionManager.dispose();
      this.events.clear();
    });
  }

  private async startSession(
    operationId: OperationId,
    command: SessionStartCommand,
    session: SessionSnapshot,
  ): Promise<RuntimeResult> {
    const transition = this.stateMachine.transitionWorld(command, { world: this.world, session });
    if (!transition.ok || !transition.createSession) throw transition.ok
      ? createRuntimeError('OPERATION_FAILED', 'Session command did not select a Session kind.')
      : transition.error;
    const boundary = await this.operations.prepareSessionStart({
      operationId,
      command,
      kind: transition.createSession,
      previous: cloneWorld(this.world),
      target: transition.nextWorld,
    });
    let prepared: PreparedSession | null = null;
    let published = false;
    try {
      const candidate = await this.sessionManager.prepareSession(transition.createSession, {
        sessionId: this.ids.nextSessionId(),
        world: transition.nextWorld,
        workspace: boundary.workspace,
      });
      prepared = candidate;
      const publishedWorld = await boundary.publish();
      published = true;
      this.commitWorld(operationId, publishedWorld);
      this.withLifecycleOperation(operationId, () => this.sessionManager.activateSession(candidate));
    } catch (error) {
      const runtimeError = toRuntimeError(error, 'OPERATION_FAILED');
      if (!published) {
        if (prepared) await this.sessionManager.discardPreparedSession(prepared);
        try {
          await boundary.abort(runtimeError);
        } catch (abortError) {
          this.logger.error('Session boundary abort failed.', abortError, { operationId });
        }
      } else {
        this.logger.error('Session activation failed after archive publication.', error, { operationId });
      }
      throw runtimeError;
    }
    return this.commandSuccess(operationId, command);
  }

  private async submit(operationId: OperationId, session: SessionSnapshot): Promise<RuntimeResult> {
    const prepared = await this.sessionManager.prepareSubmit();
    const transition = this.stateMachine.transitionSubmit(prepared.result, { world: this.world, session });
    if (!transition.ok) {
      await this.sessionManager.failSubmit(prepared, transition.error);
      throw transition.error;
    }
    let published: WorldSnapshot;
    try {
      published = await this.operations.submitSession({
        operationId,
        command: 'submit',
        previous: cloneWorld(this.world),
        target: transition.nextWorld,
        submission: prepared.result,
      });
    } catch (error) {
      const runtimeError = toRuntimeError(error, 'OPERATION_FAILED');
      await this.sessionManager.failSubmit(prepared, runtimeError);
      throw runtimeError;
    }
    this.commitWorld(operationId, published);
    await this.withLifecycleOperationAsync(operationId, () => this.sessionManager.completeSubmit(prepared));
    return this.commandSuccess(operationId, 'submit');
  }

  private async cancel(operationId: OperationId, session: SessionSnapshot): Promise<RuntimeResult> {
    const transition = this.stateMachine.transitionCancel({ world: this.world, session });
    if (!transition.ok) throw transition.error;
    const targetSession = await this.sessionManager.prepareCancel();
    const published = await this.operations.cancelSession({
      operationId,
      command: 'cancel',
      previous: cloneWorld(this.world),
      target: transition.nextWorld,
    });
    this.commitWorld(operationId, published);
    await this.withLifecycleOperationAsync(operationId, () => this.sessionManager.completeCancel(targetSession));
    return this.commandSuccess(operationId, 'cancel');
  }

  private async executeStable(
    operationId: OperationId,
    command: 'settle' | 'abandon-day',
    session: SessionSnapshot,
  ): Promise<RuntimeResult> {
    const transition = this.stateMachine.transitionWorld(command, { world: this.world, session });
    if (!transition.ok) throw transition.error;
    const loadingId = `${operationId}:loading`;
    this.events.emit({
      type: 'loading-started',
      operationId,
      loading: { id: loadingId, operation: command, detail: null },
    });
    try {
      const published = await this.operations.executeStableCommand({
        operationId,
        command,
        previous: cloneWorld(this.world),
        target: transition.nextWorld,
      });
      this.commitWorld(operationId, published);
    } finally {
      this.events.emit({ type: 'loading-ended', operationId, loadingId });
    }
    return this.commandSuccess(operationId, command);
  }

  private commitWorld(operationId: OperationId, world: WorldSnapshot): void {
    const previous = cloneWorld(this.world);
    this.world = cloneWorld(world);
    this.events.emit({ type: 'world-changed', operationId, previous, current: cloneWorld(this.world) });
  }

  private commandSuccess(operationId: OperationId, command: RuntimeCommand): RuntimeResult {
    this.events.emit({ type: 'command-succeeded', operationId, command });
    return { operationId, ok: true };
  }

  private inputFailure(operationId: OperationId, error: RuntimeError, sessionId: string | null = null): RuntimeResult {
    this.events.emit({ type: 'input-failed', operationId, sessionId, error });
    return { operationId, ok: false, error };
  }

  private handleSessionManagerEvent(event: SessionManagerEvent): void {
    if (event.type === 'session-created') {
      this.events.emit({
        type: 'session-created',
        operationId: this.requireLifecycleOperationId(event.type),
        sessionId: event.sessionId,
        kind: event.kind,
      });
      return;
    }
    if (event.type === 'session-ended') {
      this.events.emit({
        type: 'session-ended',
        operationId: this.requireLifecycleOperationId(event.type),
        sessionId: event.sessionId,
        status: event.status,
      });
      return;
    }
    this.emitSessionEvent(event.sessionId, event.event);
  }

  private emitSessionEvent(sessionId: string, event: SessionEvent): void {
    const withSession = { sessionId };
    switch (event.type) {
      case 'status-changed': this.events.emit({ type: 'session-status-changed', ...withSession, status: event.status }); break;
      case 'message-added': this.events.emit({ type: 'message-added', message: { ...event.message, sessionId } }); break;
      case 'assistant-message-start': this.events.emit({ type: 'assistant-message-start', ...withSession, messageId: event.messageId }); break;
      case 'assistant-message-delta': this.events.emit({ type: 'assistant-message-delta', ...withSession, messageId: event.messageId, sequence: event.sequence, delta: event.delta }); break;
      case 'assistant-message-end': this.events.emit({ type: 'assistant-message-end', ...withSession, messageId: event.messageId }); break;
      case 'assistant-message-error': this.events.emit({ type: 'assistant-message-error', ...withSession, messageId: event.messageId, error: event.error }); break;
      case 'input-requested': this.events.emit({ type: 'input-requested', ...withSession, request: event.request }); break;
      case 'input-closed': this.events.emit({ type: 'input-closed', ...withSession, requestId: event.requestId }); break;
      case 'loading-started': this.events.emit({ type: 'loading-started', ...withSession, loading: event.loading }); break;
      case 'loading-updated': this.events.emit({ type: 'loading-updated', ...withSession, loading: event.loading }); break;
      case 'loading-ended': this.events.emit({ type: 'loading-ended', ...withSession, loadingId: event.loadingId }); break;
    }
  }

  private withLifecycleOperation<T>(operationId: OperationId, action: () => T): T {
    this.lifecycleOperationId = operationId;
    try { return action(); } finally { this.lifecycleOperationId = null; }
  }

  private async withLifecycleOperationAsync<T>(operationId: OperationId, action: () => Promise<T>): Promise<T> {
    this.lifecycleOperationId = operationId;
    try { return await action(); } finally { this.lifecycleOperationId = null; }
  }

  private requireLifecycleOperationId(eventType: string): OperationId {
    if (this.lifecycleOperationId) return this.lifecycleOperationId;
    this.logger.error('Session lifecycle event has no Runtime operation.', undefined, { eventType });
    return this.ids.nextOperationId();
  }

  private assertOpen(): void {
    if (this.disposed) throw createRuntimeError('RUNTIME_CLOSED', 'Runtime is closed.');
  }
}

function cloneWorld(world: WorldSnapshot): WorldSnapshot {
  return { ...world, invalid: world.invalid ? cloneError(world.invalid) : null };
}

function cloneSession(session: SessionSnapshot): SessionSnapshot {
  return {
    ...session,
    input: session.input ? { ...session.input } : null,
    loading: session.loading ? { ...session.loading } : null,
    error: session.error ? cloneError(session.error) : null,
  };
}

function cloneError(error: RuntimeError): RuntimeError {
  return error.details === undefined
    ? { code: error.code, message: error.message }
    : { code: error.code, message: error.message, details: JSON.parse(JSON.stringify(error.details)) };
}

function availabilityError(
  reasonCode: CommandAvailability['reasonCode'],
  reason: string | null,
): RuntimeError {
  if (reasonCode === 'WORLD_INVALID') return createRuntimeError('WORLD_INVALID', reason ?? 'World is invalid.');
  if (reasonCode === 'SESSION_KIND_MISMATCH') return createRuntimeError('SESSION_KIND_MISMATCH', reason ?? 'Session kind mismatch.');
  if (reasonCode === 'SESSION_STATUS_MISMATCH') return createRuntimeError('SESSION_STATUS_MISMATCH', reason ?? 'Session status mismatch.');
  if (reasonCode === 'SESSION_REQUIRED') return createRuntimeError('SESSION_NOT_ACTIVE', reason ?? 'No active Session.');
  if (reasonCode === 'SESSION_ALREADY_ACTIVE') return createRuntimeError('SESSION_ALREADY_ACTIVE', reason ?? 'Session is active.');
  if (reasonCode === 'RUNTIME_CLOSED') return createRuntimeError('RUNTIME_CLOSED', reason ?? 'Runtime is closed.');
  if (reasonCode === 'PHASE_MISMATCH') return createRuntimeError('PHASE_MISMATCH', reason ?? 'World phase mismatch.');
  return createRuntimeError('COMMAND_NOT_AVAILABLE', reason ?? 'Command is not available.');
}
