# Dayloom Core2 完整功能实现草案

> Status: **Design Draft / 待评审**  
> Date: 2026-08-14  
> Target: `@dayloom/core2`  
> Baseline: current `dev` + restored `@dayloom/tui` remains on `@dayloom/core` until parity is proven

本文重新定义 Core2 的完成标准。

此前 `CORE2_IMPLEMENTATION_DRAFT.md` 把 Core2 收缩为 Play-only MVP，并进一步让 TUI 迁就这个残缺能力集。这个范围不满足“替代 `@dayloom/core`、保持 Dayloom 已有产品能力”的目标。

本草案要求：

```text
Core2 可以重新设计 API、状态表达和内部实现，
但不能无意降低 @dayloom/core 已有的用户可见业务能力。
```

Core2 的最终目标不是兼容旧 Runtime API，而是以更小、更清晰的边界完整表达 Dayloom 生命周期。

---

## 1. 完整产品主线

Core2 完成后，空 World 到持续运行必须形成一条无死路闭环：

```text
uninitialized
    ↓ Init Session
idle
    ↓ Planning Session
planned
    ↓ Play Session
awaiting-settle
    ↓ Settle
idle
    ↓ Planning Session
planned
    ↓ ...
```

同时保留两个必要旁路：

```text
idle
  ↓ Revise Session
idle
```

以及：

```text
planned / awaiting-settle
  ↓ Abandon Day
idle
```

完整 application capability 至少包括：

```text
Init
Planning / Daily
Play
Settle
Revise
Abandon Day
Submit
Cancel
Uninitialized World
Invalid World diagnostics
```

这些是产品语义 parity；不是旧 API parity。

---

## 2. 功能 parity 基线

现有 `@dayloom/core` 的正式业务能力包括：

```text
world commands:
  init
  daily
  play
  settle
  revise
  abandon-day

session commands:
  submit
  cancel

session kinds:
  init
  planning
  play
  revise
```

旧 Core 还把：

```text
uninitialized
invalid
```

视为正常可展示的 application states，而不是只能通过 constructor exception 表达的状态。

Core2 必须恢复上述产品能力，但不要求复制：

```text
DayloomRuntime
RuntimeSnapshot
RuntimeEvent
executeCommand()
getAvailableCommands()
SessionManager
StateMachine
RuntimeOperations
旧 Archive DTO
旧目录结构
```

---

## 3. 设计原则

### 3.1 功能完整，不复制旧架构

目标是：

```text
旧 Core 的业务覆盖面
+
Core2 已经验证正确的新边界
```

不是：

```text
把旧 Core 重写一遍
```

### 3.2 Persistent state 与 transient state 分离

Archive Protocol V2 继续只拥有 Published World 的稳定 phase：

```text
idle
planned
awaiting-settle
```

Core2 不把以下瞬态流程塞进 Archive commit phase：

```text
initializing
planning
playing
revising
```

这些只由 active Session 表达。

同样：

```text
uninitialized
invalid
```

不是 Archive commit phase，而是 Core2 对“Published World 是否存在 / 是否有效”的 application read state。

### 3.3 模型只提供业务内容，不拥有结构身份

Core2 尽量减少模型对稳定身份的控制：

```text
worldId      → Core2 生成
DayId        → Core2 生成
revision     → Core2 生成
commitId     → Core2 生成
operationId  → Core2 生成
```

模型只输出需要理解自然语言才能得到的业务内容。

### 3.4 Consumer-neutral

Core2 public API 只表达 application semantics。

TUI、Web、CLI、GUI 都应自然消费同一 API。

### 3.5 单执行流

Core2 继续不支持并发业务操作。

不引入：

```text
queue
scheduler
actor system
recovery coordinator
background worker
retry framework
```

跨 Core instance 的 World publication conflict 仍必须被检测。

---

## 4. Ownership

