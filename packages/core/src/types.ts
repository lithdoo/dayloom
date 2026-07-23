import type { RuntimeCommand } from './domain/commands';
import type { CommandAvailability } from './domain/availability';
import type { SessionKind, SessionStatus, WorldPhase } from './domain/types';
import type { OperationId, RuntimeError } from './schemas/common';
import type { SessionSnapshot } from './sessions/types';

export type {
  CommandUnavailableReason,
  RuntimeCommand,
  SessionCommand,
  WorldCommand,
} from './domain/commands';
export type { CommandAvailability } from './domain/availability';
export type { SessionKind, SessionStatus, WorldPhase } from './domain/types';
export type { JsonValue, OperationId, RuntimeError, RuntimeErrorCode } from './schemas/common';
export * from './sessions/types';

/** 消息角色。 */
export type MessageRole =
  /** 用户输入消息。 */
  | 'user'
  /** assistant 回复消息。 */
  | 'assistant'
  /** 系统或 runtime 产生的说明消息。 */
  | 'system'
  /** 可展示错误消息。 */
  | 'error';

/** 聚合消息的生命周期状态。 */
export type MessageStatus =
  /** 消息已经完整结束。 */
  | 'complete'
  /** assistant 消息仍在接收 delta。 */
  | 'streaming'
  /** 消息生成失败，但可能保留部分正文。 */
  | 'error';

/** Runtime 或 driver 侧聚合后的消息。 */
export interface RuntimeMessage {
  /** Runtime 或 message store 内唯一的消息 id。 */
  id: string;

  /** 消息角色。 */
  role: MessageRole;

  /** 聚合后的消息正文。 */
  text: string;

  /** 消息生命周期状态。 */
  status: MessageStatus;

  /** 消息所属 Session；Hub/全局消息可以没有 sessionId。 */
  sessionId?: string;
}

/** 当前输入请求的快照。 */
export interface InputRequestSnapshot {
  /** 输入请求 id，用于 input-requested/input-closed 配对。 */
  id: string;

  /** 给 driver 展示的简短输入提示；没有特殊提示时为 null。 */
  prompt: string | null;
}

/** 当前 loading/task 的快照。 */
export interface LoadingSnapshot {
  /** loading/task id，用于 loading-started/updated/ended 配对。 */
  id: string;

  /** 机器可读的操作名，如 ai-call、settle、prepare-tools。 */
  operation: string;

  /** 可展示的补充说明；没有补充说明时为 null。 */
  detail: string | null;
}

/** world 业务状态快照。 */
export interface WorldSnapshot {
  /** 当前 world phase。 */
  phase: WorldPhase;

  /** world 根目录绝对路径或 Runtime 传入的规范化路径。 */
  worldRoot: string;

  /** world id；未初始化或无法读取时为 null。 */
  worldId: string | null;

  /** 当前 archive pointer revision；未初始化时为 0。 */
  revision: number;

  /** 当前 archive commit id；未初始化时为 null。 */
  commitId: string | null;

  /** 当前 day id；未初始化或无法识别时为 null。 */
  day: string | null;

  /** 最近完成结算的 day。 */
  lastSettledDay: string | null;

  /** world 是否已完成初始化。 */
  initialized: boolean;

  /** phase 为 invalid 时的结构化诊断。 */
  invalid: ArchiveInvalidState | null;

  /** @deprecated 过渡期展示字段；新调用方应读取 invalid.message。 */
  invalidReason: string | null;
}

/** Runtime 对外保存的 archive invalid 诊断。 */
export type ArchiveInvalidState = RuntimeError;

/** Runtime 最近一次已提交快照。 */
export interface RuntimeSnapshot {
  /** world 业务状态快照。 */
  world: WorldSnapshot;

  /** 当前 active Session 的最小交互状态。 */
  session: SessionSnapshot;
}

/** 用户自然语言输入。 */
export interface RuntimeInput {
  /** 调用方提供的操作 id；未提供时由 Runtime 生成。 */
  operationId?: OperationId;

  /** 用户输入的自然语言文本。 */
  text: string;
}

/** Runtime 指令请求。 */
export interface RuntimeCommandRequest {
  /** 调用方提供的操作 id；未提供时由 Runtime 生成。 */
  operationId?: OperationId;

  /** 要执行的 Runtime 指令。 */
  command: RuntimeCommand;
}

/** Runtime mutation 的稳定结果。 */
export interface RuntimeResult {
  /** 本次操作 id，必须与相关事件中的 operationId 一致。 */
  operationId: OperationId;

