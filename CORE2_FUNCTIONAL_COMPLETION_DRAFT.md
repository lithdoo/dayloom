# Dayloom Core2 产品生命周期实现冻结

> Status: **Implementation Freeze / 可直接实施**  
> Date: 2026-08-14  
> Target: `@dayloom/core2`  
> Implementation base: current `dev`  
> Data foundation: `@dayloom/archive-protocol` + Core2 Dayloom World Profile  
> Consumer acceptance reference: restored full Dayloom TUI interaction capabilities

本文重新冻结 Core2 的完整产品生命周期。

此前 `CORE2_IMPLEMENTATION_DRAFT.md` 正确冻结了 Archive V2、Promptpile、Promptpile React、单执行流、Play、publication 等新边界，但错误地把产品范围收缩为 Play-only。随后 TUI 迁移又反过来迁就这个不完整能力集，造成产品能力缺失。

本冻结纠正的不是 Core2 的技术方向，而是 **completion boundary**。

Core2 的规范来源从高到低固定为：

```text
1. @dayloom/archive-protocol
   + Core2 Dayloom World Profile
   = persisted data / graph / publication correctness

2. 已冻结并验证的 Core2 ownership
   + Promptpile / Promptpile React / compression contracts
   = runtime correctness

3. Dayloom 完整产品交互所需要的 application capabilities
   = completion requirement

4. restored TUI
   = consumer acceptance reference

5. @dayloom/core / @dayloom/core-old
   = historical behavior reference only
```

明确禁止把第 5 层反过来变成 Core2 的规范来源。

最终原则：

> **Core2 以新的 Archive V2 / Dayloom World 数据结构为基础，提供足以支撑完整 Dayloom 产品交互的最小、consumer-neutral application semantics。TUI 是验收消费者之一，不是架构接口；旧 Core 不是规范。**

---

## 1. 唯一目标

Core2 必须形成一条从空 World 开始、可以持续运行且没有稳定死路的完整业务闭环：

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

同时存在两个真实产品旁路：

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

这条 lifecycle 来自新的 World Profile 与产品能力关系：

```text
Init      owns initial manifest + canon creation
Planning  owns next day plan creation
Play      consumes pinned plan and produces play result
Settle    closes the current day
Revise    replaces current canon snapshot
Abandon   discards the current unfinished day from the visible tree
```

不是从旧 Runtime phase 表逐项复制。

---

## 2. 产品能力闭环，而不是旧 Core parity

Core2 完成后，任意 consumer 至少能够表达以下用户意图：

```text
创建 World
规划下一天
进入当前行动
修订 World canon
结算当前一天
放弃当前未完成的一天

在 conversational flow 中：
  多轮自然语言输入
  用户可见 streaming Final
  submit
  cancel

读取：
  当前 World 是否存在 / 是否有效
  当前 published phase / day
  当前 active Session
  当前可用业务能力
```

恢复后的完整 TUI 应能够只根据这些 application semantics 投影其原有交互能力。

TUI 本地能力仍然不属于 Core2：

```text
Hub / Session page
status/help mode
selected action
widget
footer
focus
scroll
loading label
shortcut
presentation message formatting
```

旧 `@dayloom/core` 可以用于确认历史产品行为，例如“过去用户是否有 Init / Planning / Revise / Settle / Abandon 的入口”，但不得用于决定：

```text
Core2 public API shape
Core2 event shape
World document shape
Day ID grammar
submission DTO
Archive layout
persistent phase
runtime internal architecture
```

---

## 3. Greenfield 边界继续冻结

Core2 仍然是 clean greenfield runtime，不是 legacy compatibility layer。

禁止 import：

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

Core2 不实现：

```text
TUI adapter
TuiRuntimeDriver / TuiDriverState
RuntimeSnapshot compatibility
RuntimeEvent compatibility
executeCommand compatibility
CommandRegistry compatibility
StateMachine compatibility
RuntimeOperations compatibility
Archive V1 compatibility
World migration
```

允许从旧代码读取行为事实，但生产代码不得依赖旧 package。

---

## 4. Ownership theorem

