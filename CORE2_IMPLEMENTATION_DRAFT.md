# Dayloom Core2 实现冻结草案

> 状态：Implementation Freeze / 可直接实施  
> 日期：2026-08-13  
> 目标包：`@dayloom/core2`

## 1. 实施目标

建立一个独立、最小、只有一套语义的新 Core：

```text
@dayloom/core2
= Archive V2 only
= persistent Promptpile Conversation per Session
= promptpile-react execution
= Dayloom Session / World application lifecycle
```

停止继续在现有 `@dayloom/core` 上叠加 Archive V2、Promptpile React、Conversation compression 的兼容改造。

旧 `core` / `core-old` 只作为产品行为参考，不是 `core2` 的 API、类型或内部架构兼容目标。

Core2 的完成链路只有：

```text
World
→ Session
→ Conversation
→ Promptpile React
→ Submission
→ Archive Protocol validation
→ Publication
→ World
```

任何不能直接服务这条链路的设计默认不进入 MVP。

---

## 2. 关于现有 TUI 的边界

**TUI 不属于本草案的实施任务。**

本草案只构建 `@dayloom/core2`。不修改、不迁移、不重写：

```text
packages/tui
TuiRuntimeDriver
TuiDriverState
TUI page / widget / loading state
任何 TUI adapter
```

当前 TUI 只提供一个已经存在的**交互模式参考**。Core2 的 public application interface 必须能够自然表达以下能力：

```text
读取当前 World 与可用业务能力
→ 开始一个 Session
→ 多轮发送自然语言输入
→ 实时接收 Final 文本增量
→ submit 或 cancel
→ Session 结束后读取新的 World
```

这只是 Core2 的 capability requirement，不是要求 Core2 复刻 TUI 接口。

禁止反向设计：

```text
错误：
TUI 当前需要某字段 / event
→ Core2 public API 增加该 TUI-specific 字段 / event

正确：
Core2 暴露 application semantics
→ 任意 consumer 自行决定如何呈现
```

因此 Core2 public API 中不得出现：

```text
HubPage
TuiState
TuiMessage
selectedAction
loadingLabel
terminal component
slash command
widget state
```

也不得 import `@dayloom/tui` 或 `@dayloom/tui-old`。

---

## 3. Ownership 冻结

### Archive Protocol

`@dayloom/archive-protocol` owns persisted-data correctness。

它是 Core2 唯一的 Archive / World 持久化协议来源，负责：

- strict parsing；
- document path correctness；
- canonical tree encoding；
- object identity；
- staged PUT / DELETE algebra；
- relation validation；
- recovery classification；
- archive-relative layout vocabulary。

Core2 不重新定义第二套持久化 protocol DTO。

允许 Core2 建立 application read model，但 protocol object 在持久化边界始终 authoritative。

### Promptpile ecosystem

Promptpile ecosystem owns Conversation artifact I/O and agent orchestration。

Core2 只拥有 Conversation 的：

```text
Session association
identity / directory location
lifetime
```

Core2 不实现 Promptpile Conversation 文件格式，不直接制造或重写 Promptpile message / receipt artifacts。

Promptpile / Promptpile React 负责：

```text
user append
assistant artifact publication
Conversation OCC / receipt semantics
Thought → Observe → Check → Final orchestration
```

Core2 不重新实现 React FSM。

### Core2

Core2 owns：

```text
business legality
Session lifecycle
Promptpile React process invocation
untrusted model result validation
World mutation construction
World publication
public application state / events
```

模型输出永远不能绕过 Core2 business validation 与 Archive Protocol validation 直接成为 Published World。

### Consumer

Core2 consumer owns presentation / interaction projection。

这属于 Core2 包边界之外，不是本草案实施项。

---

## 4. 明确非目标

Core2 MVP 不实现：

```text
@dayloom/core public API compatibility
旧 RuntimeSnapshot / RuntimeEvent / RuntimeCommand compatibility
旧 MessageStore / ConversationClient compatibility
TUI adapter 或 TUI migration
旧 Archive runtime
Archive V1 / V2 双支持
legacy archive import / migration
并发 Session
并发 agent turn
并发 World mutation
operation queue / scheduler
agent turn 自动 retry
active Session crash recovery
interrupted agent turn resume
promptpile-compress
MCP tools
semantic search
通用 AgentRuntime provider/plugin layer
ConversationMaintenance abstraction
多 provider presentation API
```

这些能力不存在真实 MVP 需求时，不提前设计接口。

---

## 5. 依赖与架构 guard

MVP direct dependencies：

