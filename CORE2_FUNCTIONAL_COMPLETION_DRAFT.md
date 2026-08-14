# Dayloom Core2 产品生命周期实现冻结

> Status: **Implementation Freeze / 可直接实施**  
> Date: 2026-08-14  
> Target: `@dayloom/core2`  
> Data foundation: `@dayloom/archive-protocol` + Core2 Dayloom World Profile V0  
> Consumer acceptance reference: restored full Dayloom TUI interaction capabilities

本文冻结 Core2 的完整产品生命周期、public contract、数据关系、Promptpile/React 集成、publication theorem 与实施顺序。

此前 `CORE2_IMPLEMENTATION_DRAFT.md` 正确建立了新的 Archive V2 / Promptpile / Promptpile React / Play 边界，但错误地把完整 Core2 收缩成 Play-only slice。随后 TUI 又迁就这个不完整能力集，造成产品能力缺失。

本冻结只纠正 **completion boundary**，不退回旧 Core 架构。

## 0. 规范来源优先级

Core2 的规范来源从高到低固定为：

```text
1. @dayloom/archive-protocol
   + Core2 Dayloom World Profile V0
   = persisted data / graph / publication correctness

2. 已冻结并验证的 Core2 ownership
   + Promptpile / Promptpile React / compression contracts
   = runtime correctness

3. Dayloom 完整产品交互所需要的 application capabilities
   = completion requirement

4. restored full TUI
   = consumer acceptance reference

5. @dayloom/core / @dayloom/core-old
   = historical behavior reference only
```

第 5 层不得反过来决定 Core2 的：

```text
public API
public events
World document shape
Day identity grammar
submission DTO
Archive layout
persistent phase
internal architecture
```

最终原则：

> **Core2 以新的 Archive V2 / Dayloom World 数据结构为基础，提供足以支撑完整 Dayloom 产品交互的最小、consumer-neutral application semantics。TUI 是验收消费者之一，不是架构接口；旧 Core 不是规范。**

---

## 1. 唯一产品主线

Core2 必须从真正空 World 开始形成无稳定死路的持续闭环：

```text
uninitialized
    ↓ Init Session
published idle
    ↓ Planning Session
published planned
    ↓ Play Session
published awaiting-settle
    ↓ Settle
published idle
    ↓ Planning Session
published planned
    ↓ ...
```

同时存在两个真实旁路：

```text
published idle
    ↓ Revise Session
published idle
```

以及：

```text
published planned / awaiting-settle
    ↓ Abandon Day
published idle
```

这条 lifecycle 由新的 World Profile 自然推导：

```text
Init      → 创建 manifest + canon
Planning  → 创建 next-day plan
Play      → 消费 pinned plan，产生 play + summary
Settle    → 关闭当前 day
Revise    → 替换当前 canon snapshot
Abandon   → 从 visible tree 移除当前未完成 day
```

不是从 legacy Runtime phase 表逐项复制。

---

## 2. 产品能力闭环

任意 consumer 至少能够表达：

```text
创建 World
规划下一天
进入当前行动
修订 World canon
结算当前一天
放弃当前未完成的一天

conversational Session:
  多轮自然语言
  streaming user-visible Final
  submit
  cancel

read:
  World 是否存在 / 是否有效
  published phase / current day
  active Session
  当前可用业务能力
```

恢复后的完整 TUI 必须能够只根据这些 application semantics 投影原有完整交互。

TUI 自己继续拥有：

```text
Hub / Session page
status/help mode
selected action
widget
footer
focus
scroll
shortcut
loading label
presentation message formatting
```

这些不得进入 Core2 public contract。

---

## 3. Greenfield / 非目标冻结

Core2 是 clean greenfield runtime，不是 legacy compatibility layer。

生产代码禁止 import：

```text
@dayloom/core
@dayloom/core-old
@dayloom/tui
@dayloom/tui-old
@dayloom/archive-protocol/src/
@dayloom/archive-protocol/dist/
promptpile/src/
promptpile/dist/
promptpile-react/src/
promptpile-react/dist/
promptpile-compress/src/
promptpile-compress/dist/
```

不实现：

```text
legacy Runtime API adapter
TUI adapter
fake RuntimeSnapshot / RuntimeEvent
Archive V1 runtime / migration
command bus
CommandRegistry framework
StateMachine framework
RuntimeOperations framework
provider/plugin framework
MCP / application tools
Promptpile tools / after-hook
并发 Session / mutation
queue / scheduler / actor / worker
agent retry framework
active Session crash resume
跨 Core instance Conversation resume
```

没有第二个真实实现时，不创建扩展层。

---

## 4. Ownership theorem