```text
Archive Protocol
  owns persisted-data correctness
  owns strict parsing / path / hash / tree / staging / relation validation

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
  owns Promptpile/React invocation policy
  owns untrusted submission parsing + business validation
  owns Core2-owned document construction
  owns atomic publication policy
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

## 5. Persistent state 与 transient state 必须分离

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

这些都是 transient runtime state，由 active Session 表达。

同样：

```text
uninitialized
invalid
```

也不是 Archive phase。

它们表达的是：

```text
uninitialized = 尚不存在 Published Archive V2 World
invalid       = root 中存在 archive evidence，但不能验证为合法 Published World
published     = 存在合法 Published Archive V2 World
```

---

## 6. Core2 Dayloom World Profile V1

Core2 在 Archive Protocol 之上只拥有下面这些业务路径：

```text
canon/premise.md
canon/rules.md
canon/style.md
canon/user-role.md

days/<day>/plan.json
days/<day>/play.json
days/<day>/summary.md
```

Core2 不要求 root tree 只能存在这些路径。

其它 domain / consumer-owned document 可以存在；Core2 不修改自己不拥有的路径。

所有路径仍必须通过 Archive Protocol public path contract。

### 6.1 Canon

任何 `published` World 必须存在四个 canon 文档：

```text
canon/premise.md
canon/rules.md
canon/style.md
canon/user-role.md
```

它们是当前 commit 的完整 canon snapshot。

历史 canon 由 immutable commit/tree 自然保存，不再创建 canon revision framework。

Markdown 内容可以为空；Core2 不人为添加“至少多少字”的业务 policy。

### 6.2 Day identity

Core2 自己生成 Day ID；模型与 consumer 均不能指定。

V1 固定：

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

生成规则：

```text
lastSettledDay = null   → day1
lastSettledDay = dayN   → day(N + 1)
```

`day_0001` 等 legacy grammar 不进入 Core2。

如果 persisted `lastSettledDay` 不符合 Core2 Day ID grammar，World 对 Core2 为 `invalid`。

### 6.3 Plan document

`days/<day>/plan.json` V1：

```ts
interface PlayPlanV1 {
  version: 1;
  intent: string;
  beats: Array<{
    id: string;
    intent: string;
  }>;
}
```

规则：

```text
exact keys
version === 1
intent trim 后非空
beats 是 array，可为空
beat.id trim 后非空且唯一
beat.intent trim 后非空
```

Planning 模型不生成 beat ID。

Core2 根据数组顺序生成：

```text
beat1
beat2
beat3
...
```

因此 persisted beat identity 由 Core2 拥有。

### 6.4 Play / summary

现有 Core2 已落地的 Play contract 继续有效：

```text
days/<day>/play.json
  = resolved beats + events

days/<day>/summary.md
  = final day summary
```

Play submission 继续严格校验 pinned plan relation。

---

## 7. Stable published invariants

### idle

```text
phase = idle
day = null
```

`lastSettledDay`：

```text
null
或合法 Core2 Day ID
```

如果 `lastSettledDay != null`，该 day 在当前 tree 中必须至少存在：

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

当前 day 必须：

```text
plan.json exists + valid
play.json absent
summary.md absent
```

### awaiting-settle

```text
phase = awaiting-settle
day = Core2 Day ID
```

当前 day 必须：

```text
plan.json exists + valid
play.json exists + valid
summary.md exists
```

Core2 initialization/read 不需要每次重新扫描全部历史天数；它必须验证当前 control 所直接依赖的 canon/current day/lastSettledDay relation。需要作为 Session context 读取的历史 document 再按 blob identity 验证。

---

## 8. Public World state

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

### uninitialized

表示尚无 Published World。

它是正常 application state，不是 initialization error。

### invalid

表示存在 archive evidence，但 graph / relation / Dayloom Profile 无法验证。

规则：

```text
Core instance 可以创建
mutation capabilities 全 false
consumer 可展示结构化诊断
Core2 不自动 repair
Core2 不允许 Init 覆盖
```

### published

表示：

```text
manifest
→ current
→ commit relation
→ root tree identity
→ required Core2 profile relations
```

均通过验证。

---

## 9. Uninitialized / invalid 判定

`createDayloomCore()` 必须先确保 `worldRoot` directory 存在，然后分类。

### 9.1 uninitialized

以下情况是 `uninitialized`：

```text
没有 manifest.json
没有 current.json
没有 commits/objects/operations 中任何持久化 Archive graph evidence
```

仅存在：

```text
.locks/
logs/
Core2 runtime housekeeping
```

不构成 Published World。

### 9.2 invalid

只要出现“部分 Archive”或“损坏 Archive”，就不能退回 uninitialized，例如：

```text
manifest without current
current without manifest
current without commit
commit relation mismatch
tree hash mismatch
required canon missing
planned without valid plan
awaiting-settle without play/summary
Core2 Day ID relation invalid
```

→ `world.status = invalid`

这条边界防止 Init 覆盖已有但损坏的数据。

---

## 10. Public Session state

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

Session identity 从 Session 创建开始持续到 submit/cancel/failure terminalize。

一个 Session 生命周期内只使用一个 writable Promptpile Conversation identity。

不公开任何 presentation state。

---

## 11. Public API

```ts
export interface CreateDayloomCoreOptions {
  worldRoot: string;
  llmConfigPath: string;
}

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

