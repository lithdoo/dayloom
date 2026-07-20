/** 初始化、规划、行动或修订中的会话类型。 */
export type SessionKind =
  /** 初始化 world 的会话。 */
  | 'init'
  /** 生成或确认当日计划的会话。 */
  | 'planning'
  /** 推进当日行动的会话。 */
  | 'play'
  /** 修订 world 内容的会话。 */
  | 'revise';

/** 当前 active Session 的交互状态。 */
export type SessionStatus =
  /** 当前没有 active Session。 */
  | 'none'
  /** Session 已创建，但尚未开始运行。 */
  | 'created'
  /** Session 正在等待用户输入自然语言。 */
  | 'waiting-input'
  /** Session 正在接收 assistant 流式回复。 */
  | 'streaming'
  /** Session 正在执行非流式后台任务或工具调用。 */
  | 'loading'
  /** Session 产物已准备好，可以执行 submit。 */
  | 'ready-to-submit'
  /** Session 正在提交产物。 */
  | 'submitting'
  /** Session 已完成提交。 */
  | 'completed'
  /** Session 已被取消。 */
  | 'cancelled'
  /** Session 失败，通常允许 cancel，不允许 submit/sendInput。 */
  | 'failed';

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

/** 可序列化 JSON 值，用于公开错误 details。 */
export type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue };

/** Runtime/Session 对外暴露的稳定错误。 */
export interface RuntimeError {
  /** 稳定错误码，供 CLI/TUI 分支处理。 */
  code: string;

  /** 人类可读错误信息。 */
  message: string;

  /** 可序列化结构化详情；不得放 Error/cause 等不可稳定序列化对象。 */
  details?: JsonValue;
}

/** 一次输入或指令操作的关联 id，用于 result 与事件匹配。 */
export type OperationId = string;

/** world 的第一版业务阶段。 */
export type WorldPhase =
  /** world 尚未初始化。 */
  | 'uninitialized'
  /** 初始化 Session 进行中，等待输入、AI 回复或 submit/cancel。 */
  | 'initializing'
  /** world 已初始化，当前没有 active Session，处于稳定边界。 */
  | 'idle'
  /** daily/planning Session 进行中，正在生成或确认当日计划。 */
  | 'planning'
  /** 当日计划已提交，尚未进入行动推进。 */
  | 'planned'
  /** play Session 进行中，正在推进当日行动。 */
  | 'playing'
  /** 当日行动已提交，等待执行结算。 */
  | 'awaiting-settle'
  /** revise Session 进行中，正在修订 world。 */
  | 'revising'
  /** 存档异常或无法识别，第一版禁用所有 mutation。 */
  | 'invalid';

/** world 业务状态快照。 */
export interface WorldSnapshot {
  /** 当前 world phase。 */
  phase: WorldPhase;

  /** world 根目录绝对路径或 Runtime 传入的规范化路径。 */
  worldRoot: string;

  /** 当前 day id；未初始化或无法识别时为 null。 */
  day: string | null;

  /** world 是否已完成初始化。 */
  initialized: boolean;

  /** phase 为 invalid 时的人类可读原因；其它状态为 null。 */
  invalidReason: string | null;
}

/** Runtime 最近一次已提交快照。 */
export interface RuntimeSnapshot {
  /** world 业务状态快照。 */
  world: WorldSnapshot;

  /** 当前 active Session 的最小交互状态。 */
  session: SessionSnapshot;
}

/** world 业务指令。 */
export type WorldCommand =
  /** 从 uninitialized 进入 initializing。 */
  | 'init'
  /** 从 idle 进入 planning。 */
  | 'daily'
  /** 从 planned 进入 playing。 */
  | 'play'
  /** 从 awaiting-settle 执行结算并推进到下一天 idle。 */
  | 'settle'
  /** 从 idle 进入 revising。 */
  | 'revise'
  /** 放弃当前 day，回到前一天 idle；day_0001 没有前一天时回到 day = null。 */
  | 'abandon-day';

/** active Session 控制指令。 */
export type SessionCommand =
  /** 提交 active Session 产物。 */
  | 'submit'
  /** 取消 active Session，并回到进入 Session 前的业务边界。 */
  | 'cancel';

/** Runtime 支持的全部指令；不包含 next、help、status、exit 等 UI 指令。 */
export type RuntimeCommand = WorldCommand | SessionCommand;

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

/** 指令可用性。 */
export interface CommandAvailability {
  /** 指令名称。 */
  name: RuntimeCommand;

  /** 指令归属：world 状态机或 active Session 控制。 */
  type: 'world' | 'session';

  /** 当前是否可执行。 */
  enabled: boolean;

  /** 不可执行原因；enabled 为 true 时为 null。 */
  reason: string | null;
}

/** active Session 的最小可展示状态。 */
export interface SessionSnapshot {
  /** 当前是否存在 active Session。 */
  active: boolean;

  /** active Session id；没有 active Session 时为 null。 */
  id: string | null;

  /** active Session 类型；没有 active Session 时为 null。 */
  kind: SessionKind | null;

  /** active Session 的交互状态。 */
  status: SessionStatus;

  /** 当前输入请求；没有等待输入时为 null。 */
  input: InputRequestSnapshot | null;

  /** 当前 loading/task 信息；没有 loading 时为 null。 */
  loading: LoadingSnapshot | null;

  /** Session 最近一次错误；无错误时为 null。 */
  error: RuntimeError | null;
}