```text
Archive Protocol
  owns persisted-data correctness
  owns parser / path / hash / tree / staging / relation validation

Promptpile
  owns Conversation artifacts and append I/O

promptpile-compress
  owns Conversation inspection / compression / restore lifecycle

Promptpile React
  owns Thought → Observe → Check → Final orchestration
  owns Agent Event Protocol production

Core2
  owns Dayloom application legality
  owns Dayloom World Profile
  owns World read state
  owns Session lifecycle
  owns React invocation policy
  owns untrusted submission parsing + business validation
  owns Core2-owned document construction
  owns publication policy
  owns public state / capabilities / events

Consumers
  own presentation
```

一句话：

```text
Protocol owns persisted-data correctness.
Promptpile owns Conversation artifacts and completion I/O.
Promptpile React owns agent orchestration.
Core2 owns business legality, Session lifecycle and World publication.
Consumers own presentation.
```

模型永远不能直接成为 Published World authority。

---

## 5. Package / dependency baseline

Core2 继续要求 Node >= 20。

当前 direct dependency baseline 保持：

```json
{
  "@dayloom/archive-protocol": "0.0.0",
  "@iarna/toml": "^2.2.5",
  "ajv": "^8.17.1",
  "promptpile": "0.1.0-beta.2",
  "promptpile-compress": "0.1.0-beta.2",
  "promptpile-react": "0.1.0-beta.3"
}
```

本 lifecycle completion 不新增 runtime dependency。

Package description 在完成时不得继续描述为 Play-only runtime。

---

## 6. Persistent state 与 transient state

Archive Protocol V2 的 Published World phase 继续只有：

```text
idle
planned
awaiting-settle
```

Core2 不向 Archive commit control 增加：

```text
initializing
planning
playing
revising
running
submitting
```

这些由 active Session 表达。

同样：

```text
uninitialized
invalid
```

不是 Archive phase，而是 Core2 对“是否存在合法 Published World”的 application read state。

---

## 7. Core2 Dayloom World Profile V0

Core2 继续使用此前已冻结并落地的新数据结构：

```text
canon/premise.md
canon/rules.md
canon/style.md
canon/user-role.md

days/<day>/plan.json
days/<day>/play.json
days/<day>/summary.md
```

不得为了补 lifecycle 顺手改写已经验证的 Play 数据结构。

Core2 不要求 root tree 只能包含这些路径；其它 domain-owned document 可以存在。

Core2 只修改自己拥有的路径。

所有路径必须经过 Archive Protocol public path contract。

### 7.1 Canon

任何 `published` World 必须存在：

```text
canon/premise.md
canon/rules.md
canon/style.md
canon/user-role.md
```

它们是当前 commit 的完整 canon snapshot。

历史 canon 由 immutable commit/tree 自然保存，不创建 canon revision framework。

Markdown 内容允许为空；Core2 不新增任意长度 policy。

### 7.2 Day identity

完整 lifecycle 需要 Core2 自己生成 Day ID；模型与 consumer 均不能指定。

V0 generator 固定：

```text
day1
day2
day3
...
```

语法：

```ts
/^day[1-9][0-9]*$/
```

规则：

```text
lastSettledDay = null   → day1
lastSettledDay = dayN   → day(N + 1)
```

`day_0001` 等 legacy grammar 不进入 Core2。

### 7.3 PlayPlanV0 保持不变

Persisted `days/<day>/plan.json` 继续是已冻结的：

```ts
interface PlayPlanV0 {
  intent: string;
  beats: Array<{
    id: string;
    intent: string;
  }>;
}
```

**不增加 `version` 字段。**

规则保持：

```text
exact top-level / beat keys
intent trim 后非空
beats 是 array，可为空
beat.id trim 后非空且唯一
beat.intent trim 后非空
```

Planning 模型不生成 beat ID。

Core2 按数组顺序构造：

```text
beat1
beat2
beat3
...
```

因此补 Planning 不改变 PlayPlanV0，只补上其合法生产者。

### 7.4 Play / summary 保持当前 contract

当前已落地：

```text
days/<day>/play.json
  = version 1 resolved beats + events

days/<day>/summary.md
  = final day summary
```

现有 Play parser / business validation / pinned-plan relation 全部继续有效。

---

## 8. Stable Published World invariants

### idle

```text
phase = idle
day = null
lastSettledDay = null | Core2 Day ID
```

如果 `lastSettledDay != null`，该 day 在 current tree 中必须至少有：

```text
plan.json
play.json
summary.md
```

### planned

```text
phase = planned
day = Core2 Day ID
```

当前 day：

```text
plan.json exists + valid PlayPlanV0
play.json absent
summary.md absent
```

### awaiting-settle

```text
phase = awaiting-settle
day = Core2 Day ID
```

当前 day：

```text
plan.json exists + valid
play.json exists + valid
summary.md exists
```

Core2 不在每次 read 全扫描历史；只验证当前 control 直接依赖的 canon/current day/lastSettledDay relation。真正加载历史 context 时再逐 blob verify。

