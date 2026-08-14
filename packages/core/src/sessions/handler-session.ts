import { createRuntimeError, toRuntimeError } from '../errors';
import { validateSessionSubmission } from '../schemas/validators';
import type {
  InputRequestSnapshot,
  RuntimeInput,
  RuntimeSession,
  SessionContext,
  SessionKind,
  SessionSnapshot,
  SessionStatus,
  SessionSubmitResult,
} from '../types';

/** HandlerSession 可调用的事件辅助接口。 */
export interface HandlerSessionEmitter {
  /** 发出一条 system 消息。 */
  system(text: string): void;

  /** 发出一条 error 消息。 */
  error(text: string): void;

  /** 发出一条完整 assistant 消息。 */
  assistant(text: string): void;

  /** 发出 assistant 流式消息。 */
  stream(messageId: string, deltas: AsyncIterable<string>, signal: AbortSignal): Promise<void>;
}

/** HandlerSession 的业务处理器。 */
export interface HandlerSessionHandler {
  /** Session 启动时调用，用于准备上下文或发 opening message。 */
  start?: (context: SessionContext, emit: HandlerSessionEmitter) => Promise<void> | void;

  /** 用户输入后调用，用于执行 AI/task 并更新内部草稿。 */
  sendInput: (
    input: RuntimeInput,
    context: SessionContext,
    emit: HandlerSessionEmitter,
    signal: AbortSignal,
  ) => Promise<void>;

  /** 提交当前会话产物；只在可提交稳定态时调用。 */
  submit: (context: SessionContext) => Promise<SessionSubmitResult>;

  /** 取消当前会话；用于标记 workspace cancelled 或释放临时资源。 */
  cancel?: (context: SessionContext) => Promise<void> | void;

  /** 释放当前会话资源。 */
  dispose?: (context: SessionContext) => Promise<void> | void;
}

/** HandlerSession 配置。 */
export interface HandlerSessionOptions {
  /** 固定 Session id；不传时自动生成。 */
  id?: string;

  /** Session 类型。 */
  kind: SessionKind;

  /** Session 上下文。 */
  context: SessionContext;

  /** 初始输入请求。 */
  inputRequest?: InputRequestSnapshot;

  /** 业务处理器。 */
  handler: HandlerSessionHandler;
}

/** 面向真实业务接入的 RuntimeSession 基类。 */
export class HandlerSession implements RuntimeSession {
  readonly id: string;
  readonly kind: SessionKind;
  private readonly context: SessionContext;
  private readonly handler: HandlerSessionHandler;
  private readonly inputRequest: InputRequestSnapshot;
  private snapshot: SessionSnapshot;
  private assistantMessageCounter = 1;
  private submitReturnStatus: 'waiting-input' | 'ready-to-submit' = 'waiting-input';
  private disposed = false;

  constructor(options: HandlerSessionOptions) {
    this.id = options.id ?? options.context.sessionId;
    this.kind = options.kind;
    this.context = options.context;
    this.handler = options.handler;
    this.inputRequest = options.inputRequest ?? { id: `${this.id}:input`, prompt: null };
    this.snapshot = {
      active: true,
      id: this.id,
      kind: this.kind,
      status: 'created',
      input: null,
      loading: null,
      error: null,
    };
  }

  getSnapshot(): SessionSnapshot {
    return {
      ...this.snapshot,
      input: this.snapshot.input ? { ...this.snapshot.input } : null,
      loading: this.snapshot.loading ? { ...this.snapshot.loading } : null,
      error: this.snapshot.error ? { ...this.snapshot.error } : null,
    };
  }

  async start(): Promise<void> {
    try {
      await this.handler.start?.(this.context, this.createEmitter(new AbortController().signal));
      this.requestInput();
    } catch (error) {
      this.fail(error);
      throw this.snapshot.error;
    }
  }

  async sendInput(input: RuntimeInput, signal: AbortSignal): Promise<void> {
    if (this.snapshot.status !== 'waiting-input') {
      throw createRuntimeError('INPUT_NOT_EXPECTED', 'Handler session is not waiting for input.');
    }

    this.context.emit({
      type: 'message-added',
      message: {
        id: input.operationId ?? `${this.id}:user:${Date.now()}`,
        role: 'user',
        text: input.text,
        status: 'complete',
      },
    });
    this.snapshot.input = null;
    this.context.emit({ type: 'input-closed', requestId: this.inputRequest.id });
    this.setStatus('loading');

    try {
      await this.handler.sendInput(input, this.context, this.createEmitter(signal), signal);
      this.requestInput();
    } catch (error) {
      if (isAbortSignalError(error)) {
        throw error;
      }
      this.fail(error);
    }
  }