```text
Archive Protocol
  owns persisted-data correctness

Promptpile
  owns Conversation artifacts

promptpile-compress
  owns Conversation compression / restore lifecycle

Promptpile React
  owns agent orchestration

Core2
  owns Dayloom business legality
  owns World application read model
  owns Session lifecycle
  owns submission validation
  owns business document construction
  owns publication policy
  owns public state / capabilities / events

Consumers
  own presentation
```

Core2 不再拥有第二套 Archive parser，也不直接编辑 Promptpile message artifacts。

---

## 5. Public World state

用 discriminated union 明确区分三种真实状态：

```ts
export type CoreWorldState =
  | {
      status: 'uninitialized';
    }
  | {
      status: 'invalid';
      error: {
        code: 'WORLD_INVALID';
        message: string;
      };
    }
  | {
      status: 'published';
      worldId: string;
      title: string;
      revision: number;
      commitId: string;
      phase: 'idle' | 'planned' | 'awaiting-settle';
      day: string | null;
      lastSettledDay: string | null;
    };
```

### 5.1 `uninitialized`

表示 `worldRoot` 尚未形成 Published Archive V2 World。

它是正常业务状态：

```text
revision 不存在
commit 不存在
manifest 不存在
Init 可用
```

### 5.2 `invalid`

表示 root 中存在看起来像 Published World 的数据，但 graph / required Dayloom profile 无法验证。

规则：

```text
Core instance 可以创建
所有 mutation capabilities = false
consumer 可以展示 error
Core2 不自动 repair / overwrite
```

### 5.3 `published`

表示 `manifest → current → commit → tree → required blobs` 已验证。

---

## 6. Core2 Published World invariants

Core2 在 Archive Protocol 之上定义更严格的 Dayloom application profile。

### 6.1 Canon

任何 Published World 必须存在：

```text
canon/premise.md
canon/rules.md
canon/style.md
canon/user-role.md
```

这些路径的历史版本由 immutable commit/tree 自然保存，不额外创建 canon revision framework。

### 6.2 Day ID

Core2 创建的 Day ID 固定：

```text
day_0001
day_0002
day_0003
...
```

规则：

```ts
/^day_[0-9]{4}$/
```

Core2 不让模型决定 Day ID。

下一天：

```text
lastSettledDay = null       → day_0001
lastSettledDay = day_0001   → day_0002
...
```

超过 `day_9999` → `INTERNAL_ERROR`，不静默改变格式。

### 6.3 Day documents

Core2 当前拥有：

```text
days/<day>/plan.json
days/<day>/play.json
days/<day>/summary.md
```

### 6.4 Stable phase invariants

#### idle

```text
phase = idle
day = null
```

如果 `lastSettledDay != null`，对应已结算日必须至少存在：

```text
plan.json
play.json
summary.md
```

#### planned

```text
phase = planned
day = day_NNNN
```

当前 day 必须：

```text
plan.json exists
play.json absent
summary.md absent
```

#### awaiting-settle

```text
phase = awaiting-settle
day = day_NNNN
```

当前 day 必须：

```text
plan.json exists
play.json exists
summary.md exists
```

Core2 不要求 root tree 只能包含这些文件；其它 consumer/domain-owned documents 可以存在，但 Core2 只修改自己拥有的路径。

---

## 7. Public Session state

```ts
export type CoreSessionKind =
  | 'init'
  | 'planning'
  | 'play'
  | 'revise';

export type CoreSessionStatus =
  | 'ready'
  | 'running'
  | 'submitting';

export interface CoreState {
  world: CoreWorldState;
  session: null | {
    id: string;
    kind: CoreSessionKind;
    status: CoreSessionStatus;
  };
  capabilities: {
    startSessions: readonly CoreSessionKind[];
    settle: boolean;
    abandonDay: boolean;
    send: boolean;
    submit: boolean;
    cancel: boolean;
  };
}
```

不公开：