export function createDayloomCore(
  options: CreateDayloomCoreOptions,
): Promise<DayloomCore>;
```

这是 application API，不是 TUI API。

不引入：

```text
executeCommand(command)
command bus
command registry
backend interface
compatibility adapter
consumer-specific facade
```

四个 conversational flow 使用一个 `startSession(kind)`；两个 deterministic World mutation 使用明确方法。

---

## 12. Capability theorem

没有 active Session 且没有 mutation in flight 时：

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

Session controls：

```text
ready
  send = true
  submit = true
  cancel = true

running
  send = false
  submit = false
  cancel = false

submitting
  send = false
  submit = false
  cancel = false
```

Core2 不支持运行中的 cancel，不建立中断状态机。

---

## 13. 单执行流状态机

Core2 不支持业务并发。

只允许一个 active Session 或一个 stable World mutation。

```text
no session
  ├─ startSession(kind) → ready
  ├─ settle()           → mutation
  └─ abandonDay()       → mutation

ready
  ├─ send()   → running → success → ready
  ├─ submit() → submitting → terminal
  └─ cancel() → terminal
```

任何同时进入的 mutation：

```text
→ BUSY
```

不创建：

```text
queue
scheduler
actor
worker
retry coordinator
mutation manager
```

跨 Core instance 的 publication conflict 由 publication lock + pinned-base recheck 处理。

---

## 14. Init lifecycle

Init 是 conversational Session。

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

World 不发生 mutation。

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
canon 四个字段必须是 string
unknown fields rejected
```

Core2 自己：

```text
generate worldId
generate operationId / commitId
set revision = 1
construct manifest.json
construct canon markdown bytes
choose control = idle/day:null/lastSettledDay:null
```

Init 不生成 day plan。

因此 Init 完成后用户下一步仍然是 Planning；example 不能偷偷跳过 Planning。

---

## 15. Planning lifecycle

Planning 是 conversational Session，对应产品中的“开始/规划下一天”。

```text
published idle
  → startSession('planning')
  → targetDay = Core2.nextDay(lastSettledDay)
  → ready
  → send*
  → submit
  → days/<targetDay>/plan.json
  → published planned(targetDay)
```

Cancel：

```text
planning ready
  → cancel
  → published idle unchanged
```

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

Core2 校验：

```text
exact keys
version === 1
intent trim 后非空
beats array
每个 beat 只有 intent
beat.intent trim 后非空
```

Core2 构造 persisted plan：

```json
{
  "version": 1,
  "intent": "...",
  "beats": [
    { "id": "beat1", "intent": "..." },
    { "id": "beat2", "intent": "..." }
  ]
}
```

Day identity 已经由路径提供，不在 JSON 中重复写 `day`。

---

## 16. Play lifecycle

Play 保留当前已经验证通过的新 Core2 contract。

```text
published planned(dayN)
  → startSession('play')
  → pin current World + canon + plan
  → ready
  → send*
  → submit
  → play.json + summary.md
  → published awaiting-settle(dayN)
```

Cancel：

```text
play ready
  → cancel
  → published planned unchanged
```

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

继续要求：

```text
submission beats 与 pinned plan 顺序/id 完全对应
event ids unique
beat/event relations valid
unknown fields rejected
summary non-empty
```

这里的 beat/event id 是 submission 内部 relation token；Archive / World / Day / commit identity 仍全部由 Core2/Protocol ownership 控制。

---

## 17. Revise lifecycle

Revise 是 conversational Session，只修改 Core2-owned canon snapshot。

```text
published idle
  → startSession('revise')
  → pin current canon
  → ready
  → send*
  → submit
  → new commit with replaced canon docs
  → published idle
```