---

## 9. Public World state

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

`uninitialized` 是正常业务状态。

`invalid` 表示 root 中存在持久化 Archive evidence，但不能验证为合法 Published World；Core 可以创建，但全部 mutation capability 为 false，且 Init 不得覆盖。

---

## 10. World classification

`createDayloomCore()` 确保 `worldRoot` directory 存在后进行分类。

### uninitialized

满足：

```text
no manifest.json
no current.json
no persistent Archive graph evidence under commits/objects/operations
```

仅存在：

```text
.locks/
logs/
Core2 runtime housekeeping
```

仍是 uninitialized。

### invalid

任意 partial / malformed durable Archive evidence 都 fail-closed 为 invalid，例如：

```text
manifest without current
current without manifest
current without commit
commit/current relation mismatch
tree hash mismatch
required canon missing
planned without valid plan
awaiting-settle without valid play/summary
Core2 Day ID relation invalid
unreachable durable init artifacts left by process crash
```

这防止 Init 静默覆盖已有或半写入数据。

### published

只有：

```text
manifest
→ current
→ commit relation
→ root tree identity
→ required Dayloom Profile relations
```

全部通过才是 published。

---

## 11. Public Session state

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

Session identity 从创建开始持续到 submit/cancel/failure terminalize。

同一 Session 从开始到终止只使用一个 writable Promptpile Conversation identity。

---

## 12. Public API

```ts
export interface CreateDayloomCoreOptions {
  worldRoot: string;
  llmConfigPath: string;
}

export interface DayloomCore {
  getState(): CoreState;
  subscribe(listener: (event: CoreEvent) => void): () => void;

  startSession(kind: CoreSessionKind): Promise<CoreResult>;
  send(text: string): Promise<CoreResult>;
  submit(): Promise<CoreResult>;
  cancel(): Promise<CoreResult>;

  settle(): Promise<CoreResult>;
  abandonDay(): Promise<CoreResult>;

  dispose(): Promise<void>;
}

export function createDayloomCore(
  options: CreateDayloomCoreOptions,
): Promise<DayloomCore>;
```

这是 consumer-neutral application API，不是 TUI API。

不引入：

```text
executeCommand(command)
command bus
backend interface
compatibility facade
consumer-specific adapter
```

---

## 13. Capability theorem

无 active Session 且无 mutation in flight：

```text
uninitialized
  startSessions = ['init']
  settle = false
  abandonDay = false

invalid
  startSessions = []
  settle = false
  abandonDay = false

published idle
  startSessions = ['planning', 'revise']
  settle = false
  abandonDay = false

published planned
  startSessions = ['play']
  settle = false
  abandonDay = true

published awaiting-settle
  startSessions = []
  settle = true
  abandonDay = true
```

有 active Session 或 mutation in flight：

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

Core2 不支持运行中 cancel。

---

## 14. 单执行流

只允许：

```text
一个 active Session
或
一个 stable World mutation
```

```text
no session
  ├─ startSession(kind) → ready
  ├─ settle()           → stable mutation
  └─ abandonDay()       → stable mutation

ready
  ├─ send()   → running → success → ready
  ├─ submit() → submitting → terminal
  └─ cancel() → terminal
```

同时进入的 Core2 mutation：

```text
→ BUSY
```

跨 Core instance 的 World conflict 由 publication lock + pinned-base recheck解决，不建立 queue/scheduler。

---

## 15. Init

```text
uninitialized
  → startSession('init')
  → ready
  → send*
  → submit
  → first Archive V2 publication
  → published idle
```

Cancel：

```text
init ready
  → cancel
  → uninitialized
```

### InitSubmissionV1

模型只提交业务内容：

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

规则：

```text
exact keys
version === 1
title trim 后非空
canon 四字段必须是 string
unknown fields rejected
```

Core2 自己生成：

```text
worldId
operationId
commitId
revision = 1
createdAt
```

`worldId` 只要求由 Core2 生成并满足 Archive Protocol stable-id contract；具体 private 格式不是 public semantic，不冻结 prefix。

Init 构造：

```text
manifest.json
4 canon markdown blobs
control = idle / day:null / lastSettledDay:null
```

**Init 不创建 plan。**

因此产品正常路径必然是：

```text
Init → idle → Planning
```

example 不得偷偷跳过 Planning。

---

## 16. Planning

Planning 对应产品中的“规划下一天”。

```text
published idle
  → startSession('planning')
  → targetDay = nextDay(lastSettledDay)
  → ready
  → send*
  → submit
  → days/<targetDay>/plan.json
  → published planned(targetDay)
```

Cancel 保持 published World 不变。

### PlanningSubmissionV1

模型不提交 day ID，不提交 beat ID：

