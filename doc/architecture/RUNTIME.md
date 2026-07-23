# Core Runtime

> **类型**：architecture  
> **状态**：implemented  
> **最后核对**：2026-07  
> **代码入口**：`packages/core/src/runtime/`

## 1. Runtime 职责

Runtime 负责：

- 启动时读取、校验和恢复 archive；
- 维护最近一次已提交的内存快照；
- 计算并暴露 Core command availability；
- 将自然语言输入转发给 active Session；
- 编排 command、Session 生命周期和 ArchiveTransaction；
- 保证单 Runtime mutation 串行；
- 分配 operation id；
- 在状态提交后发布语义事件；
- 释放 Session、后台任务和 Repository 资源。

Runtime 不负责：

- 实现状态转移规则；
- 让 Session 直接写正式存档；
- 解析输入中的命令语法；
- 生成展示文本；
- 自动选择、确认或提交 command。

## 2. 创建接口

Runtime 创建需要 archive 校验和可能的中断 Session 恢复，因此使用异步工厂：

```ts
export interface DayloomRuntimeOptions {
  /** world archive 根目录。 */
  worldRoot: string;

  /** Session 实现工厂。 */
  sessionFactory: SessionFactory;

  /** 存档 Repository；默认使用文件系统实现。 */
  archiveRepository?: ArchiveRepository;

  /** 业务存档操作端口；默认使用 Archive Operations。 */
  operations?: RuntimeOperations;

  /** 纯状态机；默认使用 coreStateMachine。 */
  stateMachine?: StateMachine;

  /** 可替换时钟。 */
  clock?: RuntimeClock;

  /** 可替换 id 生成器。 */
  idGenerator?: IdGenerator;

  /** 内部诊断 logger；默认静默。 */
  logger?: CoreLogger;
}

/** 创建、校验并恢复 Runtime。 */
export function createDayloomRuntime(
  options: DayloomRuntimeOptions,
): Promise<DayloomRuntime>;
```

构造函数不作为公共入口，避免暴露一个 archive 尚未读取完成的 Runtime。

## 3. Public API

```ts
export interface DayloomRuntime {
  /** 读取最近一次已提交的 Runtime 快照。 */
  getSnapshot(): RuntimeSnapshot;

  /** 读取全部 Core command 的当前可用性。 */
  getAvailableCommands(): readonly CommandAvailability[];

  /** 向 active Session 提交自然语言输入。 */
  sendInput(input: RuntimeInput): Promise<RuntimeResult>;

  /** 执行一个明确的 Core command。 */
  executeCommand(request: RuntimeCommandRequest): Promise<RuntimeResult>;

  /** 订阅调用之后产生的 RuntimeEvent。 */
  subscribe(listener: RuntimeEventListener): RuntimeUnsubscribe;

  /** 释放 Runtime 资源。 */
  dispose(): Promise<void>;
}
```

`getSnapshot()` 和 `getAvailableCommands()` 是只读操作。其它三个方法属于 mutation。

## 4. Snapshot

```ts
export interface RuntimeSnapshot {
  /** world 业务与存档快照。 */
  world: WorldSnapshot;

  /** active Session 交互快照。 */
  session: SessionSnapshot;
}

export interface WorldSnapshot {
  /** 当前业务阶段。 */
  phase: WorldPhase;

  /** world archive 根目录。 */
  worldRoot: string;

  /** world id；未初始化或 invalid 无法读取时为 null。 */
  worldId: string | null;

  /** current pointer revision；未初始化时为 0。 */
  revision: number;

  /** 当前 commit id；未初始化时为 null。 */
  commitId: string | null;

  /** 当前 day。 */
  day: string | null;

  /** 最近已结算 day。 */
  lastSettledDay: string | null;

  /** world 是否已完成首次发布。 */
  initialized: boolean;

  /** invalid 诊断；其它 phase 为 null。 */
  invalid: ArchiveInvalidState | null;
}

export interface SessionSnapshot {
  /** 是否存在 active Session。 */
  active: boolean;

  /** active Session id。 */
  id: string | null;

  /** active Session kind。 */
  kind: SessionKind | null;

  /** Session 交互状态。 */
  status: SessionStatus;

  /** 当前输入请求。 */
  input: InputRequestSnapshot | null;

  /** 当前 loading。 */
  loading: LoadingSnapshot | null;

  /** 最近 Session 错误。 */
  error: RuntimeError | null;
}
```

规则：

- Snapshot 不包含 messages；消息由 RuntimeEvent 和 MessageStore 聚合；
- Snapshot 不包含 commands；availability 通过独立接口计算；
- 返回值视为深度只读，不能成为修改 Runtime 的入口；
- `revision/commitId` 使调用方可以判断两个快照是否来自同一次 archive 发布；
- 进程内 `initializing` phase 可以保持 revision 0/commitId null。

## 5. Input 与 Command