Cancel：

```text
revise ready
  → cancel
  → published idle unchanged
```

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

Revise 输出完整 canon snapshot，而不是 patch DSL。

理由：

```text
只有一个真实 canon representation
publication 只有明确 PUT
immutable parent commit 自然保存旧版本
不需要第二套 patch language / merge framework
```

Revise 不修改 day history，不修改 title，不修改 World identity。

---

## 18. Settle lifecycle

Settle 是 deterministic World mutation，不启动 AI Session。

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

Settle 不复制、不重写 day documents。

因此 candidate root tree 可以与 base root tree 完全相同。

这是合法 publication：

```text
empty staging
same rootTreeHash
new commit control
new revision / commitId / operationId
current.json LAST
```

Settle 只关闭业务控制状态；day 内容已经由 awaiting-settle commit 成为 immutable Published truth。

---

## 19. Abandon Day lifecycle

Abandon Day 也是 deterministic World mutation。

从：

```text
published planned(dayN)
published awaiting-settle(dayN)
```

均可执行。

行为：

```text
remove from candidate current tree:
  days/<day>/plan.json
  days/<day>/play.json      if present
  days/<day>/summary.md     if present

publish:
  phase = idle
  day = null
  lastSettledDay unchanged
```

parent commit/tree 仍引用被 abandon 的内容，因此历史没有被物理删除。

下一次 Planning：

```text
nextDay(lastSettledDay)
```

自然重新得到同一个未完成 day。

Core2 不创建 abandoned marker document；当前产品没有第二个真实 consumer 需要它。

---

## 20. Session context theorem

每个 Session 在开始时 pin 当时的 authoritative application state。

一个 Session 内 context layer immutable。

### Init context

没有 Published World context。

只使用 Core2-owned system prompt：

```text
通过多轮自然语言建立 World title + initial canon
```

### Planning context

至少包含：

```text
current canon
Core2-derived targetDay
last settled day summary（若存在）
```

### Play context

保持当前已验证：

```text
current canon
pinned current-day plan
```

### Revise context

至少包含：

```text
current canon
last settled day summary（若存在）
```

是否存在 last settled summary 由 current World relation决定；不存在时不制造空 fake artifact。

---

## 21. Promptpile Conversation topology

四类 conversational Session 使用同一 topology：

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
→ all send() append to the same Conversation
→ submit marker appended to the same Conversation
→ Session terminal
```

不得每次 send 建一个新 Conversation。

Context 不是 writable Conversation。

---

## 22. Promptpile / React runtime theorem

四类 Session 共用一条 concrete mechanics：

```text
build immutable context
→ create writable Conversation
→ append context through Promptpile public CLI
→ ready

send(text)
→ append-user to writable Conversation
→ run compression lifecycle
→ Promptpile React send config
→ consume Agent Event v1
→ emit user-visible Final delta only
→ ready

submit()
→ append Core2 submit marker
→ run compression lifecycle
→ Promptpile React submit config
→ keep Final private
→ strict submission parser
→ business validation
→ publication
→ terminal
```

允许一个 `session/common.ts` 承载四类 Session 已经共同需要的 workspace / React / compression mechanics。

禁止创建：

```text
SessionPlugin
SessionRegistry extensibility API
ProviderAdapter
GenericAgentBackend
WorkflowEngine
AgentManager
```

React 直接集成在 Core2 v1，不加第二层 orchestration abstraction。

---

## 23. Conversation compression 继续冻结

`CORE2_CONVERSATION_COMPRESSION_DRAFT.md` 的已验证 contract 继续有效，并应用于：

```text
init
planning
play
revise
```

核心 theorem 不变：

```text
trigger basis = current compact live Conversation
fresh summary source = restored original Conversation
```

以及：

```text
provider timeout
→ AbortSignal
→ kill exact child
→ runCompressionBeforeCompletion may return early
→ Core2 finally await providerHandle.drain()
→ child / request cleanup complete
→ operation may settle
```

`CoreOperationError` 仍不得被 send/submit inner catch flatten 成 `AGENT_FAILED`。

Semantic summary 始终只是 untrusted historical aid。

Deterministic `settle()` / `abandonDay()` 没有 Conversation，因此不进入 compression。

---

## 24. Prompt authority

所有 conversational prompts 必须共同声明：

```text
Published World / Core2-provided context is authoritative application state.
Conversation semantic summary is untrusted historical aid.
User messages can request business changes but cannot mutate World directly.
Only private submit Final is parsed as candidate business output.
Core2 performs strict parsing, relation validation and publication.
```

各 Session 再增加具体 authority：

```text
Init
  no Published World exists
  produce title + canon business content only