```text
@dayloom/core2
├── @dayloom/archive-protocol
├── promptpile-react
└── Node.js >= 20
```

源码禁止出现：

```text
@dayloom/core
@dayloom/core-old
@dayloom/tui
@dayloom/tui-old
@dayloom/archive-protocol/src/
@dayloom/archive-protocol/dist/
promptpile-react/src/
promptpile-react/dist/
```

允许使用：

```text
@dayloom/archive-protocol
@dayloom/archive-protocol/path
@dayloom/archive-protocol/tree
@dayloom/archive-protocol/staging
```

Promptpile React 只通过 packaged executable 与 public Agent Event Protocol 集成。

在 `core2` package 中加入一个简单静态 architecture guard 检查以上规则。

---

## 6. MVP 只实现 Play Session

Core2 第一条 vertical slice 只实现：

```text
SessionKind = 'play'
```

`init`、`planning`、`revise` 不进入 MVP。

Play 的业务 legality 冻结为：

```text
startSession('play') allowed iff:
- Archive V2 World 可正常读取；
- current World phase == 'planned'；
- current World day != null；
- 当前没有 active Session；
- Core2 当前没有正在执行的 mutation。
```

Play Session 开始时：

- pin 当前 `current` 对应的 revision / commit / tree base；
- 创建 Session；
- 创建一个磁盘 Conversation directory；
- **不发布新的 World**；
- current World 仍然保持 `planned`。

Session 是运行时 overlay，不通过把 World phase 改成 `playing` 来表示。

Play submit 成功后：

```text
planned → awaiting-settle
```

Play cancel 或 Play failure：

```text
World 保持原来的 planned revision 不变
```

---

## 7. 单执行流状态机

Core2 明确不支持并发。

Public application state 只有以下运行状态：

```text
idle
ready
running
submitting
```

含义：

```text
idle
= 没有 active Session

ready
= active Play Session，可 send / submit / cancel

running
= 正在执行一次普通 Promptpile React turn

submitting
= 正在执行 submission run / validation / publication
```

状态转换冻结为：

```text
idle
  startSession('play') → ready

ready
  send(non-empty text) → running
  submit()             → submitting
  cancel()             → idle

running
  agent success → ready
  agent failure → idle, World unchanged

submitting
  success → idle, new World published
  failure → idle, World unchanged
```

不支持并发调用。

当状态为 `running` 或 `submitting` 时，再调用：

```text
startSession
send
submit
cancel
```

统一返回 `BUSY`。

因此 MVP 不实现“边生成边 cancel”。`cancel()` 只在 `ready` 状态合法。

`dispose()` 是资源生命周期清理，不属于业务 operation；如果 dispose 时存在 child process，可以直接终止 child process。

---

## 8. Public API V0 冻结

MVP public surface 冻结为：

```ts
export interface CreateDayloomCoreOptions {
  worldRoot: string;
  reactConfigPath: string;
}

export interface DayloomCore {
  getState(): CoreState;
  subscribe(listener: (event: CoreEvent) => void): () => void;

  startSession(kind: 'play'): Promise<CoreResult>;
  send(text: string): Promise<CoreResult>;
  submit(): Promise<CoreResult>;
  cancel(): Promise<CoreResult>;

  dispose(): Promise<void>;
}

export function createDayloomCore(
  options: CreateDayloomCoreOptions,
): Promise<DayloomCore>;
```

这里没有：

```text
executeCommand
RuntimeCommand
operationId
MessageStore
ConversationClient
TUI action id
```

### Result

所有 application mutation 使用一套结果模型：

```ts
export type CoreResult =
  | { ok: true }
  | { ok: false; error: CoreError };

export interface CoreError {
  code:
    | 'NOT_AVAILABLE'
    | 'BUSY'
    | 'INVALID_INPUT'
    | 'WORLD_INVALID'
    | 'AGENT_FAILED'
    | 'SUBMISSION_INVALID'
    | 'WORLD_CONFLICT'
    | 'DISPOSED'
    | 'INTERNAL_ERROR';
  message: string;
}
```

Public mutation 不把预期失败通过 throw 暴露。

`createDayloomCore()` 初始化失败可以 reject，因为此时尚不存在可用 Core instance。

---

## 9. Public State V0 冻结

Core2 暴露 application state，不暴露 presentation state。