```ts
export type OperationId = string;

export interface RuntimeInput {
  /** 可选 operation id；未提供时由 Runtime 生成。 */
  operationId?: OperationId;

  /** 自然语言输入。 */
  text: string;
}

export interface RuntimeCommandRequest {
  /** 可选 operation id；未提供时由 Runtime 生成。 */
  operationId?: OperationId;

  /** 明确的 Core command。 */
  command: RuntimeCommand;
}

export interface RuntimeResult {
  /** 本次 mutation 的关联 id。 */
  operationId: OperationId;

  /** mutation 是否完成其承诺的提交边界。 */
  ok: boolean;

  /** 失败时的稳定公共错误。 */
  error?: RuntimeError;
}
```

`sendInput().ok = true` 表示输入已接受且后台任务已启动，不表示 assistant 回复已经结束。

`executeCommand().ok = true` 表示该 command 要求的 archive/Session/内存提交边界已经完成。

## 6. Command 编排

### 6.1 开始 Session

适用于 `init/daily/play/revise`：

```text
acquire mutation lock
revalidate availability
emit command-started
begin archive operation/workspace
prepare Session and buffer events
stage/publish session-boundary commit (init skips archive publication)
commit Runtime world snapshot
activate Session
emit world-changed
emit session-created
flush buffered Session events
emit command-succeeded
release mutation lock
```

Archive 发布前失败时丢弃候选 Session。Archive 发布之后的内存激活必须是无异步失败步骤。

### 6.2 Submit

```text
acquire mutation lock
revalidate phase/kind/status/archive revision
emit command-started
prepare Session submission; keep Session active
validate submission schema and kind
begin ArchiveTransaction
stage immutable business revisions and target commit
publish current pointer
commit Runtime world snapshot
complete and dispose Session
emit world-changed
emit session-ended(completed)
emit command-succeeded
release mutation lock
```

Archive 发布前失败时调用 `failSubmit`，保留 active Session。Archive 发布后不能再把 command 报告为业务失败；后续 Session 清理异常进入内部诊断。

### 6.3 Cancel

```text
acquire mutation lock
revalidate cancel availability
emit command-started
abort and await Session background task
publish stable cancel commit (init skips archive publication)
commit Runtime world snapshot
cancel/dispose Session
emit world-changed
emit session-ended(cancelled)
emit command-succeeded
release mutation lock
```

### 6.4 Settle 与 Abandon-Day

```text
acquire mutation lock
revalidate phase/day/revision
emit command-started
emit loading-started
stage new day revision and target commit
publish current pointer
commit Runtime world snapshot
emit world-changed
emit loading-ended
emit command-succeeded
release mutation lock
```

失败时必须仍发 matching `loading-ended`，然后发 `command-failed`。

## 7. 并发与重入

Runtime 使用一个 mutation lock，不自动排队：

- `sendInput`、`executeCommand`、`dispose` 同时最多一个；
- 重叠 mutation 返回 `RUNTIME_BUSY`；
- read API 可读取最近一次完整提交的内存快照；
- mutation 内部不得提前替换公开快照，因此 read API 不会观察半完成状态；
- listener 重入 mutation 遵循同一 busy 规则；
- dispose 开始后拒绝新 mutation；
- archive publish 还使用 base revision compare-and-swap 防止跨实例覆盖。

输入后台 task 不持有 mutation lock，所以 streaming/loading 期间 cancel 或 dispose 可以获得 lock 并中断任务。

Submit 在 archive 发布期间持有 mutation lock。当前设计不允许 cancel/dispose 抢占 submitting；重叠调用返回 `RUNTIME_BUSY`。若要支持强制中断 submit，必须先为 ArchiveTransaction 定义可中断点和发布点后的不可取消规则。

## 8. Event Model

```ts
export type RuntimeEvent =
  | { type: 'world-changed'; operationId: OperationId; previous: WorldSnapshot; current: WorldSnapshot }
  | { type: 'session-created'; operationId: OperationId; sessionId: string; kind: SessionKind }
  | { type: 'session-status-changed'; sessionId: string; status: SessionStatus }
  | { type: 'session-ended'; operationId: OperationId; sessionId: string; status: 'completed' | 'cancelled' }
  | { type: 'message-added'; message: RuntimeMessage }
  | { type: 'assistant-message-start'; sessionId: string; messageId: string }
  | { type: 'assistant-message-delta'; sessionId: string; messageId: string; sequence: number; delta: string }
  | { type: 'assistant-message-end'; sessionId: string; messageId: string }
  | { type: 'assistant-message-error'; sessionId: string; messageId: string; error: RuntimeError }
  | { type: 'input-started'; operationId: OperationId; sessionId: string }
  | { type: 'input-succeeded'; operationId: OperationId; sessionId: string }
  | { type: 'input-failed'; operationId: OperationId; sessionId: string | null; error: RuntimeError }
  | { type: 'input-requested'; sessionId: string; request: InputRequestSnapshot }
  | { type: 'input-closed'; sessionId: string; requestId: string }
  | { type: 'loading-started'; operationId?: OperationId; sessionId?: string; loading: LoadingSnapshot }
  | { type: 'loading-updated'; operationId?: OperationId; sessionId?: string; loading: LoadingSnapshot }
  | { type: 'loading-ended'; operationId?: OperationId; sessionId?: string; loadingId: string }
  | { type: 'command-started'; operationId: OperationId; command: RuntimeCommand }
  | { type: 'command-succeeded'; operationId: OperationId; command: RuntimeCommand }
  | { type: 'command-failed'; operationId: OperationId; command: RuntimeCommand; error: RuntimeError }
  | { type: 'command-rejected'; operationId: OperationId; command: RuntimeCommand; error: RuntimeError };
```

