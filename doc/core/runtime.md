# Core2 Runtime

> 状态：方向已定，core2 v1 实现中  
> 范围：Runtime public API、并发、事件、错误、driver 适配  
> 原则：Runtime 是 CLI/TUI 接触 core2 的唯一入口。

后续新增接口草案时，所有公开字段、方法和 union member 都必须带注释。

## 1. 边界

Runtime 对外提供：

- world/session 最小快照
- 指令能力
- 输入通道
- 指令通道
- 语义事件订阅
- 资源释放

Runtime 不提供：

- CLI/TUI 文本输出
- `next`
- UI 配置
- confirm
- `save`
- `exit`
- 直接 Session 对象访问
- 旧 `SessionIO` 协议
- 旧存档兼容
- 跨进程 Session 对象恢复

## 2. Public API

```ts
export interface DayloomRuntime {
  /** 读取 Runtime 最近一次已提交的 world/session 快照。 */
  getSnapshot(): RuntimeSnapshot;

  /** 读取当前可用指令及不可用原因；这是 commands 的唯一事实来源。 */
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
```

`getSnapshot()` 和 `getAvailableCommands()` 是只读接口。

`sendInput()`、`executeCommand()`、`dispose()` 是短 mutation 接口。

Runtime 第一版启动时从 core2 原生 `manifest.json` 与 `current.json` 读取最小 world snapshot。两个文件都不存在时是 `uninitialized`；文件不完整或 phase 无法识别时是 `invalid`。

## 3. Snapshot

Snapshot 是最小运行读数，只包含：

```ts
export interface RuntimeSnapshot {
  /** world 业务状态快照。 */
  world: WorldSnapshot;

  /** 当前 active Session 的最小交互状态。 */
  session: SessionSnapshot;
}
```

```ts
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
```

```ts
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
```

Snapshot 不包含 messages，也不包含 commands。

- messages 由 runtime events + message store 处理
- commands 由 `getAvailableCommands()` 处理

## 4. Message / Input / Loading Types

```ts
export type MessageRole =
  /** 用户输入消息。 */
  | 'user'
  /** assistant 回复消息。 */
  | 'assistant'
  /** 系统或 runtime 产生的说明消息。 */
  | 'system'
  /** 可展示错误消息。 */
  | 'error';

export type MessageStatus =
  /** 消息已经完整结束。 */
  | 'complete'
  /** assistant 消息仍在接收 delta。 */
  | 'streaming'
  /** 消息生成失败，但可能保留部分正文。 */
  | 'error';

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

export interface InputRequestSnapshot {
  /** 输入请求 id，用于 input-requested/input-closed 配对。 */
  id: string;

  /** 给 driver 展示的简短输入提示；没有特殊提示时为 null。 */
  prompt: string | null;
}

export interface LoadingSnapshot {
  /** loading/task id，用于 loading-started/updated/ended 配对。 */
  id: string;

  /** 机器可读的操作名，如 ai-call、settle、prepare-tools。 */
  operation: string;

  /** 可展示的补充说明；没有补充说明时为 null。 */
  detail: string | null;
}
```

`RuntimeMessage` 是聚合后的消息模型，不等同于 provider 原始 delta。assistant 回复统一由 `assistant-message-*` 事件驱动聚合。

## 5. Commands

```ts
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

export type SessionCommand =
  /** 提交 active Session 产物。 */
  | 'submit'
  /** 取消 active Session，并回到进入 Session 前的业务边界。 */
  | 'cancel';

/** Runtime 支持的全部指令；不包含 next、help、status、exit 等 UI 指令。 */
export type RuntimeCommand = WorldCommand | SessionCommand;
```

```ts
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
```

`getAvailableCommands()` 是 commands 的唯一事实来源。

可用性规则：

- world 指令按 world phase 判断
- `submit` 要求 active Session status 为 `ready-to-submit`
- `cancel` 要求 active Session 存在，且不是 `submitting/completed/cancelled`
- `sendInput` 要求 active Session status 为 `waiting-input`
- `invalid` 禁用所有 mutation command

## 6. Input / Command Request

```ts
/** 一次输入或指令操作的关联 id，用于 result 与事件匹配。 */
export type OperationId = string;

export interface RuntimeInput {
  /** 调用方提供的操作 id；未提供时由 Runtime 生成。 */
  operationId?: OperationId;

  /** 用户输入的自然语言文本。 */
  text: string;
}

export interface RuntimeCommandRequest {
  /** 调用方提供的操作 id；未提供时由 Runtime 生成。 */
  operationId?: OperationId;

  /** 要执行的 Runtime 指令。 */
  command: RuntimeCommand;
}

export interface RuntimeResult {
  /** 本次操作 id，必须与相关事件中的 operationId 一致。 */
  operationId: OperationId;

  /** 操作是否被 Runtime 接受并完成其短 mutation。 */
  ok: boolean;

  /** 失败时的稳定可序列化错误。 */
  error?: RuntimeError;
}
```

