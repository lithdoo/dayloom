# Core2 Session Manager

> 状态：方向已定，core2 v1 实现中  
> 范围：Session 生命周期、SessionEvent、后台任务、消息流、AI 失败处理  
> 原则：Session 只负责会话交互，不拥有 world transition 权。

后续新增接口草案时，所有公开字段、方法和 union member 都必须带注释。

## 1. 边界

SessionManager 是 Runtime 内部组件，不作为第一版公共 API。

它负责：

- 创建 Session
- 挂载 active Session
- 转发自然语言输入
- 管理后台 Session task
- 管理 AbortController
- 汇总 SessionEvent
- 执行 Session `submit/cancel/dispose`
- 清理 active Session

它不负责：

- 判断 world 指令是否可用
- 生成 `world-changed`
- 生成 command lifecycle 事件
- 决定 world phase transition
- 输出 CLI/TUI 文本

## 2. Session Kind / Status

```ts
export type SessionKind =
  /** 初始化 world 的会话。 */
  | 'init'
  /** 生成或确认当日计划的会话。 */
  | 'planning'
  /** 推进当日行动的会话。 */
  | 'play'
  /** 修订 world 内容的会话。 */
  | 'revise';

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
  /** Session 正在提交产物，第一版不支持 cancel 中断。 */
  | 'submitting'
  /** Session 已完成提交。 */
  | 'completed'
  /** Session 已被取消。 */
  | 'cancelled'
  /** Session 失败，通常允许 cancel，不允许 submit/sendInput。 */
  | 'failed';
```

`submit` 只有在 active Session status 为 `ready-to-submit` 时启用。

`cancel` 在 active Session 存在且 status 不是 `submitting/completed/cancelled` 时启用。

`sendInput` 只在 active Session status 为 `waiting-input` 时允许。

## 3. RuntimeSession Interface

```ts
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
```

`sendInput` 不等待完整 AI streaming 结束。它接收输入并启动后台任务，后续通过事件推进。

## 4. SessionContext / SessionEvent

Session 不能直接 emit RuntimeEvent。它只能 emit 窄化的 SessionEvent。

```ts
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

export interface SessionContext {
  /** 当前 world 根目录。 */
  worldRoot: string;

  /** 当前 day id；world 尚未初始化时为 null。 */
  day: string | null;

  /** 向 SessionManager 发出窄化事件，由 Runtime 转成 RuntimeEvent。 */
  emit(event: SessionEvent): void;
}
```

Runtime 负责转换：

- 补充 `sessionId`
- 更新 Session snapshot
- 将 `status-changed` 转为 `session-status-changed`
- 禁止 Session 发 `world-changed`
- 禁止 Session 发 `command-*`
- 禁止 Session 发 `session-created/session-ended`

## 5. 后台任务与取消

SessionManager 必须为后台 Session task 持有 `AbortController` 或等价取消句柄。

规则：

- `sendInput` 启动后台 task 后尽快返回。
- AI streaming/loading 不持有 mutation lock。
- streaming/loading 期间，`cancel` 和 `dispose` 可以中断后台 task。
- `cancel` abort 当前后台 task，并把 Session 标记为 cancelled/failed 后交还 Runtime。
- `dispose` abort 当前后台 task 并释放资源。
- 后台 task 自然结束后，后续 `cancel/dispose` 幂等处理。

`submitting` 期间第一版不允许 `cancel` 中断；只允许 `dispose`。

## 6. 消息事件

assistant 回复统一使用：

```text
assistant-message-start
assistant-message-delta
assistant-message-end
assistant-message-error
```

包括非流式 assistant 回复。

规则：

- `assistant-message-end` 后不得再补发同 id 的 `message-added`。
- `message-added` 只用于 user/system/error 等非 assistant 流式生命周期消息。
- message store 必须按 message id 幂等更新。
- 重复 delta/end/error 不能生成重复消息行。

## 7. Message Store

第一版 message store 放在 driver 共享辅助模块，不放进 Runtime snapshot。

规则：

- 按 session id 分组保存消息。
- 切换到新 Session 时，driver 默认展示新 Session 消息。
- Hub 消息、系统消息由 driver 单独维护。
- 长期 play 可能消息很多，message store 必须支持按 session 查询和上限保留策略。
- 第一版建议每个 session 只保留最近 N 条或最近 N KB 文本。
- 完整消息持久化另行设计。

## 8. AI 调用失败

第一版采用保守策略：

- AI 回复失败后，当前 Session 进入 `failed`
- `submit` 禁用
- `sendInput` 禁用
- `cancel` 仍允许
- `retry` 不进入第一版 runtime command

如果 assistant message 已开始：

- 保留已收到 delta
- 发 `assistant-message-error`
- message store 将该 message 标记为 `error`
- Session status 更新为 `failed`
- `sendInput` 通常已经返回成功，失败通过事件报告

如果 AI 调用在 assistant message 开始前失败：

- 可以发 `message-added`，role 为 `error`
- Session status 更新为 `failed`
- 若失败发生在接受输入前，`sendInput` 返回失败
- 若失败发生在后台 task，使用事件报告失败

AI 失败不自动切换 world phase，也不自动 submit/cancel。

## 9. Submit Result

```ts
export type SessionSubmitResult =
  /** 初始化会话提交的产物。 */
  | { kind: 'init'; payload: unknown }
  /** planning 会话提交的当日计划产物。 */
  | { kind: 'planning'; payload: unknown }
  /** play 会话提交的当日行动产物。 */
  | { kind: 'play'; payload: unknown }
  /** revise 会话提交的 world 修订产物。 */
  | { kind: 'revise'; payload: unknown };
```

Session 返回产物，不返回目标 world phase。Runtime 状态机根据当前 world phase 决定 submit 后目标状态。

## 10. 旧阻塞式 Loop 处理

现有 interactive 实现多为主动阻塞式循环：

```text
loop
  io.write(...)
  await io.readInput(...)
  parse shell command
  call AI
  io.write(...)
```

这种结构不能直接成为 core2 Session。

真实业务接入应拆出非交互部件：

- prompt 构建
- AI 调用与 provider stream 适配
- assistant 输出解析
- payload validate
- 文件 apply/write
- MCP gateway 与工具准备

旧 loop adapter 只能作为短期拆分验证手段，不能成为最终设计。

## 11. 测试

- fake Session create / submit / cancel / dispose 生命周期
- `sendInput` 启动后台 task 后返回
- streaming 时 `cancel/dispose` abort 后台 task
- AI 流式前/流式中失败进入 `failed`
- message store 流式聚合幂等
- SessionEvent 不能越权发 world/command 事件