```text
initializing/planning/playing/revising pseudo world phases
page
widget
loading label
selected action
TUI-specific command name
```

---

## 8. Public API

保留 Core2 当前“小而直接”的 application style：

```ts
export interface DayloomCore {
  getState(): CoreState;

  subscribe(
    listener: (event: CoreEvent) => void,
  ): () => void;

  startSession(
    kind: CoreSessionKind,
  ): Promise<CoreResult>;

  send(text: string): Promise<CoreResult>;

  submit(): Promise<CoreResult>;

  cancel(): Promise<CoreResult>;

  settle(): Promise<CoreResult>;

  abandonDay(): Promise<CoreResult>;

  dispose(): Promise<void>;
}
```

不引入：

```text
executeCommand(command)
command bus
RuntimeCommand registry
backend interface
compatibility adapter
```

四个 conversational flows 共用 `startSession(kind)`；两个 deterministic World mutations 用明确方法表达。

---

## 9. Capability rules

没有 active Session 且没有 mutation 时：

```text
world.uninitialized
  startSessions = ['init']

world.invalid
  startSessions = []
  settle = false
  abandonDay = false

published idle
  startSessions = ['planning', 'revise']

published planned
  startSessions = ['play']
  abandonDay = true

published awaiting-settle
  settle = true
  abandonDay = true
```

有 active Session 时：

```text
startSessions = []
settle = false
abandonDay = false
```

Session：

```text
ready
  send = true
  submit = true
  cancel = true

running / submitting
  send = false
  submit = false
  cancel = false
```

Core2 v1 不实现运行中 cancel。

---

## 10. 完整 lifecycle

### 10.1 Init

```text
uninitialized
  → startSession('init')
  → ready
  → send*
  → submit
  → first Archive publication
  → published idle
```

Cancel：

```text
init ready
  → cancel
  → uninitialized
```

没有 Published World mutation。

### 10.2 Planning

```text
idle
  → startSession('planning')
  → ready
  → send*
  → submit
  → write next day plan
  → planned
```

Cancel：

```text
planning ready
  → cancel
  → idle
```

### 10.3 Play

保持当前已验证链路：

```text
planned
  → startSession('play')
  → ready
  → send*
  → submit
  → play.json + summary.md
  → awaiting-settle
```

Cancel：

```text
play ready
  → cancel
  → planned
```

### 10.4 Revise

```text
idle
  → startSession('revise')
  → ready
  → send*
  → submit
  → replace current canon documents in new immutable root tree
  → idle
```

Cancel：

```text
revise ready
  → cancel
  → idle
```

### 10.5 Settle

Settle 是 deterministic World mutation，不启动 AI Session。

```text
awaiting-settle(day_000N)
  → settle()
  → verify current day plan/play/summary
  → publish new commit
       phase = idle
       day = null
       lastSettledDay = day_000N
  → idle
```

Day content不需要复制或重写；commit history + existing day docs 已经是 settled truth。

### 10.6 Abandon Day

同样是 deterministic World mutation：

```text
planned / awaiting-settle(day_000N)
  → abandonDay()
  → delete current day Core2-owned documents from candidate tree
  → publish
       phase = idle
       day = null
       lastSettledDay unchanged
  → idle
```

删除范围：

```text
days/<day>/plan.json
days/<day>/play.json       if present
days/<day>/summary.md      if present
```

历史不会丢失，因为 parent commit/tree 仍引用旧内容。

下一次 Planning 会根据 `lastSettledDay` 重新得到同一个 next day。

---

## 11. Submission contracts

模型 submission 永远是 untrusted data。

### 11.1 InitSubmissionV1

模型不生成 `worldId`。

```ts
interface InitSubmissionV1 {
  version: 1;
  title: string;
  canon: {
    premise: string;
    rules: string;
    style: string;
    userRole: string;
  };
}
```

Core2：

```text
generate worldId
validate title
validate canon
construct manifest + canon bytes
```