```ts
interface PlanningSubmissionV1 {
  version: 1;
  intent: string;
  beats: Array<{
    intent: string;
  }>;
}
```

Core2 校验业务内容并构造现有 `PlayPlanV0`：

```json
{
  "intent": "...",
  "beats": [
    { "id": "beat1", "intent": "..." },
    { "id": "beat2", "intent": "..." }
  ]
}
```

因此 Planning 是 `PlayPlanV0` 的唯一 Core2 producer，Play 继续消费同一个既有 schema。

---

## 17. Play

Play 保持当前已验证链路：

```text
published planned(dayN)
  → startSession('play')
  → pin World + canon + PlayPlanV0
  → ready
  → send*
  → submit
  → play.json + summary.md
  → published awaiting-settle(dayN)
```

Cancel 保持 published planned 不变。

### PlaySubmissionV1

继续使用当前已落地 contract：

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

继续严格校验 pinned plan relation。

---

## 18. Revise

```text
published idle
  → startSession('revise')
  → pin current canon
  → ready
  → send*
  → submit
  → replace four current canon docs in a new root tree
  → published idle
```

Cancel 保持 World 不变。

### ReviseSubmissionV1

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

Revise 输出 full canon snapshot replacement，不设计 patch DSL。

Revise 不修改：

```text
manifest title
worldId
day history
lastSettledDay
```

---

## 19. Settle

Settle 是 deterministic World mutation，不启动 agent。

```text
published awaiting-settle(dayN)
  → settle()
  → revalidate current day plan/play/summary
  → publish new commit
       phase = idle
       day = null
       lastSettledDay = dayN
  → published idle
```

Settle 不重写 day content。

允许：

```text
empty staging
candidate rootTreeHash == base rootTreeHash
new commit / revision / control
```

---

## 20. Abandon Day

从：

```text
published planned(dayN)
published awaiting-settle(dayN)
```

均可执行。

Candidate current tree 删除：

```text
days/<day>/plan.json
days/<day>/play.json      if present
days/<day>/summary.md     if present
```

Publish：

```text
phase = idle
day = null
lastSettledDay unchanged
```

Parent commit/tree 继续保存被 abandon 的历史内容。

下一次 Planning 由 `nextDay(lastSettledDay)` 自然重新得到同一个未 settle day。

不创建 abandoned marker document；当前没有第二个真实 consumer 需要它。

---

## 21. Session context

每个 Session 在开始时 pin authoritative application state；context layer 在整个 Session 内 immutable。

### Init

没有 Published World context，只使用 Core2-owned Init system prompt。

### Planning

至少：

```text
current canon
Core2-derived targetDay
last settled day summary（若存在）
```

### Play

保持当前：

```text
current canon
pinned PlayPlanV0
```

### Revise

至少：

```text
current canon
last settled day summary（若存在）
```

不存在历史 summary 时不制造 fake empty artifact。

---

## 22. Promptpile Conversation topology

四类 conversational Session 统一：

```text
<session>/
├── context/          # immutable Promptpile input layer
├── conversation/     # 唯一 writable Promptpile Conversation
├── react/
│   ├── thought.md
│   ├── final-send.md
│   ├── final-submit.md
│   ├── send.toml
│   └── submit.toml
└── compression/
    ├── summary.system.md
    ├── summary.toml
    └── requests/
```

Persistent Conversation identity：

```text
startSession
→ create exactly one writable conversation/
→ all send() append to that Conversation
→ submit marker append to that Conversation
→ Session terminal
```

不得每轮 send 重建 Conversation。

---

## 23. Promptpile / React execution theorem

四类 Session 共用同一 concrete mechanics：

```text
build immutable context
→ create writable Conversation
→ append context via Promptpile public CLI
→ ready

send(text)
→ append-user
→ compression lifecycle
→ Promptpile React send config
→ consume Agent Event v1
→ emit user-visible Final delta only
→ ready

submit()
→ append Core2 submit marker
→ compression lifecycle
→ Promptpile React submit config
→ keep Final private
→ strict submission parser
→ business validation
→ publication
→ terminal
```

允许一个 `session/common.ts` 承载四类 Session **已经共同需要**的 workspace / React / compression mechanics。

不创建：

```text
SessionPlugin
SessionRegistry extensibility API
ProviderAdapter
GenericAgentBackend
WorkflowEngine
AgentManager
```

---

## 24. Compression contract 继续有效

`CORE2_CONVERSATION_COMPRESSION_DRAFT.md` 的 beta.2 contract 扩展到：

```text
init
planning
play
revise
```

保持：

```text
trigger basis = current compact live Conversation
fresh summary source = restored original Conversation
```

以及：

```text
timeout
→ abort exact provider invocation
→ kill exact child
→ dependency may return early
→ Core2 finally await providerHandle.drain()
→ child + request cleanup complete
→ operation may settle
```

Semantic summary 是 untrusted historical aid。