```ts
export type CoreSessionStatus = 'ready' | 'running' | 'submitting';

export interface CoreWorldView {
  status: 'ready' | 'invalid';
  worldId: string | null;
  title: string | null;
  revision: string | null;
  commitId: string | null;
  phase: 'idle' | 'planned' | 'awaiting-settle' | null;
  day: string | null;
}

export interface CoreState {
  world: CoreWorldView;
  session: null | {
    id: string;
    kind: 'play';
    status: CoreSessionStatus;
  };
  capabilities: {
    startSessions: readonly ('play')[];
    send: boolean;
    submit: boolean;
    cancel: boolean;
  };
}
```

`capabilities` 由 Core2 business legality 计算。

Consumer 不应该自己根据 `world.phase` 复制 Core2 业务规则。

但 `capabilities` 仍然是通用 application capability，不包含任何 UI layout / command label / selected state。

---

## 10. Public Event V0 冻结

Core2 只有一套 public event vocabulary：

```ts
export type CoreEvent =
  | { type: 'state.changed'; state: CoreState }
  | { type: 'output.delta'; sessionId: string; text: string };
```

语义：

- 每次 public `CoreState` 发生变化后 emit 一次 `state.changed`；
- Promptpile React 的 `final.delta` 按顺序映射为 `output.delta`；
- `output.delta` 只包含用户可见 Final 文本；
- 不暴露 Thought / Observe / Check 隐藏内容；
- 不暴露 Promptpile event 原始 shape。

`subscribe()` 只订阅调用之后的新事件；初始状态通过 `getState()` 获取。

`send()` / `submit()` Promise 只在对应 operation terminal 后 resolve。

Event listener 的调用顺序与 Core2 内部状态转换顺序一致；同一个 Core instance 内不并发 dispatch events。

---

## 11. Session workspace 与 Conversation

MVP 不做 active Session crash recovery，因此不建立 Session journal / checkpoint system。

但同一个 Session 的所有 turns 必须复用同一个磁盘 Conversation。

Runtime-private layout 冻结为：

```text
<worldRoot>/.core2/
└── sessions/
    └── <sessionId>/
        └── conversation/
```

规则：

- `.core2/` 不属于 Archive Protocol World tree；
- Session start 创建唯一 `sessionId` 与 Conversation directory；
- 同一个 Session 的每次 `send()` 和 `submit()` 都使用同一个 directory；
- Core2 不把 Conversation 内容复制成自己的 `messages[]` authority；
- Session terminal 后 workspace 可以保留；MVP 不实现自动清理；
- process restart 后不恢复 active Session；遗留 workspace 只视为诊断 artifact。

这里“persistent Conversation”的定义只有：

```text
Conversation 在整个 Session 生命周期内是同一个磁盘 Conversation，
而不是每个 turn 创建临时 Conversation 并重放完整历史。
```

---

## 12. Promptpile React 调用契约

`PromptpileReactRunner` 是 Core2 私有 infrastructure，不作为 public plugin interface。

### 普通 user turn

Core2 对 `send(text)` 使用：

```text
promptpile-react
  --config <reactConfigPath>
  --output-dir <conversationDir>
  --input
  --continue
  --output-format stream-json
```

Core2 将 `text` 写入 child stdin。

要求：

- `text.trim()` 必须非空，否则 `INVALID_INPUT`；
- `--input` 由 Promptpile React append user artifact；
- `--continue` 允许 Thought / Final 的 assistant artifact 写回该 Conversation；
- stdout 只解析 Agent Event Protocol JSONL；
- stderr 仅作为 diagnostics；
- `final.delta` 映射为 public `output.delta`；
- `session.completed` + exit code 0 才算 turn success；
- malformed JSONL、`session.failed`、非零退出均为 `AGENT_FAILED`。

Promptpile React 已成功 append user artifact 后如果后续 agent 失败，Core2 不回滚 Conversation，也不 retry；当前 Session 直接失败并结束。

### Submit run

`submit()` 复用同一个 Conversation 和同一条 React invocation path：

```text
promptpile-react
  --config <reactConfigPath>
  --output-dir <conversationDir>
  --input
  --continue
  --output-format stream-json
```

但 stdin 不是 presentation command，而是 Core2 内部生成的 **Play submission request**。

该 request 明确要求 Final 只输出 `PlaySubmissionV1` JSON。

这样 MVP 不需要第二套 provider API、第二套 React runner 或 submission-specific orchestration framework。

---

## 13. PlaySubmissionV1 冻结

Play submit 的模型输出不是 World DTO，而是一个受限、untrusted 的业务结果。

Final 必须是一个 JSON object，严格满足：