### 11.2 PlanningSubmissionV1

Day ID 不由模型提供。

```ts
interface PlanningSubmissionV1 {
  version: 1;
  intent: string;
  beats: Array<{
    id: string;
    intent: string;
  }>;
}
```

Core2：

```text
targetDay = nextDay(lastSettledDay)
validate beat ids unique/non-empty
persist day + plan together by Core2 construction
```

持久化 `plan.json`：

```json
{
  "version": 1,
  "intent": "...",
  "beats": [
    { "id": "...", "intent": "..." }
  ]
}
```

`day` 不重复写进 plan payload；路径已经提供身份。

### 11.3 PlaySubmissionV1

保留当前已落地 contract：

```ts
interface PlaySubmissionV1 {
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

继续校验 pinned plan relation。

### 11.4 ReviseSubmissionV1

```ts
interface ReviseSubmissionV1 {
  version: 1;
  canon: {
    premise: string;
    rules: string;
    style: string;
    userRole: string;
  };
}
```

Revise 是完整 canon snapshot replacement，不做模糊 patch language。

这样 publication 只有 PUT，不需要 Core2 实现第二套 patch DSL。

---

## 12. Session context

每个 Session 在开始时 pin 当前 application state。

### Init

Context 不依赖 Published World。

Core2 system prompt负责：

```text
通过多轮自然语言帮助用户建立 World
最终提交 title + canon snapshot
```

### Planning

Immutable context至少包含：

```text
current canon
nextDay id
last settled day summary（若存在）
```

模型不得改变 nextDay id。

### Play

保持当前：

```text
current canon
pinned plan
```

### Revise

Immutable context至少包含：

```text
current canon
last settled day summary（若存在）
```

目标是维护 canon，不修改 day history。

所有 context blob 在 Session 生命周期内 immutable。

---

## 13. Promptpile / React Session runtime

四类 conversational Session 共用一条真实执行链：

```text
build immutable context
→ create writable Conversation
→ append context through Promptpile
→ user send
→ promptpile-compress lifecycle
→ Promptpile React send Final
→ output.delta
→ ready
→ ...
→ submit marker
→ promptpile-compress lifecycle
→ Promptpile React private submit Final
→ strict submission parser
→ business validation
→ publication
```

这里允许共享 concrete helper，因为已有四个真实 Session kind。

但不创建：

```text
SessionPlugin
ProviderAdapter
GenericAgentBackend
WorkflowEngine
SessionRegistry extensibility API
```

建议代码结构：

```text
session/
  common.ts
  init.ts
  planning.ts
  play.ts
  revise.ts
  submissions.ts
```

`common.ts` 只放四类 Session 已经共同需要的 workspace / React / compression mechanics。

---

## 14. Conversation compression

`CORE2_CONVERSATION_COMPRESSION_DRAFT.md` 已冻结的正确机制继续有效，并扩展到所有 conversational Session：

```text
init
planning
play
revise
```

固定原则不变：

```text
live trigger basis = compact live Conversation
fresh summary source = restored original Conversation
provider timeout → kill exact child → drain in finally
CoreOperationError 不被 flatten
```

Semantic summary 仍只是 untrusted historical context。

Init 也使用 compression；不能假设初始化对话一定短。

Deterministic `settle()` / `abandonDay()` 不涉及 Conversation compression。

---

## 15. Mechanical publication primitive

当前 `publishPlay()` 中已经有正确的 publication theorem，但不应该复制五次。

Core2 应抽取一个**仅负责机械 Archive publication** 的 concrete primitive。

建议：

```ts
interface PublishMutationInput {
  operationType:
    | 'init'
    | 'planning'
    | 'play'
    | 'revise'
    | 'settle'
    | 'abandon-day';

  base: PublishedWorld | null;

  manifest?: {
    worldId: string;
    title: string;
    createdAt: string;
  };

  changes: readonly WorldChange[];

