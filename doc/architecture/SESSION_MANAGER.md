# Core Session Manager

> **类型**：architecture  
> **状态**：implemented  
> **最后核对**：2026-07  
> **代码入口**：`packages/core/src/sessions/`

## 1. 职责

SessionManager 负责：

- 通过工厂准备指定 kind 的 RuntimeSession；
- 保证同时最多一个 active Session；
- 缓冲 Session 启动阶段事件；
- 在 Runtime 完成业务边界后激活并发布 Session；
- 转发自然语言输入；
- 管理输入后台 task 和 AbortController；
- 准备 submission，并在 Runtime 发布存档后完成 Session；
- 取消和释放 Session；
- 将窄化 SessionEvent 转换为带 session id 的管理事件。

SessionManager 不负责：

- command availability；
- world phase transition；
- ArchiveTransaction；
- command lifecycle event；
- 正式业务文件写入；
- 输入中的命令语法。

## 2. Session 接口

```ts
export interface RuntimeSession<TResult extends SessionSubmitResult = SessionSubmitResult> {
  /** Runtime 内唯一 Session id。 */
  readonly id: string;

  /** Session 业务类型。 */
  readonly kind: TResult['kind'];

  /** 返回当前只读交互快照。 */
  getSnapshot(): SessionSnapshot;

  /** 启动首轮交互或输入请求。 */
  start(): Promise<void>;

  /** 接收自然语言输入；所有长任务必须响应 signal。 */
  sendInput(input: RuntimeInput, signal: AbortSignal): Promise<void>;

  /** 构建最终业务产物，不发布正式存档。 */
  prepareSubmit(): Promise<TResult>;

  /** Runtime 已成功发布业务产物后通知 Session 完成。 */
  completeSubmit(): Promise<void>;

  /** submit 发布失败后恢复到可重试或 failed 状态。 */
  failSubmit(error: RuntimeError): Promise<void>;

  /** Runtime 已发布 cancel 边界后，结束会话并清理会话资源。 */
  cancel(): Promise<void>;

  /** 释放 AI、工具和其它进程内资源。 */
  dispose(): Promise<void>;
}
```

把原来的单步 `submit()` 拆成 `prepareSubmit/completeSubmit/failSubmit`，避免 Session 已被清除后 ArchiveTransaction 才失败。

## 3. Session Context

```ts
export interface SessionContext {
  /** Session id。 */
  sessionId: string;

  /** Session 创建时的只读 world 快照。 */
  world: Readonly<WorldSnapshot>;

  /** Session operation 的隔离工作区。 */
  workspace: SessionWorkspace;

  /** 发出权限受限的 SessionEvent。 */
  emit(event: SessionEvent): void;
}

export interface SessionWorkspace {
  /** 追加会话 transcript；不得写入正式 day revision。 */
  appendTranscript(entry: TranscriptEntry): Promise<void>;

  /** 写入 Session 私有 checkpoint。 */
  writeCheckpoint(value: JsonValue): Promise<void>;

  /** 读取最近 checkpoint；没有时为 null。 */
  readCheckpoint(): Promise<JsonValue | null>;
}
```

SessionContext 不暴露 Runtime、ArchiveRepository、ArchiveTransaction 或任意路径写入能力。Session 只能写自己的 operation workspace。

## 4. Submission 类型

```ts
export type SessionSubmitResult =
  | InitSubmission
  | PlanningSubmission
  | PlaySubmission
  | ReviseSubmission;

export interface InitSubmission {
  /** 初始化产物。 */
  kind: 'init';

  /** world 身份。 */
  world: {
    id: string;
    title: string;
  };

  /** 初始 canon 完整内容。 */
  canon: CanonDocuments;
}

export interface PlanningSubmission {
  /** planning 产物。 */
  kind: 'planning';

  /** 要创建的 day。 */
  day: string;

  /** 用户当日意图。 */
  intent: string;

  /** 有稳定 id 的计划节点。 */
  beats: PlanBeat[];
}

export interface PlaySubmission {
  /** play 产物。 */
  kind: 'play';

  /** 当前 day。 */
  day: string;

  /** 行动摘要。 */
  summary: string;

  /** beat 的最终状态。 */
  beats: ResolvedPlanBeat[];

  /** 已完成事件。 */
  events: PlayEvent[];

  /** 完整 transcript。 */
  transcript: TranscriptEntry[];
}

export interface ReviseSubmission {
  /** revise 产物。 */
  kind: 'revise';

  /** 修订摘要。 */
  summary: string;

  /** 新 canon 完整快照。 */
  canon: CanonDocuments;
}
```

`CanonDocuments`、`PlanBeat`、`ResolvedPlanBeat`、`PlayEvent` 和 `TranscriptEntry` 必须在业务 schema 模块中定义，不能继续使用 `unknown` 或任意文件路径数组作为公开 submission。