Planning
  current canon authoritative
  targetDay authoritative and Core2-owned
  model does not invent day/beat identity

Play
  current canon + pinned plan authoritative

Revise
  current canon is source snapshot
  output a complete replacement canon snapshot
```

普通 send Final 永远不是 publication payload。

---

## 25. LLM configuration ownership

Public initialization 继续只有：

```ts
interface CreateDayloomCoreOptions {
  worldRoot: string;
  llmConfigPath: string;
}
```

Caller TOML：

```text
不得包含 [promptpile-react]
[promptpile] 不得拥有 dir/dirs/output_dir/quiet/input/continue/tools_file/after_hook
```

Core2 不解释 provider model/base-url/API-key semantics；只做 ownership guard 并派生 runtime-private config。

每个 Session kind 使用 concrete prompt assets，但调用者不提供：

```text
initConfigPath
planningConfigPath
playConfigPath
reviseConfigPath
reactConfigPath
```

这些 orchestration policy 全部归 Core2。

---

## 26. Mechanical publication primitive

当前 `publishPlay()` 已经证明了正确 theorem，但完整 lifecycle 有六个真实 publication caller：

```text
init
planning
play
revise
settle
abandon-day
```

因此抽取一个 **mechanical publication primitive** 是必要共享，而不是 hypothetical framework。

建议 private input：

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

它只负责机械 correctness：

```text
PUT/DELETE → canonical StagingManifestV1
buildCandidateTreeV1
hash/encode target tree
construct + parse/validate target operation/commit
validate operation↔staging
validate parent relation when base exists
validate prepared target relation
acquire exclusive publication lock
recheck exact base under lock
install immutable blobs/tree/commit/operation
install manifest for initial publication
replace current.json as final visibility step
release lock
return visible PublishedWorld
```

它不负责任何业务 legality 或 document construction。

禁止把它扩张成：

```text
WorldMutationManager
OperationRegistry
CommandBus
TransactionFramework
```

---

## 27. Initial publication theorem

Init 的 publication base 是 empty Archive：

```text
baseRevision = 0
baseCommitId = null
baseRootTreeHash = null
parentCommitId = null
revision = 1
```

完整顺序：

```text
build + validate candidate graph completely
→ acquire .locks/publish.lock
→ recheck root still uninitialized
→ install immutable blobs
→ install immutable tree
→ install immutable commit
→ install prepared operation
→ install manifest.json
→ atomic replace/create current.json LAST
```

只有 `current.json` 出现后才存在 Published World。

任何 pre-current failure：

```text
reader 仍判定 World 为 uninitialized
```

可能残留的不可达 immutable objects 不构成 Published World。

若锁内发现另一实例已经完成 Init：

```text
WORLD_CONFLICT
```

绝不覆盖。

---

## 28. Update publication theorem

Planning / Play / Revise / Settle / Abandon 全部 pin：

```text
revision
commitId
rootTreeHash
```

锁内重新读取 current public truth。

任何一项不一致：

```text
WORLD_CONFLICT
current.json unchanged by this operation
```

Settle 的 empty staging 必须被支持：

```text
candidateTreeHash === baseTreeHash
```

这不是 no-op，因为 commit control 与 revision 发生合法变化。

Publication visibility theorem 始终是：

> **所有 immutable target graph 先完整安装并验证，`current.json` 是最后一个公开可见写入。**

---

## 29. Business modules

建议结构：

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

具体 business module 只做：

```text
require exact source application state
pin authoritative context
parse/validate candidate submission
construct Core2-owned document bytes
choose target stable control
call mechanical publication primitive
```

不要创建：

```text
StateMachine class
CommandRegistry
RuntimeOperations interface
operation handler registry
backend abstraction
```

现在只有四种 Session + 两种 stable mutation，直接代码比通用 framework 更清晰。

---

## 30. Public errors

保留 Core2 当前 error philosophy，只增加完整 lifecycle 真正需要的 `WORLD_INVALID` operation error：

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

export type CoreResult =
  | { ok: true }
  | {
      ok: false;
      error: {
        code: CoreErrorCode;
        message: string;
      };
    };
```