  control: {
    phase: 'idle' | 'planned' | 'awaiting-settle';
    day: string | null;
    lastSettledDay: string | null;
  };
}
```

它只负责：

```text
convert PUT/DELETE → StagingManifestV1
buildCandidateTreeV1
validate prepared target graph
acquire exclusive publication lock
recheck base under lock
install immutable blobs/tree/commit/operation
initial publish 时 install manifest
replace current.json as final visibility step
release lock
return re-read PublishedWorld when possible
```

它**不负责**：

```text
Init 合法性
Planning 合法性
Play submission relation
Revise canon validation
Settle legality
Abandon Day legality
业务 document bytes 构造
```

这些仍由具体 operation module负责。

这是必要共享，不是通用 framework。

---

## 16. Initial publication theorem

Init 没有 base commit，因此必须单独满足：

```text
baseRevision = 0
baseCommitId = null
baseRootTreeHash = null
parentCommitId = null
revision = 1
```

顺序：

```text
build + verify target graph completely
→ acquire .locks/publish.lock
→ recheck root 仍然 uninitialized
→ install immutable blobs
→ install tree
→ install commit
→ install prepared operation
→ install manifest.json
→ atomic replace/create current.json LAST
```

只有 `current.json` 出现后，World 才对 reader 可见。

Init 发生任何 pre-current failure：

```text
World 仍视为 uninitialized
```

可能残留的不可达 immutable objects 不构成 Published World。

---

## 17. Update publication theorem

Planning / Play / Revise / Settle / Abandon Day 全部 pin：

```text
revision
commitId
rootTreeHash
```

publication lock 内重新读取 visible World。

若任何 pinned base 不一致：

```text
WORLD_CONFLICT
```

且不得替换 `current.json`。

Settle 可以合法产生：

```text
candidate root tree hash == base root tree hash
```

因为它只更新 commit control；empty staging 是合法 mutation。

---

## 18. Uninitialized / invalid read semantics

`createDayloomCore()` 不再要求 World 必须已经 published。

### 18.1 Root 不存在

创建目录后：

```text
world.status = uninitialized
```

不自动创建 archive。

### 18.2 Root 存在且无 Published World

如果没有：

```text
manifest.json
current.json
commits/
objects/
operations/
```

中的持久化 archive 内容，则视为 `uninitialized`。

`.locks/` / `logs/` 等 runtime housekeeping 不单独构成 Published World。

### 18.3 Partial / malformed Published World

例如：

```text
manifest without current
current without commit
commit relation mismatch
root tree hash mismatch
required canon missing
stable phase invariant broken
```

→ `world.status = invalid`

Core2 不把这类状态误判成 uninitialized，也不允许 Init 覆盖。

---

## 19. Business operation modules

建议新增：

```text
world/
  read.ts
  publish.ts          # mechanical primitive
  init.ts
  planning.ts
  play.ts
  revise.ts
  settle.ts
  abandon-day.ts
```

每个具体 module 做：

```text
require exact source state
validate pinned context / submission
construct owned document changes
choose target stable control
call publish primitive
```

不要创建旧式：

```text
StateMachine class
CommandRegistry
RuntimeOperations interface
operation handler registry
```

四个 Session + 两个 stable mutation 足够直接表达。

---

## 20. Error taxonomy

保留当前 Core2 error surface，并补齐完整 lifecycle 真正需要的状态：

```ts
export interface CoreError {
  code:
    | 'NOT_AVAILABLE'
    | 'BUSY'
    | 'INVALID_INPUT'
    | 'CONVERSATION_FAILED'
    | 'AGENT_FAILED'
    | 'SUBMISSION_INVALID'
    | 'WORLD_CONFLICT'
    | 'WORLD_INVALID'
    | 'DISPOSED'
    | 'INTERNAL_ERROR';
  message: string;
}
```

原则：

```text
consumer 调了当前不可用能力 → NOT_AVAILABLE
用户文本为空 → INVALID_INPUT
Promptpile append/compression → CONVERSATION_FAILED
React completion → AGENT_FAILED
模型 final / business relation非法 → SUBMISSION_INVALID
publication base changed / lock conflict → WORLD_CONFLICT
操作中重新读取发现 World 已损坏 → WORLD_INVALID
Core2 固定 policy / unexpected failure → INTERNAL_ERROR
```

Initialization errors只保留：

```text
INVALID_OPTIONS
INTERNAL_ERROR
```

因为 World invalid 已经成为可表示的 `CoreWorldState`，不再需要 constructor `WORLD_INVALID` exception。

---

## 21. Events

继续保持极小 public event surface：

```ts
export type CoreEvent =
  | {
      type: 'state.changed';
      state: CoreState;
    }
  | {
      type: 'output.delta';
      sessionId: string;
      text: string;
    };