Session 返回业务数据，不返回目标 phase、commit id、revision 或物理路径。

## 5. Session Status

```ts
export type SessionStatus =
  | 'none'
  | 'created'
  | 'waiting-input'
  | 'streaming'
  | 'loading'
  | 'ready-to-submit'
  | 'submitting'
  | 'completed'
  | 'cancelled'
  | 'failed';
```

| Status | 含义 | 允许操作 |
|--------|------|----------|
| `none` | 无 active Session | prepare 新 Session |
| `created` | 已构造，尚未完成 start | start/discard |
| `waiting-input` | 等待自然语言输入 | input、prepare submit、cancel |
| `streaming` | assistant 流式回复 | cancel、dispose |
| `loading` | 工具或后台任务 | cancel、dispose |
| `ready-to-submit` | 产物明确准备完成 | prepare submit、cancel |
| `submitting` | submission 已准备或正在发布 | complete/fail submit |
| `completed` | 已成功提交 | dispose |
| `cancelled` | 已取消 | dispose |
| `failed` | 会话失败 | cancel、dispose |

`ready-to-submit` 不触发自动提交。`waiting-input` 也允许显式 submit，由 Session 自行校验当前信息是否足够生成合法 submission。

## 6. Prepare 与 Activate

Session 创建分为两步：

```ts
export interface PreparedSession {
  /** 尚未对外可见的候选 Session。 */
  session: RuntimeSession;

  /** start 期间按顺序缓冲的事件。 */
  bufferedEvents: readonly SessionEvent[];
}

export interface SessionPreparationContext {
  /** Manager 注入到 SessionContext 的 Session id。 */
  sessionId: string;

  /** Session 进入后的只读 world 快照。 */
  world: Readonly<WorldSnapshot>;

  /** 此 Session 独占的隔离 workspace。 */
  workspace: SessionWorkspace;
}

export interface SessionManager {
  /** 构造并启动候选 Session，但不设置为 active。 */
  prepareSession(
    kind: SessionKind,
    preparation: SessionPreparationContext,
  ): Promise<PreparedSession>;

  /** 在 Runtime 业务边界完成后原子激活候选 Session并发布缓冲事件。 */
  activateSession(prepared: PreparedSession): void;

  /** 丢弃候选 Session 和全部缓冲事件。 */
  discardPreparedSession(prepared: PreparedSession): Promise<void>;
}
```

调用方不能直接传入 `SessionContext.emit`。Manager 根据 preparation 创建最终 `SessionContext` 并注入受控 `emit`，从而保证 start 期间的事件只能进入 `PreparedSession` 缓冲区。Session 返回的 `id` 和 `kind` 必须与 preparation/kind 一致，否则候选会话被丢弃。

Runtime 的创建流程：

1. 创建 archive operation/workspace；
2. `prepareSession()`；
3. 对非 init Session 发布 session-boundary commit；
4. 同步更新 Runtime world snapshot；
5. `activateSession()`；
6. 发出 world/session 事件。

任一步在第 3 步发布前失败，discard candidate，world 和 active Session 保持原样。第 3 步之后的内存激活不得包含可失败异步操作。

init Session 不发布 archive boundary，但仍通过同一 prepare/activate 流程保证启动事件不会提前泄漏。

## 7. 输入与后台任务

`sendInput()` 只在 `waiting-input` 接受输入：

```text
校验 Session
关闭当前 input request
记录 user message
创建 AbortController
启动 RuntimeSession.sendInput()
立即返回
```

输入 Promise 是后台任务，不持有 Runtime mutation lock。其事件更新 Session status 和消息。

同一 Session 同时最多一个输入后台任务。启动新任务前必须确认旧任务已结束；不能通过静默 abort 旧任务接受重叠输入。

## 8. Submit 协议

```ts
export interface PreparedSubmission {
  /** active Session id。 */
  sessionId: string;

  /** 业务产物。 */
  result: SessionSubmitResult;
}
```

1. Runtime 校验 phase、Session kind 和 status；
2. SessionManager 调用 `prepareSubmit()`；
3. Session status 进入 `submitting`，但仍保持 active；
4. Runtime 校验 result kind 和业务 schema；
5. Runtime 通过 ArchiveTransaction 发布；
6. 发布成功后调用 `completeSubmit()`；
7. 发 `session-ended(completed)` 并清除 active Session。

如果第 2 至第 5 步失败：

- 不清除 active Session；
- 调用 `failSubmit(error)`；
- 如果错误可重试，Session 回到 `waiting-input` 或 `ready-to-submit`；
- 如果错误表示 Session 产物无效或内部损坏，进入 `failed`；
- 具体分类必须通过稳定错误码确定。

Archive 发布成功后，业务提交已经完成。此时 `completeSubmit()` 或 `dispose()` 的清理错误只进入内部诊断，Runtime 仍必须清除 Session 并报告 command 成功，不能回滚 current pointer 或把已发布 submission 报告为失败。