```ts
export interface PlaySubmissionV1 {
  version: 1;
  summary: string;
  beats: Array<{
    id: string;
    status: 'pending' | 'completed' | 'skipped';
    eventId: string | null;
  }>;
  events: Array<{
    id: string;
    beatId: string | null;
    userInput: string;
    assistantOutput: string;
  }>;
}
```

Strict parser 规则：

- 顶层必须是 object；
- `version` 必须严格等于 `1`；
- 所有 required fields 必须存在；
- unknown fields 拒绝；
- `summary` 必须是非空 string；
- arrays 中每个 object unknown fields 拒绝；
- `id` 必须非空；
- status 只能是三个枚举值；
- `eventId` / `beatId` 只能是 string 或 null；
- malformed JSON 或任一字段不合法 → `SUBMISSION_INVALID`。

Core2 不接受 markdown code fence 包裹的 JSON；Final 必须直接是 JSON 文本。

`day` 不由模型提交。

当前 day 来自 Session pinned World，因此模型无权选择或改变提交目标 day。

MVP 不把完整 Conversation transcript 再复制进 World documents；Conversation 是 AI interaction history authority。

---

## 14. PlaySubmission → World documents

Validated `PlaySubmissionV1` 只产生两个 Dayloom World documents：

```text
days/<currentDay>/play.json
days/<currentDay>/summary.md
```

其中：

`play.json` UTF-8 JSON 内容：

```json
{
  "version": 1,
  "beats": [],
  "events": []
}
```

实际 `beats` / `events` 来自 validated submission。

要求：

- canonical JSON 生成规则由 Core2 固定；
- 不把 model 原始 JSON bytes 直接作为 persisted bytes；
- `summary.md` 内容为 validated `summary`，结尾保证一个 LF；
- document path 必须通过 `@dayloom/archive-protocol` public path validation / normalization；
- 当前 Play submit 不允许覆盖已经 published 的同 day play / summary documents。

成功 publication 的 control target：

```text
phase = awaiting-settle
day   = pinned current day
```

其它 control metadata 沿用当前 World 的合法值。

---

## 15. Publication 算法冻结

Play Session start 时记录：

```text
pinned revision
pinned commit id
pinned root/tree base
```

`submit()` 在任何 publication 之前必须完成：

```text
React submission run success
→ PlaySubmissionV1 strict parse
→ business validation
→ build staged PUTs
→ Archive Protocol candidate validation
```

随后 publication：

```text
取得 exclusive publication ownership
→ 重新读取 current
→ 要求 current 仍等于 Session pinned base
→ 构造并验证完整 immutable target graph
→ 写入 immutable target objects
→ current.json atomic replacement 作为最后 visibility step
```

如果 pinned base 已变化：

```text
WORLD_CONFLICT
```

Core2 不 rebase、不 merge、不 retry。

任何失败都必须满足：

```text
没有新的 current World 可见
```

只有 `current.json` 最终 atomic replacement 成功后，submit 才返回 `{ ok: true }`。

成功后重新从 Archive V2 current 读取 `CoreWorldView`，然后进入 `idle`。

---

## 16. Cancel 与 Failure

### cancel

`cancel()` 只允许在 `ready`。

行为：

```text
ready
→ discard active Session in memory
→ World unchanged
→ idle
```

MVP 不删除 Conversation workspace，也不对 Promptpile artifacts 做 rollback。

### 普通 agent failure

```text
running
→ Session terminal failure
→ World unchanged
→ active Session removed
→ idle
→ send() returns AGENT_FAILED
```

不自动 retry，不 resume。

### submission failure

包括：

```text
agent failed
invalid submission
business validation failed
protocol validation failed
publication conflict
publication I/O failed
```

统一规则：

```text
World 不产生部分 publication
active Session 结束
Core2 回到 idle
submit() 返回对应 CoreError
```

---

## 17. 最小源码结构

首版保持：

```text
packages/core2/
├── package.json
├── scripts/
│   └── check-architecture.mjs
├── src/
│   ├── index.ts
│   ├── core.ts
│   ├── state.ts
│   ├── events.ts
│   ├── errors.ts
│   ├── world/
│   │   ├── read.ts
│   │   └── publish.ts
│   ├── session/
│   │   └── play.ts
│   └── promptpile/
│       └── react-runner.ts
└── test/
```

不要提前创建：

```text
provider/
adapters/
commands/
plugins/
maintenance/
scheduler/
compat/
tui/
```

如果真实代码增长证明需要拆分，再拆。

---

## 18. 实施顺序

### Step 0 — package skeleton

建立 `packages/core2`：