operation id 可以由调用方传入；未传入时 Runtime 生成，并在 result 与事件中返回同一个 id。

## 7. 并发与重入

Runtime 第一版采用短 mutation 串行规则。

短 mutation：

- `sendInput`
- `executeCommand`
- `dispose`

规则：

- 同一时刻只能有一个短 mutation 正在执行。
- 短 mutation 执行期间，新的 mutation 返回 `RUNTIME_BUSY`。
- `getSnapshot()` / `getAvailableCommands()` 可随时读取最近一次已提交状态。
- listener 中重入调用 mutation 按普通并发规则处理，通常返回 `RUNTIME_BUSY`。
- `dispose` 开始后进入 disposing/closed 语义，后续 mutation 返回错误。

Runtime 不自动排队外部 mutation。

## 8. 后台 Task

`sendInput()` 不等待完整 AI streaming 结束。

流程：

```text
sendInput
  accept input
  update session status
  start background Session task
  return RuntimeResult

background task
  emit stream/loading/message events
  update session status through Runtime
```

后台 task 不持有 mutation lock。

streaming/loading 期间：

- `cancel` 可以获得 mutation lock 并 abort 后台 task
- `dispose` 可以获得 mutation lock 并 abort 后台 task
- 其它 mutation 禁用或返回 `COMMAND_NOT_AVAILABLE`

`submitting` 期间：

- 第一版只允许 `dispose`
- 不允许 `cancel` 中断 submit
- 是否支持 submit abort 后续单独设计

## 9. Runtime Event

```ts
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
```

Event rules:

- Runtime 先提交内部状态，再发送事件。
- 同一个 mutation 产生的事件必须按发生顺序发送。
- 不可用 command 只发送 `command-rejected`，不发送 `command-started`。
- `submit/cancel` 成功时，Runtime 先提交并广播 `world-changed`，再广播 `session-ended`，最后广播 `command-succeeded`。
- listener 抛错不能破坏 Runtime 状态。
- listener 抛错不能阻止其它 listener。
- listener 抛错进入内部日志，不重新抛给 mutation caller。
- `subscribe()` 只订阅调用之后的新事件，不回放历史。
- driver 需要当前状态时，在 subscribe 后主动调用 `getSnapshot()` 和 `getAvailableCommands()`。

`world-changed` 携带前后完整 `WorldSnapshot`，因为 settle/abandon-day 可能出现 phase 仍为 `idle` 但 day 已改变。

## 10. Error

```ts
export interface RuntimeError {
  /** 稳定错误码，供 CLI/TUI 分支处理。 */
  code: string;

  /** 人类可读错误信息。 */
  message: string;

  /** 可序列化结构化详情；不得放 Error/cause 等不可稳定序列化对象。 */
  details?: JsonValue;
}

export type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue };
```

公开错误只包含可序列化 details。原始 cause 只进入 Runtime 内部日志。

第一版错误码：

| code | 含义 |
|------|------|
| `COMMAND_NOT_AVAILABLE` | 当前状态不允许执行该指令 |
| `RUNTIME_BUSY` | 当前已有短 mutation 正在执行 |
| `INPUT_NOT_EXPECTED` | 当前没有 active Session 或 Session 不在等待输入 |
| `SESSION_NOT_ACTIVE` | 需要 Session 的操作找不到 active Session |
| `SESSION_KIND_MISMATCH` | submit result 与当前 world phase 不匹配 |
| `SESSION_FAILED` | Session 内部执行失败 |
| `AI_CALL_FAILED` | AI/provider 调用失败 |
| `OPERATION_FAILED` | settle / abandon-day 等短 operation 失败 |
| `WORLD_INVALID` | world 处于 invalid 状态或读取失败 |

## 11. Driver 关系

CLI/TUI 是 Runtime driver。

CLI 可自行提供 `next`，但必须转换为具体 RuntimeCommand。

TUI 不提供 `next`，直接展示 `getAvailableCommands()`。

Runtime 不生成 Hub Select，不决定按钮顺序、推荐高亮或快捷键。

## 12. 待细化项

- `RuntimeMessage` 是否需要 `createdAt`、`updatedAt` 或 metadata，等 message store 实现时再定。
- `InputRequestSnapshot.prompt` 是否足够表达多输入场景，第一版只保留单输入请求。
- `LoadingSnapshot.operation` 的枚举是否冻结，等真实业务接入时校对。
- `dispose` 后是否保留最后 snapshot 可读，第一版实现时定。

## 13. 测试

- `runtime-busy`
- `background-task-cancel`
- `operation-id`
- `listener`
- `submit-availability`
- `invalid`
- `world-changed` 携带完整 snapshot
- command started/succeeded/failed/rejected 匹配 operation id