映射：

```text
当前 capability 不允许                 → NOT_AVAILABLE
另一个 Core2 mutation 已在执行          → BUSY
用户 text trim 后为空                   → INVALID_INPUT
Promptpile append/compression failure   → CONVERSATION_FAILED
Promptpile React completion failure     → AGENT_FAILED
submit JSON / business relation invalid → SUBMISSION_INVALID
publication lock/base conflict          → WORLD_CONFLICT
operation 中重新读取发现 World 损坏     → WORLD_INVALID
Core2 fixed policy / unexpected failure → INTERNAL_ERROR
disposed instance                       → DISPOSED
```

Public expected application failure 不 throw。

### Initialization error

`createDayloomCore()` 只对无法创建 Core instance 的问题 throw：

```ts
class CoreInitializationError extends Error {
  code: 'INVALID_OPTIONS' | 'INTERNAL_ERROR';
}
```

World malformed 已经由 `CoreWorldState.invalid` 表达，不再作为 constructor exception。

---

## 31. Public events

继续保持极小 event surface：

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

规则：

```text
subscribe() 不 replay initial state；consumer 用 getState()
state.changed 在 public state 更新后按顺序发出
listener exception 隔离
output.delta 只来自普通 send() 的用户可见 Final
submit Final 永远 private
Thought/Observe/Check/raw protocol 永不公开
```

TUI loading 可由：

```text
session.status = running | submitting
```

投影，不为 presentation 新增 loading event protocol。

---

## 32. Session failure semantics

四类 conversational Session 完全统一：

```text
send success
  → ready

send append/compression/agent failure
  → terminal Session
  → Published World unchanged

submit parse/business/prepublication failure
  → terminal Session
  → Published World unchanged

submit publication conflict/failure before current
  → terminal Session
  → Published World unchanged by this operation

submit publication success
  → terminal Session
  → new Published World

cancel ready
  → terminal Session
  → Published World unchanged
```

失败 Session 不保留供 retry。

用户重新进入对应 capability，形成清楚的 recovery boundary。

---

## 33. Dispose / child ownership

当前 Core2 已验证的 identity-safe child ownership 扩展到所有 Session：

```ts
childStarted(child) {
  this.activeChild = child;
}

childEnded(child) {
  if (this.activeChild === child) this.activeChild = null;
}
```

Dispose：

```text
mark disposed
→ disable all capabilities
→ kill exact active child if any
→ active operation settles through its own finally cleanup
→ remove runtime workspace only after owned cleanup boundary
```

Compression provider `drain()` theorem继续有效。

Stale child end 不能清掉 newer child。

---

## 34. TUI capability acceptance gate

Core2 完整实现期间：

```text
packages/tui
→ 保持恢复后的完整 @dayloom/core backend
```

不得再次通过修改 TUI 来“证明”Core2 完成。

Core2 的 headless tests 全部完成后，才允许新的 TUI migration review。

迁移验收标准不是 API compatibility，而是 interaction capability closure：

```text
完整 TUI 所需要的业务动作
→ 都能从 Core2 state/capabilities 调用

完整 TUI Session 的自然语言/streaming/submit/cancel
→ 都能从 Core2 API/events 投影

TUI status/help/layout/focus/loading text
→ 仍由 TUI 自己拥有
```

迁移禁止重新引入：

```text
Core2 TUI adapter
fake RuntimeSnapshot
fake RuntimeEvent
Core2Backend / OldCoreBackend 双 backend framework
```

---

## 35. 与既有文档关系

### `CORE2_IMPLEMENTATION_DRAFT.md`

以下已验证 contract 继续有效：

```text
Archive V2 ownership
Promptpile ownership
Promptpile React direct integration
consumer-neutral API principle
single execution flow
Play Session mechanics
PlaySubmission contract
publication theorem
public result/error philosophy
no deep imports
```

以下 Play-only scope 被本文取代：

```text
init/planning/revise/settle/abandon 非目标
World 必须预先 published
startSessions 只能是 play
```

因此原文应理解为 **Core2 Play slice freeze**，不是完整产品 lifecycle freeze。

### `CORE2_CONVERSATION_COMPRESSION_DRAFT.md`

继续完整有效。

本冻结只把它从 Play 扩展到：

```text
init
planning
play
revise
```

不修改 compression ownership 或 beta.2 lifecycle semantics。