  /** 操作是否被 Runtime 接受并完成其短 mutation。 */
  ok: boolean;

  /** 失败时的稳定可序列化错误。 */
  error?: RuntimeError;
}

/** Runtime 语义事件。 */
export type RuntimeEvent =
  /** world 快照变化；settle/abandon-day 后可能 phase 不变但 day 改变。 */
  | { type: 'world-changed'; operationId: OperationId; previous: WorldSnapshot; current: WorldSnapshot }
  /** Runtime 创建了新的 active Session。 */
  | { type: 'session-created'; operationId: OperationId; sessionId: string; kind: SessionKind }
  /** active Session 状态变化。 */
  | { type: 'session-status-changed'; sessionId: string; status: SessionStatus }
  /** active Session 结束。 */
  | { type: 'session-ended'; operationId: OperationId; sessionId: string; status: 'completed' | 'cancelled' }
  /** 添加一条非 assistant 流式生命周期消息。 */
  | { type: 'message-added'; message: RuntimeMessage }
  /** assistant 消息开始。 */
  | { type: 'assistant-message-start'; sessionId: string; messageId: string }
  /** assistant 消息增量。 */
  | { type: 'assistant-message-delta'; sessionId: string; messageId: string; sequence: number; delta: string }
  /** assistant 消息正常结束。 */
  | { type: 'assistant-message-end'; sessionId: string; messageId: string }
  /** assistant 消息失败。 */
  | { type: 'assistant-message-error'; sessionId: string; messageId: string; error: RuntimeError }
  /** Runtime 接受用户输入并开始处理。 */
  | { type: 'input-started'; operationId: OperationId; sessionId: string }
  /** 用户输入短 mutation 成功，后台流式任务可能仍在继续。 */
  | { type: 'input-succeeded'; operationId: OperationId; sessionId: string }
  /** 用户输入被拒绝或启动失败。 */
  | { type: 'input-failed'; operationId: OperationId; sessionId: string | null; error: RuntimeError }
  /** Session 请求 driver 展示输入能力。 */
  | { type: 'input-requested'; sessionId: string; request: InputRequestSnapshot }
  /** Session 关闭某个输入请求。 */
  | { type: 'input-closed'; sessionId: string; requestId: string }
  /** 开始 loading/task 状态。 */
  | { type: 'loading-started'; operationId?: OperationId; sessionId?: string; loading: LoadingSnapshot }
  /** 更新 loading/task 状态。 */
  | { type: 'loading-updated'; operationId?: OperationId; sessionId?: string; loading: LoadingSnapshot }
  /** 结束 loading/task 状态。 */
  | { type: 'loading-ended'; operationId?: OperationId; sessionId?: string; loadingId: string }
  /** Runtime 开始执行指令。 */
  | { type: 'command-started'; operationId: OperationId; command: RuntimeCommand }
  /** Runtime 指令执行成功。 */
  | { type: 'command-succeeded'; operationId: OperationId; command: RuntimeCommand }
  /** Runtime 指令执行失败。 */
  | { type: 'command-failed'; operationId: OperationId; command: RuntimeCommand; error: RuntimeError }
  /** Runtime 拒绝执行不可用指令。 */
  | { type: 'command-rejected'; operationId: OperationId; command: RuntimeCommand; error: RuntimeError };

/** Runtime 事件监听器；抛错不会破坏 Runtime，也不会阻止其它 listener。 */
export type RuntimeEventListener = (event: RuntimeEvent) => void;

/** 取消事件订阅；重复调用必须安全。 */
export type RuntimeUnsubscribe = () => void;

/** CLI/TUI 接触 core 的唯一入口。 */
export interface DayloomRuntime {
  /** 读取 Runtime 最近一次已提交的 world/session 快照。 */
  getSnapshot(): RuntimeSnapshot;

  /** 读取当前可用指令及不可用原因。 */
  getAvailableCommands(): CommandAvailability[];

  /** 提交自然语言输入；只在 active Session 等待输入时可用。 */
  sendInput(input: RuntimeInput): Promise<RuntimeResult>;

  /** 执行 world/session 指令，如 init、daily、submit、cancel。 */
  executeCommand(command: RuntimeCommandRequest): Promise<RuntimeResult>;

  /** 订阅 Runtime 事件；只接收订阅之后的新事件。 */
  subscribe(listener: RuntimeEventListener): RuntimeUnsubscribe;

  /** 释放 Runtime 资源，并中断可中断的后台任务。 */
  dispose(): Promise<void>;
}