`command-rejected` 使用完整稳定错误，而不是只有 reason 字符串。

## 9. Event 顺序

通用规则：

- 先提交内部状态，再发描述该状态的事件；
- 同一 operation 的事件保持发生顺序；
- unavailable command 只发 `command-rejected`，不发 `command-started`；
- started 后失败发 `command-failed`；
- world change event 必须携带完整 previous/current snapshot；
- operation id 贯穿 request、result 和所有 operation lifecycle event；
- Session 流式事件使用 session/message id，不强制继承最初 input operation id；
- subscribe 不回放历史，调用方需自行先读 snapshot；
- listener 抛错被隔离，不阻止其它 listener或 mutation。

事件发送期间 Runtime 状态已经提交，但 mutation lock 尚未释放。因此 listener 中读取 snapshot 能看到新状态，发起 mutation 则返回 `RUNTIME_BUSY`。

## 10. Error Model

```ts
export interface RuntimeError {
  /** 稳定机器码。 */
  code: RuntimeErrorCode;

  /** 人类可读诊断。 */
  message: string;

  /** 可序列化结构化详情。 */
  details?: JsonValue;
}
```

错误组：

| 分组 | Codes |
|------|-------|
| Runtime | `RUNTIME_BUSY`、`RUNTIME_CLOSED` |
| Command | `COMMAND_NOT_AVAILABLE`、`PHASE_MISMATCH` |
| Session | `SESSION_NOT_ACTIVE`、`SESSION_ALREADY_ACTIVE`、`SESSION_KIND_MISMATCH`、`SESSION_STATUS_MISMATCH`、`SESSION_FAILED` |
| Input/AI | `INPUT_NOT_EXPECTED`、`AI_CALL_FAILED`、`TASK_FAILED` |
| Archive | `ARCHIVE_MANIFEST_INVALID`、`ARCHIVE_POINTER_INVALID`、`ARCHIVE_COMMIT_MISSING`、`ARCHIVE_COMMIT_INVALID`、`ARCHIVE_REFERENCE_MISSING`、`ARCHIVE_REFERENCE_INVALID`、`ARCHIVE_SESSION_RECOVERY_FAILED`、`ARCHIVE_CONFLICT` |
| Operation | `SUBMISSION_INVALID`、`OPERATION_FAILED` |
| World | `WORLD_INVALID` |

公共错误不得包含原始 Error/cause、文件句柄、AbortSignal 或 provider 对象。原始异常只进入内部日志，并通过 operation id 关联。

## 11. Invalid Runtime

ArchiveReader 无法构造可信 snapshot 时，Runtime 仍可创建为 invalid：

- `getSnapshot()` 返回 phase `invalid` 和结构化 archive 诊断；
- `getAvailableCommands()` 全部 disabled；
- input/command 返回 `WORLD_INVALID`；
- subscribe 和 dispose 可用；
- 基础 Runtime 不自行猜测修复方案。

Manifest/current 同时不存在不是 invalid，而是 `uninitialized`。

## 12. Dispose

```text
acquire mutation lock
mark disposing
abort and await input background task
dispose active/prepared Session
abort unpublished ArchiveTransaction
release Repository resources
clear Session snapshot
mark closed
release mutation lock
```

dispose 后：

- 最后一次 world snapshot 仍可读取；
- Session snapshot 为 none；
- command availability 全部 disabled，reason 为 runtime closed；
- 新 mutation 返回 `RUNTIME_CLOSED`；
- 重复 dispose 应安全返回，不抛 `RUNTIME_CLOSED`。

## 13. Runtime 内部依赖

```ts
export interface RuntimeDependencies {
  /** 纯业务状态机。 */
  stateMachine: StateMachine;

  /** active Session 生命周期。 */
  sessionManager: SessionManager;

  /** 正式存档读取与 transaction。 */
  archive: ArchiveRepository;

  /** Runtime 时间来源。 */
  clock: RuntimeClock;

  /** operation/session/message id 来源。 */
  ids: IdGenerator;

  /** 内部错误和 listener 异常记录。 */
  logger: CoreLogger;
}
```

Runtime 不在内部直接调用 `fs`、环境变量或具体 AI provider。

## 14. 验收

- 异步创建不会暴露未完成初始化的 Runtime；
- read API 永远只看到完整内存提交；
- availability 与执行时校验一致；
- Session 创建、submit、cancel 与 archive 发布边界一致；
- submit 发布失败保留 active Session；
- command/input/result/event operation id 可关联；
- loading 事件在失败路径也成对；
- listener 异常不影响 Runtime；
- Runtime lock 与 archive conflict 分别有测试；
- invalid Runtime 保持可读、不可修改；
- dispose 中止后台任务，重复调用安全；
- 公共错误可 JSON 序列化。