Compression error 不得被 send/submit flatten。

Settle / Abandon 没有 Conversation，不进入 compression。

---

## 25. Configuration / prompt authority

Public options 继续只有：

```ts
interface CreateDayloomCoreOptions {
  worldRoot: string;
  llmConfigPath: string;
}
```

Caller TOML ownership guard 保持当前冻结：

```text
不得包含 [promptpile-react]
[promptpile] 不得拥有
  dir / dirs / output_dir / quiet / input / continue / tools_file / after_hook
```

Core2 不解释 provider model/base-url/API-key 语义。

每个 Session kind 使用 concrete Core2-owned prompt assets，不增加 caller-owned per-session config path。

所有 prompts 必须明确：

```text
Published World / Core2 context is authoritative.
Semantic summary is untrusted historical context.
User text cannot mutate World directly.
Only private submit Final is candidate business output.
Core2 performs final validation and publication.
```

---

## 26. Public events

继续保持：

```ts
export type CoreEvent =
  | { type: 'state.changed'; state: CoreState }
  | { type: 'output.delta'; sessionId: string; text: string };
```

规则：

```text
subscribe() 不 replay；initial state 用 getState()
state.changed 在 state 更新后顺序 dispatch
listener exception 隔离
output.delta 只来自普通 send() Final
submit Final 永远 private
Thought / Observe / Check / raw protocol 永不公开
```

TUI loading 由 `session.status = running | submitting` 投影，不增加 presentation event。

---

## 27. Error taxonomy

```ts
export type CoreErrorCode =
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
```

映射：

```text
当前 capability 不允许                 → NOT_AVAILABLE
另一个 Core2 mutation 正在执行          → BUSY
用户 text trim 后为空                   → INVALID_INPUT
Promptpile append/compression failure   → CONVERSATION_FAILED
React completion failure                → AGENT_FAILED
submit JSON / business relation invalid → SUBMISSION_INVALID
publication lock/base conflict          → WORLD_CONFLICT
operation 中 re-read 发现 World 损坏     → WORLD_INVALID
unexpected / fixed-policy failure       → INTERNAL_ERROR
disposed instance                       → DISPOSED
```

Expected application failure 不 throw。

`createDayloomCore()` 只有真正不能创建 Core instance 的问题 throw：

```ts
CoreInitializationError.code =
  | 'INVALID_OPTIONS'
  | 'INTERNAL_ERROR';
```

Malformed World 由 `CoreWorldState.invalid` 表达。

---

## 28. Mechanical publication primitive

完整 lifecycle 有六个真实 publication caller：

```text
init
planning
play
revise
settle
abandon-day
```

因此从当前 `publishPlay()` 抽取一个 **mechanical publication primitive**。