### `TUI_CORE2_ADAPTATION_DRAFT.md`

已被证明不能作为 Core2 completion 的规范来源。

TUI 先按 `TUI_RESTORATION_PLAN.md` 恢复完整行为；未来迁移必须重新独立评审。

### `@dayloom/core`

仅是历史产品行为参考。

不得因为旧 Core 存在某个：

```text
type
phase
command
DTO
manager
repository
```

就将其引入 Core2。

---

## 36. 实施顺序冻结

### Step 0 — Guard the restored TUI

在 Core2 completion 分支/提交中建立 guard：

```text
packages/tui/** 不得修改
```

### Step 1 — World classification

实现：

```text
uninitialized
invalid
published
```

并落实 Dayloom World Profile invariants。

### Step 2 — Publication primitive

从当前 `publishPlay()` 提取 mechanical theorem。

先保证现有全部 Play/publication/compression tests 不回归。

### Step 3 — Init

实现：

```text
InitSubmissionV1
Init prompts/workspace
initial publication
```

验收：真正空目录 → published idle。

### Step 4 — Planning

实现：

```text
Core2 nextDay()
PlanningSubmissionV1
Core2 beat identity construction
plan publication
```

验收：idle → planned(day1)。

### Step 5 — Revise

实现 full canon snapshot replacement。

### Step 6 — Settle

实现 empty-staging deterministic publication。

### Step 7 — Abandon Day

实现 Core2-owned current day document DELETE publication。

### Step 8 — Session common mechanics

将当前 Play 已验证的 Conversation / React / compression mechanics提取为四种真实 Session 共用的 concrete helper。

不得先抽象再找使用者。

### Step 9 — Full headless lifecycle

从真正空 root 连续执行：

```text
Init
→ Planning(day1)
→ Play(day1)
→ Settle(day1)
→ Revise
→ Planning(day2)
```

并独立覆盖 Abandon/replan。

### Step 10 — CI

完整 Core2 suite：

```text
Ubuntu  Node 20
Ubuntu  Node 22
Windows Node 20
Windows Node 22
```

全部 green。

### Step 11 — TUI migration eligibility

只有 Definition of Done 全部满足后，Core2 才获得重新迁移 TUI 的资格。

---

## 37. 必须覆盖的 acceptance tests

### Architecture / normative boundary

```text
core2-has-no-legacy-core-imports
core2-has-no-tui-imports
core2-has-no-deep-protocol-or-promptpile-imports
core2-world-profile-uses-day1-day2-grammar
core2-planning-model-does-not-own-day-or-beat-identity
```

### World classification

```text
core2-empty-root-is-uninitialized
core2-housekeeping-only-root-is-uninitialized
core2-empty-root-exposes-init-only
core2-partial-archive-is-invalid-not-uninitialized
core2-invalid-world-exposes-no-mutations
core2-published-idle-validates-canon
core2-planned-validates-current-plan-relation
core2-awaiting-settle-validates-current-play-summary-relation
```

### Init

```text
core2-init-starts-only-from-uninitialized
core2-init-cancel-keeps-world-uninitialized
core2-init-submit-publishes-revision-1-idle
core2-init-generates-world-id-in-core
core2-init-does-not-create-day-plan
core2-init-current-json-is-final-visibility-step
core2-init-precurrent-failure-remains-uninitialized
core2-concurrent-init-detects-world-conflict
```

### Planning

```text
core2-planning-starts-only-from-idle
core2-planning-derives-day1-after-init
core2-planning-derives-day2-after-day1-settle
core2-planning-generates-beat1-beat2-identities
core2-planning-submit-publishes-plan-and-planned
core2-planning-cancel-keeps-idle-world
core2-planning-model-cannot-override-target-day
```

### Play

保留当前全部 Play、submission、streaming、compression、publication tests，并补：

```text
core2-play-consumes-core2-generated-plan-identities
core2-play-submit-publishes-awaiting-settle
```

### Revise