```text
Node >= 20
@dayloom/archive-protocol dependency
promptpile-react dependency
architecture guard
```

### Step 1 — World read + CoreState

完成：

```text
worldRoot
→ read Archive V2 current
→ protocol validation
→ CoreWorldView
→ capabilities.startSessions
```

证明 planned + current day 时 `play` 可开始。

### Step 2 — Session + Conversation

完成：

```text
startSession('play')
→ pin World base
→ create session id
→ create persistent conversation directory
→ ready
```

不做 World publication。

### Step 3 — 普通 React turn

完成：

```text
send
→ promptpile-react --input --continue --output-format stream-json
→ output.delta
→ ready
```

证明连续两个 `send()` 使用相同 Conversation directory。

### Step 4 — PlaySubmissionV1

实现：

```text
submission request
→ React Final
→ strict JSON parser
→ validated PlaySubmissionV1
```

### Step 5 — Publication

实现：

```text
PlaySubmissionV1
→ play.json + summary.md
→ protocol candidate
→ pinned-base recheck
→ exclusive publication
→ atomic current replacement
→ awaiting-settle World
```

同时完成 `cancel()` 与 terminal failure semantics。

到这里 Core2 MVP 闭环。

**没有 TUI adapter Step。**

---

## 19. Acceptance tests

测试只针对 `@dayloom/core2` public contract 与 infrastructure boundaries。

必须有：

```text
core2-reads-valid-archive-v2-world
core2-rejects-invalid-world
core2-play-available-only-for-planned-world-with-day
core2-start-play-does-not-publish-world
core2-rejects-second-mutation-while-busy
core2-rejects-empty-send
core2-two-turns-share-one-conversation
core2-streams-only-final-deltas
core2-agent-failure-ends-session-without-world-change
core2-cancel-ready-session-without-world-change
core2-rejects-cancel-while-running
core2-submit-uses-same-conversation
core2-parses-valid-play-submission-v1
core2-rejects-malformed-play-submission
core2-rejects-unknown-submission-fields
core2-does-not-persist-model-raw-json-bytes
core2-submit-writes-play-and-summary-documents
core2-submit-publishes-awaiting-settle-world
core2-submit-publishes-current-exactly-once
core2-conflicting-pinned-base-fails-closed
core2-submit-failure-leaves-current-unchanged
core2-terminal-session-cannot-advance
core2-architecture-guard-rejects-legacy-core-and-tui-imports
```

不加入任何 TUI component、driver、adapter 或 snapshot compatibility test。

“现有 TUI 的交互模式可被满足”通过 Core2 capability 本身得到证明：

```text
state/capability read
+ startSession
+ send
+ output.delta
+ submit/cancel
+ refreshed World state
```

不需要在 Core2 项目中实现 TUI 才能证明这一点。

---

## 20. Definition of Done

Core2 MVP 完成必须同时满足：

1. `packages/core2` 不依赖 legacy Core 或任何 TUI package；
2. 只支持 Archive V2；
3. Play legality 完全由 Core2 决定；
4. start Play 不发布 World；
5. 一个 Session 的所有 turns 共用同一个 Promptpile Conversation；
6. Core2 不实现 Promptpile Conversation artifact 格式；
7. AI execution 只通过 packaged `promptpile-react` + public Agent Event Protocol；
8. public event 只暴露 application state change 与 Final delta；
9. Core2 不支持并发；busy mutation 直接拒绝；
10. `PlaySubmissionV1` strict parse 后才能产生 World mutation；
11. model 不能指定 current day 或直接生成 protocol objects；
12. submit 通过 protocol validation 与 pinned-base recheck；
13. `current.json` atomic replacement 是最终 visibility step；
14. submit 成功后 World 从 `planned` 进入 `awaiting-settle`；
15. cancel / agent failure / submit failure 均不产生新的 current World；
16. MVP 不包含 TUI adapter、Compress、MCP、migration、plugin system 或 recovery framework。

---

## 21. 最终原则

```text
Protocol owns persisted-data correctness.
Promptpile owns Conversation artifacts and agent orchestration.
Core2 owns business legality, Session lifecycle and World publication.
Consumers own presentation.
```

以及：

```text
Core2 必须能表达现有产品需要的交互能力，
但绝不围绕某个现有 consumer 的接口形状设计。
```

判断一个接口是否应该进入 Core2 的标准只有：

> 如果没有 TUI，未来换成 Web、GUI、CLI 或测试程序，这个接口是否仍然是自然的 Dayloom application capability？

如果答案是否定的，该接口不属于 Core2。