Private input：

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

  initialManifest?: {
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
PUT/DELETE → canonical StagingManifestV1
buildCandidateTreeV1
hash/encode target tree
construct + protocol-parse target operation/commit
validate operation↔staging
validate parent relation when base exists
validate prepared target relation
acquire publication lock
recheck exact base
install immutable blobs/tree/commit
install prepared operation record
initial publication install manifest
replace current.json as final World-visibility step
best-effort mark operation published after visibility
release lock
return visible PublishedWorld
```

`operations/<id>.json` 是 lifecycle/diagnostic record，不是 content-addressed immutable object；其 post-publication status update 不改变 Published World truth。

Primitive 不负责：

```text
Init legality
Planning legality
Play relation
Revise canon policy
Settle legality
Abandon legality
business document construction
```

不允许扩张成通用 transaction/command framework。

---

## 29. Initial publication theorem

Init base：

```text
baseRevision = 0
baseCommitId = null
baseRootTreeHash = null
parentCommitId = null
revision = 1
```

正常顺序：

```text
build + protocol-validate candidate graph completely
→ acquire .locks/publish.lock
→ recheck root still uninitialized
→ install immutable blobs/tree/commit
→ install prepared operation record
→ install manifest.json
→ atomic create/replace current.json as final World-visibility step
→ best-effort mark operation published
```

只有 `current.json` 成功后才存在 Published World。

### 29.1 同步 pre-current failure

Core2 必须记录本次 attempt **实际新建**的 durable files。

如果 `current.json` 尚未成功且 operation 在同一进程内失败：

```text
remove manifest if this attempt created it
remove only blob/tree/commit/operation files this attempt newly created
never delete files that pre-existed this attempt
remove temp files
release lock
```

成功 cleanup 后，live Core state 回到：

```text
uninitialized
```

这样 Init 可以重试。

### 29.2 进程崩溃 / power loss residue

Core2 **不承诺** crash 后自动清理 pre-current durable residue。

下次启动若：

```text
no current.json
但存在 manifest / commit / object / operation durable evidence
```

→ `invalid`

fail-closed，不允许 Init 覆盖。

这避免为了极少见 crash residue 引入 startup recovery coordinator。

### 29.3 post-current diagnostic failure

一旦 `current.json` 成功：

```text
Published World 已经是 public truth
```

随后 `operation.status = published` 等 diagnostic 更新可以发生，但：

```text
diagnostic write failure
→ 不回滚 current
→ 不删除已发布 immutable graph
→ 不把成功 publication 改判为失败
```

所以 `current.json` 是最后的 **World visibility switch**，不是最后一个可能发生的 diagnostic filesystem write。

---

## 30. Update publication theorem

Planning / Play / Revise / Settle / Abandon pin：

```text
revision
commitId
rootTreeHash
```

lock 内重新读取 visible current truth。

任何 pinned base 不一致：

```text
WORLD_CONFLICT
current.json unchanged by this operation
```

Settle 必须支持：

```text
changes = []
candidateTreeHash === baseTreeHash
```

Publication 总 theorem：

> **先完整构造并验证 target graph；在 exclusive publication ownership 下 recheck pinned base；安装 target durable graph 后，以 `current.json` 作为最终 World 可见性切换。其后的 diagnostic 更新不参与 World truth。**

---

## 31. Session failure / dispose

四类 conversational Session：

```text
send success
  → ready

send conversation/compression/agent failure
  → terminal Session
  → Published World unchanged

submit parse/business/precurrent failure
  → terminal Session
  → Published World unchanged

submit publication success
  → terminal Session
  → new Published World

cancel ready
  → terminal Session
  → Published World unchanged
```

失败 Session 不保留供 retry。

Dispose 保持当前 identity-safe child ownership：

```text
mark disposed
→ capabilities all false
→ kill exact active child
→ operation follows its finally cleanup/drain
→ cleanup runtime workspace
```

Stale child completion 不得清除 newer active child。

---

## 32. 建议代码结构

```text
world/
  read.ts
  publish.ts
  init.ts
  planning.ts
  play.ts
  revise.ts
  settle.ts
  abandon-day.ts

session/
  common.ts
  init.ts
  planning.ts
  play.ts
  revise.ts
  submissions.ts
```

`common.ts` 只放四种真实 Session 已共同需要的 mechanics。

具体 world module 只做：

```text
require exact source state
pin context
parse/validate candidate business output
construct owned document changes
choose target stable control
call mechanical publication primitive
```

---

## 33. TUI safety / acceptance gate

Core2 完整实施期间：

```text
packages/tui/**
→ 保持恢复后的完整 @dayloom/core backend
```

不得再次修改 TUI 来迁就未完成 Core2。

Core2 headless DoD 完成后，才允许重新评审 TUI migration。

未来迁移验收是 interaction capability closure：

```text
完整 TUI 所需业务动作
→ 都能从 Core2 state/capabilities 自然发现并调用

完整 Session 的 input/stream/submit/cancel/loading projection
→ 都能从 Core2 API/state/events 表达
```

不是旧 Core API / DTO / event compatibility。

禁止新的：

```text
Core2 TUI adapter
fake old runtime
OldCoreBackend/Core2Backend 双 backend framework
```

---

## 34. 与既有文档关系

### `CORE2_IMPLEMENTATION_DRAFT.md`

继续有效的已验证 contract：

```text
Archive V2 ownership
Promptpile ownership
Promptpile React direct integration
consumer-neutral API principle
single execution flow
Play Session mechanics
PlayPlanV0
PlaySubmissionV1
publication theorem
result/error philosophy
no deep imports
```

被本文取代的只有 Play-only completion scope：

```text
init/planning/revise/settle/abandon 非目标
World 必须预先 published
startSessions 只能是 play
```

因此它是 **Play slice implementation freeze**，不是完整 Core2 completion spec。

### `CORE2_CONVERSATION_COMPRESSION_DRAFT.md`

完整有效，并扩展到四种 conversational Session。

### `TUI_CORE2_ADAPTATION_DRAFT.md`

不再作为 completion 规范。

恢复与未来迁移由 `TUI_RESTORATION_PLAN.md` 及未来独立 migration review 控制。

### `@dayloom/core`

只允许作为历史行为参考；不得成为设计依赖。

---

## 35. 实施顺序

### Step 0 — Protect restored TUI

建立 guard，Core2 completion changes 不修改 `packages/tui/**`。

### Step 1 — World classification / Profile

实现：

```text
uninitialized
invalid
published
Day ID V0 generator
stable phase invariants
```

### Step 2 — Publication primitive

从当前 `publishPlay()` 提取 mechanical publication theorem，并先保持所有现有 Play/publication tests 全绿。

### Step 3 — Init

实现：

```text
InitSubmissionV1
Init workspace/prompts
initial publication
sync pre-current cleanup
```

### Step 4 — Planning

实现：

```text
nextDay()
PlanningSubmissionV1
beat ID construction
existing PlayPlanV0 publication
```

### Step 5 — Revise

实现 full canon snapshot replacement。

### Step 6 — Settle

实现 empty-staging deterministic publication。

### Step 7 — Abandon Day

实现 current-day Core2-owned document DELETE publication。

### Step 8 — Common Session mechanics

只在 init/planning/revise 都成为真实 caller 后，把当前 Play mechanics 提取为 shared concrete helper。

### Step 9 — Full headless lifecycle

真正空 root 连续执行：

```text
Init
→ Planning(day1)
→ Play(day1)
→ Settle(day1)
→ Revise
→ Planning(day2)
```

并覆盖 Abandon/replan。

### Step 10 — CI

完整 Core2 suite：

```text
Ubuntu Node 20
Ubuntu Node 22
Windows Node 20
Windows Node 22
```

全部 green。

### Step 11 — TUI migration eligibility

只有本文 DoD 全部满足后，才允许再次迁移 TUI。

---

## 36. Acceptance tests

### Architecture / data source

```text
core2-has-no-legacy-core-imports
core2-has-no-tui-imports
core2-has-no-deep-protocol-or-promptpile-imports
core2-retains-play-plan-v0-shape
core2-day-generator-produces-day1-day2
core2-planning-model-does-not-own-day-or-beat-identity
```

### World classification

```text
core2-empty-root-is-uninitialized
core2-housekeeping-only-root-is-uninitialized
core2-empty-root-exposes-init-only
core2-partial-archive-is-invalid-not-uninitialized
core2-crashed-initial-publication-residue-is-invalid
core2-invalid-world-exposes-no-mutations
core2-published-idle-validates-canon
core2-planned-validates-current-plan-relation
core2-awaiting-settle-validates-current-play-summary-relation
```

### Init

```text
core2-init-starts-only-from-uninitialized
core2-init-cancel-keeps-uninitialized
core2-init-submit-publishes-revision-1-idle
core2-init-generates-world-id-in-core
core2-init-does-not-create-plan
core2-init-current-json-is-final-world-visibility-step
core2-init-sync-precurrent-failure-cleans-created-files
core2-init-sync-precurrent-failure-returns-uninitialized
core2-concurrent-init-detects-world-conflict
core2-init-postcurrent-diagnostic-failure-keeps-published-world
```

### Planning

```text
core2-planning-starts-only-from-idle
core2-planning-derives-day1-after-init
core2-planning-derives-day2-after-day1-settle
core2-planning-generates-beat1-beat2
core2-planning-persists-existing-play-plan-v0-shape
core2-planning-submit-enters-planned
core2-planning-cancel-keeps-world-unchanged
```

### Play

保留当前所有 Play / submission / streaming / compression / publication tests，并补：

```text
core2-play-consumes-core2-produced-play-plan-v0
core2-play-submit-enters-awaiting-settle
```

### Revise

```text
core2-revise-starts-only-from-idle
core2-revise-atomically-replaces-four-canon-docs
core2-revise-preserves-world-id-title-and-day-history
core2-revise-parent-commit-preserves-old-canon
core2-revise-cancel-keeps-world-unchanged
```

### Settle

```text
core2-settle-only-available-awaiting-settle
core2-settle-publishes-idle-day-null-last-settled-day
core2-settle-keeps-day-documents-byte-identical
core2-settle-empty-staging-is-valid
core2-settle-conflict-does-not-publish
```

### Abandon

```text
core2-abandon-available-from-planned
core2-abandon-available-from-awaiting-settle
core2-abandon-removes-only-core2-owned-current-day-documents
core2-abandon-keeps-last-settled-day
core2-replanning-after-abandon-reuses-same-day
core2-abandoned-content-remains-reachable-from-parent
```

### Session mechanics

```text
core2-all-session-kinds-use-one-conversation-per-session
core2-all-session-kinds-stream-send-final
core2-all-session-kinds-keep-submit-final-private
core2-all-session-kinds-use-compression-lifecycle
core2-all-session-kinds-terminalize-on-conversation-failure
core2-all-session-kinds-terminalize-on-agent-failure
core2-all-session-kinds-terminalize-on-invalid-submission
core2-all-session-kinds-drain-summary-provider-before-operation-settles
core2-stale-child-end-cannot-clear-new-child
```

### Product closure

```text
core2-full-lifecycle-empty-to-day2-planned
core2-full-lifecycle-has-no-stable-dead-end
core2-full-lifecycle-revise-between-days
core2-full-lifecycle-abandon-planned-and-replan
core2-full-lifecycle-abandon-awaiting-settle-and-replan
```

### Consumer capability closure

```text
uninitialized → Init discoverable
idle          → Planning + Revise discoverable
planned       → Play + Abandon discoverable
awaiting      → Settle + Abandon discoverable
session ready → send + submit + cancel
running       → loading can be projected from status
send          → output.delta available
```

---

## 37. Definition of Done

Core2 只有全部满足才算完整：

1. `@dayloom/archive-protocol` + Core2 World Profile V0 是 persisted-data唯一规范来源。
2. Production Core2 不 import legacy Core 或 TUI。
3. 现有 PlayPlanV0 / PlaySubmissionV1 不因补完整 lifecycle 被擅自重写。
4. 空 `worldRoot` → `uninitialized`，不是 constructor WORLD_INVALID。
5. partial/malformed durable archive → `invalid`，绝不被 Init 覆盖。
6. `uninitialized` 只提供 Init。
7. Init 支持多轮 send / streaming / submit / cancel。
8. Init submit 首次原子发布 Archive V2 → `idle`，不生成 plan。
9. 同进程 Init pre-current failure 只清理本 attempt 新建内容并恢复 uninitialized。
10. crash residue fail-closed 为 invalid；不为此增加 recovery coordinator。
11. `idle` 提供 Planning + Revise。
12. Planning target Day ID 由 Core2 生成，V0 为 `day1/day2/...`。
13. Planning beat ID 由 Core2 生成；模型只提交业务 intent。
14. Planning 持久化**现有 PlayPlanV0**，进入 `planned`。
15. Play 保持当前 Promptpile React、streaming、compression、strict relation validation、atomic publication correctness。
16. Play submit → `awaiting-settle`，且不是死路。
17. Settle deterministic 发布新 commit → `idle`，推进 `lastSettledDay`，不重写 day bytes。
18. Revise 使用 full canon snapshot replacement，不引入 patch framework。
19. Abandon 只从 visible tree 删除 Core2-owned current-day docs，parent history 保留。
20. Abandon 后 Planning 重新得到同一个未 settle Day ID。
21. 四类 conversational Session 从创建到 terminal 使用一个持续 writable Conversation identity。
22. 四类 Session 共用已验证 Promptpile / React / compression mechanics，不复制四套 runtime。
23. compression beta.2 live-trigger、restore-source、timeout/drain、error preservation theorem 全部保持。
24. 六类 publication 使用一个 mechanical primitive；business legality 仍在具体模块。
25. `current.json` 对所有 publication 始终是最终 **World visibility switch**；之后只允许不影响 World truth 的 diagnostic 更新。
26. Public API/event 不含 presentation state。
27. 不引入 command bus、StateMachine framework、RuntimeOperations framework、plugin/provider framework、queue、scheduler 或并发系统。
28. Core2 implementation 阶段不修改 restored TUI 来迁就未完成能力。
29. 从空 World 到 `day2 planned` 的完整 headless lifecycle 通过。
30. 每个合法 stable state 都有合法下一步；invalid 是明确 fail-closed terminal diagnostic，不存在意外业务死路。
31. Core2 package metadata 不再宣称 Play-only runtime。
32. Core2 tests 在 Linux/Windows × Node 20/22 全绿。
33. 只有以上全部满足，才允许重新迁移 TUI。
34. 后续 TUI migration 以 interaction capability closure 为验收标准，不要求旧 Core API/data/event compatibility。

---

## 38. 最终架构 theorem

```text
                         Consumer
                  TUI / Web / CLI / GUI
                           │
                  application semantics
                           │
                           ▼
┌───────────────────────────────────────────────────────────────┐
│                           Core2                               │
│                                                               │
│  World read                                                   │
│    uninitialized | invalid | published                        │
│                                                               │
│  Dayloom World Profile V0                                     │
│    canon + day plan/play/summary                              │
│                                                               │
│  Conversational Sessions                                      │
│    init | planning | play | revise                            │
│                                                               │
│  Deterministic mutations                                      │
│    settle | abandonDay                                        │
│                                                               │
│  business legality + submission validation                    │
│  one mechanical Archive publication primitive                │
└──────────────┬─────────────────┬─────────────────┬─────────────┘
               │                 │                 │
               ▼                 ▼                 ▼
      promptpile-compress   Promptpile React   Archive Protocol
               │                 │                 │
               └────── Conversation / Agent ──────┘
                                   │
                                   ▼
                         Published Archive V2
```

最终链路：

```text
new data model defines truth
→ Core2 defines minimal application legality
→ Promptpile ecosystem owns Conversation / agent mechanics
→ Archive Protocol validates persisted graph
→ atomic publication creates new truth
→ consumers project complete product interaction
```

最终一句话：

> **Core2 不重写旧 Core，也不为 TUI 定制接口；它围绕新的 Archive V2 / Dayloom World Profile V0，完整拥有 Dayloom 产品生命周期，并以最少、可验证的 application semantics 让包括 TUI 在内的消费者自然完成全部交互。**