```text
core2-revise-starts-only-from-idle
core2-revise-submit-replaces-four-canon-documents-atomically
core2-revise-does-not-change-world-identity-title-or-day-history
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
core2-replanning-after-abandon-reuses-same-day-id
core2-abandoned-content-remains-reachable-from-parent-commit
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

### Full product closure

```text
core2-full-lifecycle-empty-to-day2-planned
core2-full-lifecycle-has-no-stable-dead-end
core2-full-lifecycle-revise-between-days
core2-full-lifecycle-abandon-planned-and-replan
core2-full-lifecycle-abandon-awaiting-settle-and-replan
```

### Consumer capability closure

Headless acceptance 必须证明，不依赖 TUI implementation：

```text
uninitialized → consumer can discover Init
idle          → consumer can discover Planning + Revise
planned       → consumer can discover Play + Abandon
awaiting      → consumer can discover Settle + Abandon
session ready → consumer can send / submit / cancel
running       → consumer can project loading from status
send          → consumer receives output.delta
```

---

## 38. Definition of Done

Core2 只有满足全部条件才算完整：

1. `@dayloom/archive-protocol` + Core2 World Profile 是唯一 persisted-data规范来源。
2. 生产代码不 import legacy Core 或 TUI。
3. 空 `worldRoot` 创建 Core 得到 `uninitialized`，不是 `WORLD_INVALID` exception。
4. partial/malformed archive 得到 `invalid`，绝不退回 uninitialized。
5. `uninitialized` 只提供 Init。
6. Init 支持多轮 send / streaming / submit / cancel。
7. Init submit 原子首次发布 Archive V2，结果为 `idle`，不偷偷创建 plan。
8. `idle` 提供 Planning + Revise。
9. Planning 的 target Day ID 由 Core2 生成，V1 使用 `day1/day2/...`。
10. Planning 的 beat ID 由 Core2 生成，模型只提交业务 intent。
11. Planning submit 产生严格 `plan.json` 并进入 `planned`。
12. Play 保持当前已验证的 Promptpile React、streaming、compression、strict submission 和 atomic publication correctness。
13. Play submit 进入 `awaiting-settle`，该状态不是死路。
14. Settle deterministic 地发布新 commit，回到 `idle` 并推进 `lastSettledDay`。
15. Revise 使用完整 canon snapshot replacement，不引入 patch framework。
16. Abandon 只从 visible current tree 删除 Core2-owned current day documents，parent history 保留。
17. Abandon 后再次 Planning 得到同一个尚未 settle 的 Day ID。
18. 四类 conversational Session 从创建到 terminal 使用一个持续 writable Conversation identity。
19. 四类 Session 使用同一已验证 Promptpile / React / compression mechanics，而不是四套复制代码。
20. compression beta.2 live-trigger、restore-source、timeout/drain、error preservation theorem 全部保持。
21. 六类 publication 使用一个 mechanical publication primitive；business legality 仍在具体模块。
22. `current.json` 对所有 publication 始终是最后公开可见写入。
23. Core2 public API/event 不包含 page/widget/loading-label/selection 等 presentation state。
24. 不引入 command bus、StateMachine framework、RuntimeOperations framework、provider/plugin framework、queue、scheduler 或并发系统。
25. 完整 headless lifecycle 从空 World 连续到 `day2` planned 通过。
26. 每个 stable state 都至少存在一个合法下一步或明确 terminal/invalid 含义，不存在业务死路。
27. restored TUI 在 Core2 实施期间不被修改来迁就未完成能力。
28. Core2 tests 在 Linux/Windows × Node 20/22 全绿。
29. 只有以上全部满足，才允许重新迁移 TUI 到 Core2。
30. TUI 迁移验收以 interaction capability closure 为准，不要求旧 Core API/data/event compatibility。

---

## 39. 最终目标架构

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
│  World read state                                             │
│    uninitialized | invalid | published                        │
│                                                               │
│  Published World Profile                                      │
│    canon + day plan/play/summary                              │
│                                                               │
│  Conversational Sessions                                      │
│    init | planning | play | revise                            │
│                                                               │
│  Deterministic mutations                                      │
│    settle | abandonDay                                        │
│                                                               │
│  business legality + submission validation                    │
│  one mechanical publication primitive                        │
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

最终 architecture theorem：

```text
new data model defines truth
→ Core2 defines minimal application legality
→ Promptpile ecosystem owns conversation/agent mechanics
→ Archive Protocol validates persistence
→ atomic publication creates new truth
→ consumers project complete product interaction
```

最终一句话：

> **Core2 不重写旧 Core，也不为 TUI 定制接口；它围绕新的 Archive V2 / Dayloom World 数据结构，完整拥有 Dayloom 产品生命周期，并以最少的 application semantics 让包括 TUI 在内的消费者自然完成全部交互。**