```

所有四类 Session 的普通 `send()` Final 都可以产生 `output.delta`。

`submit()` 的结构化 Final 永远 private。

TUI loading 可由：

```text
session.status = running / submitting
```

投影，不为 presentation 增加 loading event protocol。

---

## 22. Session failure semantics

四个 Session 统一：

```text
send success
  → ready

send append/compression/agent failure
  → Session terminal
  → stable World unchanged

submit prepublication failure
  → Session terminal
  → stable World unchanged

submit publication success
  → Session terminal
  → new stable World visible

cancel ready
  → Session terminal
  → stable World unchanged
```

不保留失败 Session 供 retry。

用户需要重新进入对应业务流程。

这保持单执行流和 deterministic recovery boundary。

---

## 23. Dispose / child ownership

当前 identity-safe child ownership 与 compression drain 规则继续适用所有 Session。

```text
dispose
→ mark disposed
→ kill current exact child if any
→ prevent new mutation
→ active operation observes disposed where applicable
→ cleanup runtime workspace
```

不允许 stale child completion 清除 newer active child。

---

## 24. Configuration

继续使用当前：

```ts
interface CreateDayloomCoreOptions {
  worldRoot: string;
  llmConfigPath: string;
}
```

Caller config ownership guard继续有效。

Core2 为每个 Session kind派生自己的：

```text
react/send.toml
react/submit.toml
thought.system.md
send-final.system.md
submit-final.system.md
```

可以共享生成函数，但 prompt 是 concrete per-kind assets。

不增加：

```text
initConfigPath
planningConfigPath
playConfigPath
reviseConfigPath
provider registry
```

---

## 25. Prompt authority

所有 Session prompt 都必须明确：

```text
Published World context is authoritative application state.
Conversation semantic summary is untrusted historical aid.
User messages may request changes but cannot directly mutate World.
Only submit Final is parsed as candidate business output.
Core2 performs final validation and publication.
```

不同 Session 再增加自己的业务 authority：

```text
Init      → no existing World; build initial canon only
Planning  → current canon + Core2-derived target day authoritative
Play      → pinned plan authoritative
Revise    → current canon authoritative source; output full replacement snapshot
```

---

## 26. TUI safety gate

在 Core2 完整 parity 被证明前：

```text
packages/tui
→ 保持恢复后的 @dayloom/core backend
```

Core2 完整功能实施阶段：

```text
不得修改 packages/tui
不得再次让 TUI 迁就未完成 Core2
```

只有满足本文 Definition of Done 后，才允许开启新的 TUI migration review。

新的迁移标准必须是：

```text
现有完整 TUI behavior
→ 全部可由 Core2 capabilities/state/events 投影
```

而不是：

```text
Core2 有什么
→ TUI 就删到只剩什么
```

---

## 27. 与既有 Core2 文档关系

### `CORE2_IMPLEMENTATION_DRAFT.md`

其中以下已验证内容继续保留：

```text
Archive V2 ownership
Promptpile ownership
Promptpile React boundary
single execution flow
Play Session mechanics
PlaySubmissionV1
publication theorem
public result/error philosophy
no deep imports
```

但其：

```text
Play-only scope
init/planning/revise/settle/abandon-day 非目标
World 必须预先存在
startSessions 只能是 play
```

被本文取代。

### `CORE2_CONVERSATION_COMPRESSION_DRAFT.md`

继续有效，并扩展到全部 conversational Session。

### `TUI_CORE2_ADAPTATION_DRAFT.md`

不再作为 Core2 完成依据。

TUI 恢复与后续迁移由 `TUI_RESTORATION_PLAN.md` 和未来独立 parity migration 文档控制。

---

## 28. 实施顺序

### Step 0 — 测试先定义 parity

先写 headless lifecycle acceptance harness：

```text
empty root
→ init
→ planning
→ play
→ settle
→ revise
→ planning next day
```

测试在实现前先表达目标状态。

### Step 1 — World read model

实现：

```text
uninitialized
invalid
published
```

以及 stable phase invariants。

### Step 2 — Publication primitive

从当前 `publishPlay()` 提取 mechanical publication theorem。

先让现有 Play 测试继续全绿。

### Step 3 — Init

实现：

```text
InitSubmissionV1
Init workspace/prompts
initial publication
```

验收空 root → idle。

### Step 4 — Planning

实现：

```text
Core2-derived DayId
PlanningSubmissionV1
plan publication
```

验收 idle → planned。

### Step 5 — Revise

实现 full canon replacement。

验收 idle → idle + canon changed。

### Step 6 — Settle / Abandon Day

先实现 deterministic stable mutations。

验收所有 phase 回到正确 idle boundary。

### Step 7 — Compression parity

对 init/planning/revise 补与 play 等价的 compression / timeout / error tests。

### Step 8 — Full lifecycle integration

从真正空目录连续执行至少两天主线。

### Step 9 — CI / package guard

四矩阵：

```text
Ubuntu  Node 20
Ubuntu  Node 22
Windows Node 20
Windows Node 22
```

全部跑完整 Core2 suite。

### Step 10 — Freeze

只有全部 acceptance tests 通过后，本文才能改为：

```text
Implementation Freeze / 可直接替代 Core
```

---

## 29. 必须覆盖的 acceptance tests

### World state

```text
core2-empty-root-is-uninitialized
core2-empty-root-exposes-init-only
core2-partial-archive-is-invalid-not-uninitialized
core2-invalid-world-exposes-no-mutations
core2-published-idle-validates-required-canon
core2-planned-validates-plan-and-absence-of-play
core2-awaiting-settle-validates-play-and-summary
```

### Init

```text
core2-init-session-starts-from-uninitialized
core2-init-cancel-leaves-root-uninitialized
core2-init-submit-publishes-revision-1-idle
core2-init-generates-world-id-in-core
core2-init-current-json-is-final-visibility-step
core2-init-prepublication-failure-remains-uninitialized
core2-concurrent-init-detects-world-conflict
```

### Planning

```text
core2-planning-only-available-from-idle
core2-planning-derives-day-0001-after-init
core2-planning-derives-next-day-from-last-settled-day
core2-planning-submit-publishes-plan-and-planned-phase
core2-planning-cancel-keeps-idle-world
```

### Play

保留现有全部 Play / compression / publication tests，并补完整 lifecycle context。

### Revise

```text
core2-revise-only-available-from-idle
core2-revise-submit-replaces-four-canon-documents-atomically
core2-revise-parent-commit-preserves-old-canon
core2-revise-cancel-keeps-world-unchanged
```

### Settle

```text
core2-settle-only-available-awaiting-settle
core2-settle-publishes-idle-with-last-settled-day
core2-settle-keeps-day-documents-byte-identical
core2-settle-empty-staging-publication-is-valid
core2-settle-conflict-does-not-publish
```

### Abandon Day

```text
core2-abandon-available-from-planned
core2-abandon-available-from-awaiting-settle
core2-abandon-removes-current-day-owned-documents
core2-abandon-keeps-last-settled-day
core2-replanning-after-abandon-reuses-same-next-day
core2-abandoned-content-remains-readable-from-parent-commit
```

### Session common lifecycle

```text
core2-all-session-kinds-stream-send-final
core2-all-session-kinds-keep-submit-final-private
core2-all-session-kinds-terminalize-on-agent-failure
core2-all-session-kinds-terminalize-on-compression-failure
core2-all-session-kinds-drain-summary-provider-before-settle
core2-stale-child-end-cannot-clear-new-child
```

### Full closure

```text
core2-full-lifecycle-empty-to-second-day
core2-full-lifecycle-has-no-stable-dead-end
core2-full-lifecycle-revise-between-days
core2-full-lifecycle-abandon-and-replan
```

---

## 30. Definition of Done

Core2 只有满足全部条件才算“完整实现”：

1. 空 `worldRoot` 创建 Core 不报 `WORLD_INVALID`，而是 `uninitialized`。
2. `uninitialized` 唯一业务入口是 Init。
3. Init 可多轮自然语言、submit、cancel。
4. Init submit 首次原子发布 Archive V2 World，结果是 `idle`。
5. `idle` 同时提供 Planning 与 Revise。
6. Planning submit 产生 Core2-owned next Day ID 和严格 plan，结果是 `planned`。
7. Play 保持现有 streaming / compression / strict submission / atomic publication 正确性。
8. Play submit 结果是 `awaiting-settle`，且此状态不是死路。
9. Settle deterministic 地回到 `idle` 并推进 `lastSettledDay`。
10. Revise 以 full canon snapshot 在新 commit 中原子替换 canon。
11. Abandon Day 从 `planned` / `awaiting-settle` 回到 `idle`，且可以重新规划同一天。
12. `invalid` World 可展示、不可 mutation、不会被 Init 覆盖。
13. 四类 conversational Session 全部使用同一正确 Promptpile / React / compression mechanics。
14. 六类 publication 全部使用同一 mechanical publication theorem，而不是复制 transaction 代码。
15. Core2 不 import `@dayloom/core` / `@dayloom/core-old` / TUI。
16. 不新增 command bus、state-machine framework、provider/plugin framework 或并发系统。
17. `packages/tui` 在 Core2 完整实施期间保持恢复基线，不再被削减。
18. 完整 headless lifecycle 从空 World 连续跑到第二天通过。
19. Core2 tests 在 Linux/Windows × Node 20/22 全绿。
20. 只有以上全部满足，Core2 才具备重新评估 TUI migration 的资格。

---

## 31. 最终目标架构

```text
                    ┌──────────────────────────────┐
                    │        Consumer / TUI        │
                    │   state + capabilities only │
                    └──────────────┬───────────────┘
                                   │
                                   ▼
┌────────────────────────────────────────────────────────────┐
│                         Core2                              │
│                                                            │
│  World read model                                          │
│    uninitialized | invalid | published                     │
│                                                            │
│  Conversational Sessions                                   │
│    init | planning | play | revise                         │
│                                                            │
│  Deterministic mutations                                   │
│    settle | abandonDay                                     │
│                                                            │
│  Business validation + document construction               │
│                                                            │
│  One mechanical Archive publication primitive              │
└───────────┬────────────────┬──────────────────┬─────────────┘
            │                │                  │
            ▼                ▼                  ▼
   promptpile-compress   Promptpile React   Archive Protocol
            │                │                  │
            └──── Conversation / Agent ─────────┘
                                   │
                                   ▼
                         Published Archive V2
```

最终必须满足一句话：

> **Core2 重新实现 Dayloom 的完整业务生命周期，但只保留一套现代、最小、可验证的 application semantics。**