  async prepareSubmit(): Promise<SessionSubmitResult> {
    if (this.snapshot.status !== 'waiting-input' && this.snapshot.status !== 'ready-to-submit') {
      throw createRuntimeError('COMMAND_NOT_AVAILABLE', 'Handler session is not ready to submit.');
    }
    this.submitReturnStatus = this.snapshot.status;
    this.setStatus('submitting');
    const result = validateSessionSubmission(await this.handler.submit(this.context));
    if (result.kind !== this.kind) {
      throw createRuntimeError('SESSION_KIND_MISMATCH', 'Handler submission kind does not match its Session.');
    }
    return result;
  }

  async completeSubmit(): Promise<void> {
    this.setStatus('completed');
  }

  async failSubmit(error: import('../types').RuntimeError): Promise<void> {
    this.snapshot.error = error;
    this.setStatus(isRetryableSubmitError(error.code) ? this.submitReturnStatus : 'failed');
  }

  async cancel(): Promise<void> {
    await this.handler.cancel?.(this.context);
    this.setStatus('cancelled');
  }

  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    await this.handler.dispose?.(this.context);
  }

  private requestInput(): void {
    this.snapshot.input = { ...this.inputRequest };
    this.setStatus('waiting-input');
    this.context.emit({ type: 'input-requested', request: { ...this.inputRequest } });
  }

  private setStatus(status: SessionStatus): void {
    this.snapshot.status = status;
    this.context.emit({ type: 'status-changed', status });
  }

  private fail(error: unknown): void {
    const runtimeError = toRuntimeError(error, 'SESSION_FAILED');
    this.snapshot.error = runtimeError;
    this.context.emit({
      type: 'message-added',
      message: {
        id: `${this.id}:error:${Date.now()}`,
        role: 'error',
        text: runtimeError.message,
        status: 'error',
      },
    });
    this.setStatus('failed');
  }

  private createEmitter(signal: AbortSignal): HandlerSessionEmitter {
    return {
      system: (text) => {
        this.context.emit({
          type: 'message-added',
          message: {
            id: `${this.id}:system:${Date.now()}`,
            role: 'system',
            text,
            status: 'complete',
          },
        });
      },
      error: (text) => {
        this.context.emit({
          type: 'message-added',
          message: {
            id: `${this.id}:error:${Date.now()}`,
            role: 'error',
            text,
            status: 'error',
          },
        });
      },
      assistant: (text) => {
        const messageId = `${this.id}:assistant:${this.assistantMessageCounter++}`;
        this.context.emit({ type: 'assistant-message-start', messageId });
        this.context.emit({ type: 'assistant-message-delta', messageId, sequence: 1, delta: text });
        this.context.emit({ type: 'assistant-message-end', messageId });
      },
      stream: async (messageId, deltas, streamSignal) => {
        this.setStatus('streaming');
        this.context.emit({ type: 'assistant-message-start', messageId });
        let sequence = 1;
        try {
          for await (const delta of deltas) {
            if (signal.aborted || streamSignal.aborted) {
              throw abortError();
            }
            this.context.emit({ type: 'assistant-message-delta', messageId, sequence, delta });
            sequence += 1;
          }
          this.context.emit({ type: 'assistant-message-end', messageId });
        } catch (error) {
          if (isAbortSignalError(error)) {
            throw error;
          }
          const runtimeError = toRuntimeError(error, 'AI_CALL_FAILED');
          this.context.emit({ type: 'assistant-message-error', messageId, error: runtimeError });
          throw runtimeError;
        }
      },
    };
  }
}

function isRetryableSubmitError(code: import('../types').RuntimeErrorCode): boolean {
  return code === 'ARCHIVE_CONFLICT' || code === 'OPERATION_FAILED' || code.startsWith('ARCHIVE_');
}

/** 创建 HandlerSession 工厂。 */
export function createHandlerSessionFactory(
  handlerForKind: (kind: SessionKind) => HandlerSessionHandler,
) {
  return ({ kind, context }: { kind: SessionKind; context: SessionContext }) =>
    new HandlerSession({ kind, context, handler: handlerForKind(kind) });
}

function isAbortSignalError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}

function abortError(): Error {
  const error = new Error('The operation was aborted.');
  error.name = 'AbortError';
  return error;
}