## 9. Cancel 协议

1. 校验 active Session 可取消；
2. abort 当前输入后台任务并等待其结束；
3. Runtime 发布 cancel 对应的稳定 archive commit；init 不需要发布；
4. 调用 Session `cancel()`；
5. 发 `session-ended(cancelled)`；
6. 清除 active Session并执行最终 dispose。

archive cancel commit 发布前不得调用会让 Session 进入不可逆 cancelled 终态的方法。如果 archive 发布失败，Session 保持 active，Runtime 维持原会话 phase，并恢复到可再次 cancel 的状态。

发布成功后 world 已经处于稳定 phase。此时 Session `cancel()` 或 `dispose()` 的资源清理错误只进入内部诊断，不能回滚已发布 commit，也不能让 Runtime 重新暴露该 Session。

## 10. SessionEvent

```ts
export type SessionEvent =
  | { type: 'status-changed'; status: SessionStatus }
  | { type: 'message-added'; message: SessionMessage }
  | { type: 'assistant-message-start'; messageId: string }
  | { type: 'assistant-message-delta'; messageId: string; sequence: number; delta: string }
  | { type: 'assistant-message-end'; messageId: string }
  | { type: 'assistant-message-error'; messageId: string; error: RuntimeError }
  | { type: 'input-requested'; request: InputRequestSnapshot }
  | { type: 'input-closed'; requestId: string }
  | { type: 'loading-started'; loading: LoadingSnapshot }
  | { type: 'loading-updated'; loading: LoadingSnapshot }
  | { type: 'loading-ended'; loadingId: string };
```

SessionEvent 不能表达：

- world changed；
- command started/succeeded/failed；
- archive revision；
- session created/ended。

这些事件只能由 SessionManager 或 Runtime 在对应状态提交后产生。

## 11. Assistant 流式协议

正常回复：

```text
assistant-message-start(messageId)
assistant-message-delta(messageId, sequence, delta) * N
assistant-message-end(messageId)
```

失败回复：

```text
assistant-message-start(messageId)
assistant-message-delta(messageId, sequence, delta) * N
assistant-message-error(messageId, error)
```

规则：

- 同一回复始终复用同一个 message id；
- `sequence` 在单条 assistant 消息内从 1 开始严格递增，用于重复投递幂等；
- end/error 是互斥终点；
- 终点后到达的 delta 被忽略并记录内部诊断；
- 不在 end 后补发同内容 `message-added`；
- 非流式 provider 也转换为 start、单个 delta、end；
- error 保留已经收到的部分正文。

## 12. MessageStore

MessageStore 按 `sessionId` 和 `messageId` 聚合 SessionEvent：

- start 创建 streaming assistant message；
- delta 追加到同一条 message；
- end 改为 complete；
- error 改为 error；
- 重复 start/delta/end/error 必须幂等；delta 以 message id 和 sequence 去重；
- 返回只读副本；
- 保留策略按消息数与字符数配置；
- world 存档 transcript 由 SessionWorkspace/Submission 管理，与内存 MessageStore 分开。

## 13. AI 与工具失败

失败分为：

| 类型 | 结果 |
|------|------|
| 输入调用同步失败 | `sendInput` 返回失败，Session 根据错误决定 waiting-input 或 failed |
| assistant 开始前后台失败 | 添加 error message，Session 进入 failed |
| assistant 流式中失败 | 发 assistant-message-error，保留正文，Session 进入 failed |
| 可识别 AbortError | 不生成 AI failure；由 cancel/dispose 流程决定终态 |
| 工具调用失败 | loading 结束，产生结构化错误，Session 进入 failed 或可重试等待态 |

AI 失败不自动 submit、cancel 或改变 world phase。

## 14. Listener 与资源规则

- SessionManager listener 在状态提交后同步通知；
- 单个 listener 抛错不能阻止其它 listener；
- listener 异常进入内部诊断，不抛回 Session；
- unsubscribe 可重复调用；
- dispose 中止后台任务并等待结束；
- Session dispose 可重复调用；
- Runtime 完成或取消 Session 后必须调用 dispose；
- 任何后台 Promise 都必须被追踪，禁止未观察 rejection。

## 15. 验收

- prepare 阶段事件不会提前发布；
- archive boundary 失败时 candidate 被完整丢弃；
- 同时最多一个 active Session 和一个输入后台 task；
- sendInput 快速返回，cancel/dispose 可以 abort；
- submit 发布失败不会丢失 active Session；
- cancel 发布失败不会伪造稳定 world phase；
- SessionEvent 无法越权表达 Runtime/Archive 事件；
- 流式消息按 id 幂等聚合；
- AI 失败与 AbortError 行为区分；
- listener 异常和后台 rejection 均被隔离并测试。
