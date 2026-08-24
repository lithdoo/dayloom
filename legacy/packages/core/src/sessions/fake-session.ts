import { createRuntimeError } from '../errors';
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

/** FakeSession 的行为配置。 */
export interface FakeSessionOptions {
  /** 固定 Session id；不传时自动生成。 */
  id?: string;

  /** Session 类型。 */
  kind: SessionKind;

  /** Session 上下文。 */
  context: SessionContext;

  /** start 后创建的输入请求。 */
  inputRequest?: InputRequestSnapshot;

  /** sendInput 后要流式输出的 delta。 */
  deltas?: string[];

  /** 每个 delta 之间等待的毫秒数。 */
  delayMs?: number;

  /** 在第几个 delta 后失败；0 表示 assistant-message-start 后立刻失败。 */
  failAtDeltaIndex?: number;

  /** submit 返回的强类型业务产物；kind 必须与 Session 一致。 */
  submitResult?: SessionSubmitResult;
}

/** 用于验证 SessionManager 的 fake RuntimeSession。 */
export class FakeSession implements RuntimeSession {
  readonly id: string;
  readonly kind: SessionKind;
  private readonly context: SessionContext;
  private readonly inputRequest: InputRequestSnapshot;
  private readonly deltas: string[];
  private readonly delayMs: number;
  private readonly failAtDeltaIndex: number | null;
  private readonly submitResult: SessionSubmitResult;
  private snapshot: SessionSnapshot;
  private assistantMessageCounter = 1;
  private submitReturnStatus: 'waiting-input' | 'ready-to-submit' = 'waiting-input';
  private disposed = false;

  constructor(options: FakeSessionOptions) {
    this.id = options.id ?? options.context.sessionId;
    this.kind = options.kind;
    this.context = options.context;
    this.inputRequest = options.inputRequest ?? { id: `${this.id}:input`, prompt: null };
    this.deltas = options.deltas ?? ['ok'];
    this.delayMs = options.delayMs ?? 0;
    this.failAtDeltaIndex = options.failAtDeltaIndex ?? null;
    this.submitResult = options.submitResult ?? defaultSubmitResult(this.kind, this.context.world.day);
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
    this.setStatus('waiting-input');
    this.snapshot.input = { ...this.inputRequest };
    this.context.emit({ type: 'input-requested', request: { ...this.inputRequest } });
  }

  async sendInput(input: RuntimeInput, signal: AbortSignal): Promise<void> {
    this.context.emit({
      type: 'message-added',
      message: {
        id: input.operationId ?? `${this.id}:user`,
        role: 'user',
        text: input.text,
        status: 'complete',
      },
    });
    this.snapshot.input = null;
    this.context.emit({ type: 'input-closed', requestId: this.inputRequest.id });
    this.setStatus('streaming');

    const messageId = `${this.id}:assistant:${this.assistantMessageCounter++}`;
    this.context.emit({ type: 'assistant-message-start', messageId });

    if (this.failAtDeltaIndex === 0) {
      this.fail(messageId);
      return;
    }

    for (let index = 0; index < this.deltas.length; index += 1) {
      await delay(this.delayMs, signal);
      if (signal.aborted) {
        throw abortError();
      }
      this.context.emit({
        type: 'assistant-message-delta',
        messageId,
        sequence: index + 1,
        delta: this.deltas[index],
      });
      if (this.failAtDeltaIndex === index + 1) {
        this.fail(messageId);
        return;
      }
    }

    this.context.emit({ type: 'assistant-message-end', messageId });
    this.setStatus('waiting-input');
    this.snapshot.input = { ...this.inputRequest };
    this.context.emit({ type: 'input-requested', request: { ...this.inputRequest } });
  }

  async prepareSubmit(): Promise<SessionSubmitResult> {
    if (this.snapshot.status !== 'waiting-input' && this.snapshot.status !== 'ready-to-submit') {
      throw createRuntimeError('COMMAND_NOT_AVAILABLE', 'Fake session is not ready to submit.');
    }
    this.submitReturnStatus = this.snapshot.status;
    this.setStatus('submitting');
    if (this.submitResult.kind !== this.kind) {
      throw createRuntimeError('SESSION_KIND_MISMATCH', 'Fake submission kind does not match its Session.');
    }
    return this.submitResult;
  }

  async completeSubmit(): Promise<void> {
    this.setStatus('completed');
  }

  async failSubmit(error: import('../types').RuntimeError): Promise<void> {
    this.snapshot.error = error;
    this.setStatus(isRetryableSubmitError(error.code) ? this.submitReturnStatus : 'failed');
  }

  async cancel(): Promise<void> {
    this.setStatus('cancelled');
  }

  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
  }

  private fail(messageId: string): void {
    const error = createRuntimeError('AI_CALL_FAILED', 'Fake AI call failed.');
    this.snapshot.error = error;
    this.context.emit({ type: 'assistant-message-error', messageId, error });
    this.setStatus('failed');
  }

  private setStatus(status: SessionStatus): void {
    this.snapshot.status = status;
    this.context.emit({ type: 'status-changed', status });
  }
}

function isRetryableSubmitError(code: import('../types').RuntimeErrorCode): boolean {
  return code === 'ARCHIVE_CONFLICT' || code === 'OPERATION_FAILED' || code.startsWith('ARCHIVE_');
}

function defaultSubmitResult(kind: SessionKind, day: string | null): SessionSubmitResult {
  switch (kind) {
    case 'init':
      return {
        kind,
        world: { id: 'fake-world', title: 'Fake World' },
        canon: { premise: '', rules: '', style: '', userRole: '' },
      };
    case 'planning':
      return { kind, day: day ?? 'day_0001', intent: 'Fake plan', beats: [] };
    case 'play':
      return { kind, day: day ?? 'day_0001', summary: 'Fake play', beats: [], events: [], transcript: [] };
    case 'revise':
      return { kind, summary: 'Fake revision', canon: { premise: '', rules: '', style: '', userRole: '' } };
  }
}

/** 创建 FakeSession 的工厂辅助函数。 */
export function createFakeSessionFactory(
  defaults: Omit<FakeSessionOptions, 'kind' | 'context'> = {},
) {
  return ({ kind, context }: { kind: SessionKind; context: SessionContext }) =>
    new FakeSession({ ...defaults, kind, context });
}

function delay(ms: number, signal: AbortSignal): Promise<void> {
  if (ms <= 0) {
    return Promise.resolve();
  }
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(timeout);
      reject(abortError());
    };
    const timeout = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

function abortError(): Error {
  const error = new Error('The operation was aborted.');
  error.name = 'AbortError';
  return error;
}