/** Session 内部可发出的窄化事件。 */
export type SessionEvent =
  /** Session 内部状态变化。 */
  | { type: 'status-changed'; status: SessionStatus }
  /** 添加一条非 assistant 流式生命周期消息，如 user/system/error。 */
  | { type: 'message-added'; message: Omit<RuntimeMessage, 'sessionId'> }
  /** assistant 消息开始，后续 delta/end/error 必须复用同一个 messageId。 */
  | { type: 'assistant-message-start'; messageId: string }
  /** assistant 消息增量内容。 */
  | { type: 'assistant-message-delta'; messageId: string; delta: string }
  /** assistant 消息正常结束；同 id 后续不得再发 message-added。 */
  | { type: 'assistant-message-end'; messageId: string }
  /** assistant 消息失败；保留已收到 delta，并把消息标记为 error。 */
  | { type: 'assistant-message-error'; messageId: string; error: RuntimeError }
  /** Session 请求用户输入。 */
  | { type: 'input-requested'; request: InputRequestSnapshot }
  /** Session 关闭某个输入请求。 */
  | { type: 'input-closed'; requestId: string }
  /** Session 开始 loading/task 状态。 */
  | { type: 'loading-started'; loading: LoadingSnapshot }
  /** Session 更新 loading/task 状态。 */
  | { type: 'loading-updated'; loading: LoadingSnapshot }
  /** Session 结束 loading/task 状态。 */
  | { type: 'loading-ended'; loadingId: string };

/** Session 可使用的上下文。 */
export interface SessionContext {
  /** 当前 world 根目录。 */
  worldRoot: string;

  /** 当前 day id；world 尚未初始化时为 null。 */
  day: string | null;

  /** 向 SessionManager 发出窄化事件。 */
  emit(event: SessionEvent): void;
}

/** 一次业务会话对象。 */
export interface RuntimeSession {
  /** Runtime 内唯一的 Session id，用于事件、消息和 driver 展示关联。 */
  readonly id: string;

  /** Session 类型，决定业务流程和 submit result 的语义。 */
  readonly kind: SessionKind;

  /** 返回当前 Session 的最小可展示状态，不包含完整消息列表。 */
  getSnapshot(): SessionSnapshot;

  /** 启动 Session 初始流程，例如发起首轮 prompt 或准备 input request。 */
  start(): Promise<void>;

  /** 接收用户自然语言输入，并通过 signal 支持后台 AI/task 中断。 */
  sendInput(input: RuntimeInput, signal: AbortSignal): Promise<void>;

  /** 提交 Session 产物给 Runtime，由 Runtime 决定 world phase transition。 */
  submit(): Promise<SessionSubmitResult>;

  /** 取消 Session，不提交产物，并清理或标记中间状态。 */
  cancel(): Promise<void>;

  /** 释放 Session 资源；Runtime dispose 或切换 Session 时调用。 */
  dispose(): Promise<void>;
}

/** Session 提交给 Runtime 的粗粒度产物。 */
export type SessionSubmitResult =
  /** 初始化会话提交的产物。 */
  | { kind: 'init'; payload: unknown }
  /** planning 会话提交的当日计划产物。 */
  | { kind: 'planning'; payload: unknown }
  /** play 会话提交的当日行动产物。 */
  | { kind: 'play'; payload: unknown }
  /** revise 会话提交的 world 修订产物。 */
  | { kind: 'revise'; payload: unknown };

/** Runtime 语义事件。 */
export type RuntimeEvent =
  /** world 快照变化；settle/abandon-day 后可能 phase 不变但 day 改变。 */
  | { type: 'world-changed'; operationId?: OperationId; previous: WorldSnapshot; current: WorldSnapshot }
  /** Runtime 创建了新的 active Session。 */
  | { type: 'session-created'; sessionId: string; kind: SessionKind }
  /** active Session 状态变化。 */
  | { type: 'session-status-changed'; sessionId: string; status: SessionStatus }
  /** active Session 结束。 */
  | { type: 'session-ended'; sessionId: string; status: 'completed' | 'cancelled' }
  /** 添加一条非 assistant 流式生命周期消息。 */
  | { type: 'message-added'; message: RuntimeMessage }
  /** assistant 消息开始。 */
  | { type: 'assistant-message-start'; sessionId: string; messageId: string }
  /** assistant 消息增量。 */
  | { type: 'assistant-message-delta'; sessionId: string; messageId: string; delta: string }
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
  | { type: 'loading-started'; sessionId?: string; loading: LoadingSnapshot }
  /** 更新 loading/task 状态。 */
  | { type: 'loading-updated'; sessionId?: string; loading: LoadingSnapshot }
  /** 结束 loading/task 状态。 */
  | { type: 'loading-ended'; sessionId?: string; loadingId: string }
  /** Runtime 开始执行指令。 */
  | { type: 'command-started'; operationId: OperationId; command: RuntimeCommand }
  /** Runtime 指令执行成功。 */
  | { type: 'command-succeeded'; operationId: OperationId; command: RuntimeCommand }
  /** Runtime 指令执行失败。 */
  | { type: 'command-failed'; operationId: OperationId; command: RuntimeCommand; error: RuntimeError }
  /** Runtime 拒绝执行不可用指令。 */
  | { type: 'command-rejected'; operationId: OperationId; command: RuntimeCommand; reason: string };

/** Runtime 事件监听器；抛错不会破坏 Runtime，也不会阻止其它 listener。 */
export type RuntimeEventListener = (event: RuntimeEvent) => void;

/** 取消事件订阅；重复调用必须安全。 */
export type RuntimeUnsubscribe = () => void;

/** CLI/TUI 接触 core2 的唯一入口。 */
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

/** 没有 active Session 时使用的空快照。 */
export const emptySessionSnapshot: SessionSnapshot = {
  active: false,
  id: null,
  kind: null,
  status: 'none',
  input: null,
  loading: null,
  error: null,
};
