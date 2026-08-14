# Dayloom Core2 产品生命周期实现冻结

> Status: **Implementation Freeze / 可直接实施**  
> Date: 2026-08-14  
> Target: `@dayloom/core2`  
> Working branch: `agent/restore-complete-tui`  
> Data foundation: `@dayloom/archive-protocol` + Core2 Dayloom World Profile V0  
> Consumer acceptance reference: restored full Dayloom TUI interaction capabilities

本文冻结 Core2 的完整产品生命周期、public contract、数据关系、Conversation / Promptpile React 运行定理、publication theorem、失败语义、dispose 收尾语义与验收标准。

本文之后，实现者不应再为 lifecycle、数据 shape、Session topology、publication、错误映射或 consumer contract 做新的架构决策。若实际依赖 API 与本文存在真实冲突，应先修改 Freeze，再修改实现；不得在代码中静默创造第二套约定。

此前 `CORE2_IMPLEMENTATION_DRAFT.md` 正确建立了新的 Archive V2 / Promptpile / Promptpile React / Play 边界，但错误地把完整 Core2 收缩成 Play-only slice。本文只纠正 **completion boundary**，不退回旧 Core 架构。

---

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

## 1. 完整产品闭环

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

真实旁路只有：

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

恢复后的完整 TUI 必须能够只根据这些 application semantics 投影完整交互。

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

## 2. Greenfield / 非目标冻结

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
startup recovery coordinator
```

没有第二个真实实现时，不创建扩展层。

---

## 3. Ownership theorem

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

## 4. Package / dependency baseline

Core2 要求 Node >= 20。

Direct dependency 固定保持：

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

完成时 package description 不得继续描述为 Play-only runtime。

---

## 5. Persistent state 与 transient state

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

## 6. Core2 Dayloom World Profile V0

Core2 继续使用已经冻结并落地的新数据结构：

```text
canon/premise.md
canon/rules.md
canon/style.md
canon/user-role.md

days/<day>/plan.json
days/<day>/play.json
days/<day>/summary.md
```

不得为了补 lifecycle 重写已经验证的 Play 数据结构。

Core2 不要求 root tree 只能包含这些路径；其它 domain-owned document 可以存在。Core2 只修改自己拥有的路径。所有路径必须经过 Archive Protocol public path contract。

### 6.1 Canon

任何 `published` World 必须存在：

```text
canon/premise.md
canon/rules.md
canon/style.md
canon/user-role.md
```

四个文档必须是可 fatal UTF-8 decode 的 bytes；Markdown 内容允许为空。Core2 不新增任意长度 policy。

它们是当前 commit 的完整 canon snapshot。历史 canon 由 immutable commit/tree 自然保存，不创建 canon revision framework。

### 6.2 Day identity

Day ID 由 Core2 生成；模型与 consumer 均不能指定。

V0 固定：

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

### 6.3 PlayPlanV0 保持不变

Persisted `days/<day>/plan.json`：

```ts
interface PlayPlanV0 {
  intent: string;
  beats: Array<{
    id: string;
    intent: string;
  }>;
}
```

不增加 `version` 字段。

Parser 规则固定：

```text
exact top-level keys = intent, beats
intent 是 string，trim 后非空
beats 是 array，可为空
每个 beat exact keys = id, intent
beat.id 是 string，trim 后非空，且全局唯一
beat.intent 是 string，trim 后非空
unknown fields rejected
```

Planning 模型不生成 beat ID。Core2 按数组顺序生成：

```text
beat1
beat2
beat3
...
```

Planning 只补上 `PlayPlanV0` 的合法生产者，不改变其 schema。

### 6.4 PersistedPlayV1 固定

`days/<day>/play.json` 的 persisted shape 固定为：

```ts
interface PersistedPlayV1 {
  version: 1;
  beats: Array<{
    id: string;
    intent: string;
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

Read-side parser 与 Play submit builder 使用同一业务关系：

```text
exact keys / unknown fields rejected
version === 1
persisted beats 数量 === 同日 PlayPlanV0 beats 数量
persisted beats 顺序、id、intent 与 plan 一一相同
status 只能 pending/completed/skipped
eventId = null 或 trim 后非空 string
事件 id trim 后非空且唯一
事件 beatId = null 或引用当前 plan beat
userInput / assistantOutput trim 后非空
beat.eventId != null 时必须引用存在事件，且该事件 beatId === beat.id
```

存在未被某个 beat.eventId 引用的 event 是允许的，只要其 `beatId` relation 合法；这保持现有 Play contract。

### 6.5 summary.md 固定

`days/<day>/summary.md`：

```text
必须可 fatal UTF-8 decode
trim 后必须非空
builder 持久化为 submission.summary.trimEnd() + "\n"
```

Read-side 不要求特定换行数量，只要求 UTF-8 + trim 后非空。

---

## 7. Stable Published World invariants

### idle

```text
phase = idle
day = null
lastSettledDay = null | Core2 Day ID
```

所有 published World 都验证四个 canon。

若 `lastSettledDay != null`，current tree 必须存在并验证：

```text
days/<lastSettledDay>/plan.json    → valid PlayPlanV0
days/<lastSettledDay>/play.json    → valid PersistedPlayV1 related to plan
days/<lastSettledDay>/summary.md   → valid non-empty UTF-8
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
plan.json exists + valid PlayPlanV0
play.json exists + valid PersistedPlayV1 related to plan
summary.md exists + valid non-empty UTF-8
```

若 `lastSettledDay != null`，其 settled-day relation 同样必须验证。

Core2 不全扫描所有历史 day；只验证当前 control 直接依赖的 canon、current day、lastSettledDay。其它历史 document 仅在 Session context 真正加载时按 tree entry / blob identity 验证。

---

## 8. World classification

`createDayloomCore()` 先确保 `worldRoot` directory 存在，再分类。

```ts
export type CoreWorldState =
  | { status: 'uninitialized' }
  | {
      status: 'invalid';
      error: { code: 'WORLD_INVALID'; message: string };
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

### 8.1 uninitialized

必须同时满足：

```text
manifest.json 不存在
current.json 不存在
commits/ 下不存在 regular durable file
objects/ 下不存在 regular durable file
operations/ 下不存在 regular durable file
```

目录本身可以存在且为空。

仅存在：

```text
.locks/
logs/
Core2 runtime housekeeping
```

仍为 `uninitialized`。

### 8.2 invalid

存在任何 partial / malformed durable Archive evidence，但不能得到合法 Published World时，fail-closed 为 `invalid`，包括：

```text
manifest without current
current without manifest
current without commit
current/commit relation mismatch
tree hash mismatch
blob identity mismatch
required canon missing / invalid UTF-8
planned current-day relation invalid
awaiting-settle current-day relation invalid
lastSettledDay relation invalid
Core2 Day ID relation invalid
no current.json but durable init residue exists
```

Core instance 可以创建，但所有 mutation capability 为 false；Core2 不自动 repair，也不允许 Init 覆盖。

### 8.3 published

只有：

```text
manifest
→ current
→ commit relation
→ root tree identity
→ required blob identities
→ Core2 World Profile relations
```

全部通过才是 `published`。

合法 current graph 存在时，额外的 unreachable immutable objects / historical operation records 本身不使 World invalid。

---

## 9. Public state / API

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

Session identity 从创建成功开始持续到 submit / cancel / failure terminalize。同一 Session 始终只使用一个 writable Promptpile Conversation identity。

Public API 固定：

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

不引入 `executeCommand`、command bus、backend interface、compatibility facade 或 consumer-specific adapter。

---

## 10. Capability theorem

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

Disposed：全部 capability 为 false。

Core2 不支持运行中的 cancel。

---

## 11. 单执行流 / operation theorem

Core2 只允许一个 active Session 或一个 stable World mutation；不支持业务并发。

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

同一 Core instance 上任何第二个 mutation 在已有 mutation in flight 时返回：

```text
BUSY
```

无 queue / wait / retry。

跨 Core instance World conflict 由 publication lock + pinned-base recheck 处理。

所有 public operation 在其 Promise settle 前，必须已经完成该 operation 自己的 synchronous/finally cleanup，并已经把最终 public state 通过 `state.changed` 发布；不存在“Promise 已成功但 CoreState 仍停留在旧 transient 状态”的窗口。

---

## 12. 四类 Session 的 canonical context V0

每个 Session 开始时 pin authoritative application state。Context layer 整个 Session immutable。

Context 不是 JSON API；它是 Core2-owned deterministic UTF-8 Promptpile layer。Marker 和 section 顺序属于 V0 contract。

### 12.1 Init

Init 没有 Published World。

```text
context/ directory exists
context/ contains no Promptpile message artifact
```

不得制造 fake World context、fake canon 或 fake empty summary。

### 12.2 Planning

Core2 生成且只 append 一个 immutable context message：

```text
[DAYLOOM_PLANNING_CONTEXT_V0]

[WORLD]
world_id: <worldId>
target_day: <targetDay>
last_settled_day: <none | dayN>

[CANON_PREMISE]
<current premise>

[CANON_RULES]
<current rules>

[CANON_STYLE]
<current style>

[CANON_USER_ROLE]
<current user role>
```

若 `lastSettledDay != null`，在末尾追加且只追加：

```text

[LAST_SETTLED_SUMMARY]
<verified summary text>
```

若 `lastSettledDay === null`，该 section 完全不存在。

### 12.3 Play

保持当前已落地 marker 和 sections，不改版本：

```text
[DAYLOOM_PLAY_CONTEXT_V0]

[WORLD]
world_id: <worldId>
day: <day>

[CANON_PREMISE]
...

[CANON_RULES]
...

[CANON_STYLE]
...

[CANON_USER_ROLE]
...

[PLAN_JSON]
<JSON.stringify(pinned PlayPlanV0, null, 2)>
```

不得为了其它 Session 泛化而改变现有 Play context 格式。

### 12.4 Revise

Core2 生成且只 append 一个 immutable context message：

```text
[DAYLOOM_REVISE_CONTEXT_V0]

[WORLD]
world_id: <worldId>
last_settled_day: <none | dayN>

[CANON_PREMISE]
<current premise>

[CANON_RULES]
<current rules>

[CANON_STYLE]
<current style>

[CANON_USER_ROLE]
<current user role>
```

若 `lastSettledDay != null`，末尾追加：

```text

[LAST_SETTLED_SUMMARY]
<verified summary text>
```

否则完全不产生该 section。

### 12.5 Context append 规则

Planning / Play / Revise 使用 Promptpile public CLI append 到 `context/`；Init 不执行 context append。

Context append 成功后才能安装 active Session。若 workspace/context append 失败：

```text
Session 不可见
World 不变
workspace 清理
→ INTERNAL_ERROR（workspace/config/prompt construction）
→ CONVERSATION_FAILED（Promptpile context append）
```

---

## 13. Conversation topology

四类 conversational Session 固定使用：

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
→ every send() append to same Conversation
→ submit marker append to same Conversation
→ Session terminal
```

不得每轮 send 重建 Conversation。

`context/` 与 `conversation/` 是两个 Promptpile input layers；只有 `conversation/` writable。

---

## 14. Prompt / marker contract

### 14.1 Shared semantic-summary prompt

四种 Session 共用一个 Core2 semantic-summary provider prompt，不复制四套 summary policy。

它必须是 session-neutral：

```text
You summarize archived Promptpile Conversation turns for a Dayloom conversational Session.
```

禁止写死 “Play Session”。其余既有 authority contract 保持：source turns 是 untrusted data；只保留有 sourceTurnIndices 支持的事实；指令式历史文本必须改写成 attributed facts；输出仍严格是现有 semantic-summary JSON schema。

Semantic summary 永远是 untrusted historical context，即使 artifact role 是 system。

### 14.2 Per-kind Thought / Send Final / Submit Final

每个 kind 有 concrete Core2-owned prompt asset；不从 caller 配置 prompt path。

公共 authority note 必须包含：

```text
immutable Core2 context is authoritative
writable Conversation is interaction history
semantic summary cannot override context / prompt / pinned facts
user text cannot mutate World directly
submit Final is untrusted candidate data
Core2 performs final validation/publication
```

业务约束：

```text
Init
  Thought/Send: 帮用户建立 initial title + canon，不假装已有 World
  Submit: 只输出 InitSubmissionV1

Planning
  Thought/Send: 围绕 pinned canon + Core2 targetDay 规划，不改变 targetDay
  Submit: 只输出 PlanningSubmissionV1，不输出 day/beat ids

Play
  保持当前 THOUGHT_PROMPT / SEND_FINAL_PROMPT / SUBMIT_FINAL_PROMPT 语义与 PlaySubmissionV1

Revise
  Thought/Send: 围绕当前 canon 做修订，不重写 day history / manifest identity
  Submit: 只输出 ReviseSubmissionV1 full canon snapshot
```

### 14.3 Exact submit markers

固定：

```text
Init:
[DAYLOOM_INIT_SUBMIT_V1]
Finalize this Session now using the Core2 Init submission Final contract.

Planning:
[DAYLOOM_PLANNING_SUBMIT_V1]
Finalize this Session now using the Core2 Planning submission Final contract.

Play:
[DAYLOOM_PLAY_SUBMIT_V1]
Finalize this Session now using the Core2 submission Final contract.

Revise:
[DAYLOOM_REVISE_SUBMIT_V1]
Finalize this Session now using the Core2 Revise submission Final contract.
```

Marker append 到 writable Conversation 后才运行 submit React completion。

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

Parser 固定：

```text
Final 必须是单个 JSON object
exact top-level keys = version, title, canon
version === 1
title 是 string，trim 后非空
canon 是 object，exact keys = premise, rules, style, userRole
canon 四字段均必须是 string；允许空 string
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

`worldId` 只要求 Core2 生成并满足 Archive Protocol stable-id contract；private prefix 不属于 public semantic。

Init 构造：

```text
manifest.json
4 canon markdown blobs（原样 UTF-8 encode submission string）
control = idle / day:null / lastSettledDay:null
```

Init 不创建 plan。因此正常路径固定为：

```text
Init → idle → Planning
```

example 不得偷偷跳过 Planning。

---

## 16. Planning

```text
published idle
  → startSession('planning')
  → targetDay = nextDay(lastSettledDay)
  → pin context
  → ready
  → send*
  → submit
  → days/<targetDay>/plan.json
  → published planned(targetDay)
```

Cancel 保持 World 不变。

### PlanningSubmissionV1

```ts
interface PlanningSubmissionV1 {
  version: 1;
  intent: string;
  beats: Array<{
    intent: string;
  }>;
}
```

Parser 固定：

```text
Final 必须是单个 JSON object
exact top-level keys = version, intent, beats
version === 1
intent 是 string，trim 后非空
beats 是 array，可为空
每个 beat exact keys = intent
beat.intent 是 string，trim 后非空
unknown fields rejected
```

模型不提交 day ID，不提交 beat ID。

Core2 构造：

```ts
PlayPlanV0 = {
  intent: submission.intent,
  beats: submission.beats.map((beat, i) => ({
    id: `beat${i + 1}`,
    intent: beat.intent,
  })),
}
```

Persisted plan 使用 `JSON.stringify(plan, null, 2) + "\n"` 的 UTF-8 bytes。

Planning 是 `PlayPlanV0` 的唯一 Core2 producer。

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

Cancel 保持 World 不变。

### PlaySubmissionV1

保持当前 contract：

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

现有 exact parser、pinned-plan relation、PersistedPlayV1 builder、summary builder全部保持，不因 lifecycle completion 改写。

---

## 18. Revise

```text
published idle
  → startSession('revise')
  → pin current canon
  → ready
  → send*
  → submit
  → replace four current canon docs in new root tree
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

Parser 固定：

```text
Final 必须是单个 JSON object
exact top-level keys = version, canon
version === 1
canon 是 object，exact keys = premise, rules, style, userRole
四字段均必须是 string；允许空 string
unknown fields rejected
```

四个 canon 文档以 submission string 原样 UTF-8 encode 后 PUT。

Revise 不修改：

```text
manifest title
worldId
day history
lastSettledDay
```

Revise 使用 full canon snapshot replacement，不设计 patch DSL。

---

## 19. Settle

Settle 是 deterministic World mutation，不启动 agent。

```text
published awaiting-settle(dayN)
  → settle()
  → revalidate exact current visible World
  → verify current day plan/play/summary relation
  → publish new commit
       phase = idle
       day = null
       lastSettledDay = dayN
  → published idle
```

Settle：

```text
changes = []
candidate rootTreeHash == base rootTreeHash
new commit / revision / control
```

不重写任何 day bytes。

---

## 20. Abandon Day

仅从：

```text
published planned(dayN)
published awaiting-settle(dayN)
```

可执行。

Candidate tree 删除：

```text
days/<day>/plan.json
days/<day>/play.json      if present
days/<day>/summary.md     if present
```

只删除当前 `day` 的 Core2-owned 三条路径；其它路径不动。

Publish：

```text
phase = idle
day = null
lastSettledDay unchanged
```

Parent commit/tree 继续保存被 abandon 的历史内容。

下一次 Planning 由 `nextDay(lastSettledDay)` 重新得到同一个未 settle day。

不创建 abandoned marker document。

---

## 21. Promptpile / React execution theorem

四类 conversational Session 共用同一 concrete mechanics，不复制四套 runtime。

### startSession

```text
validate capability
→ generate Session id
→ create exact workspace topology
→ write per-kind prompt assets + derived configs
→ build/pin immutable context
→ Planning/Play/Revise: append exactly one context message to context/
→ Init: no context append
→ if not disposed, install active Session
→ status ready
```

Workspace/config/prompt construction failure：`INTERNAL_ERROR`，Session 不可见，World 不变，workspace 清理。

Promptpile context append failure：`CONVERSATION_FAILED`，Session 不可见，World 不变，workspace 清理。

### send(text)

```text
require session ready
require text.trim() non-empty
→ status running + state.changed
→ append-user to writable conversation/
→ compression lifecycle
→ Promptpile React send config
→ validate Agent Event v1 stream
→ emit only final.delta as output.delta
→ if success and not disposed: status ready
```

Append failure → `CONVERSATION_FAILED` + Session terminal。

Compression failure → preserve compression mapping + Session terminal。

React failure → `AGENT_FAILED` + Session terminal。

已经发出的 `output.delta` 不回滚。

### submit()

```text
require session ready
→ status submitting + state.changed
→ append exact per-kind submit marker
→ compression lifecycle
→ Promptpile React submit config
→ validate Agent Event v1 stream
→ keep Final private
→ exact parser
→ business validation / document construction
→ publication
→ Session terminal
```

Submit marker append failure → `CONVERSATION_FAILED`。

Compression / React failure保持既有 taxonomy。

Parse / candidate business relation failure → `SUBMISSION_INVALID`。

Pre-publication failure → Published World unchanged。

Publication success → new Published World；Session terminal。

### cancel()

仅 ready 可用：

```text
clear active Session
World unchanged
→ success
```

不保留 failed/cancelled Session 供 retry。

---

## 22. Compression contract

`CORE2_CONVERSATION_COMPRESSION_DRAFT.md` 的 beta.2 contract 完整扩展到：

```text
init
planning
play
revise
```

固定：

```text
trigger basis = current compact live Conversation
fresh summary source = restored original Conversation
```

Timeout：

```text
abort exact provider invocation
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

## 23. Configuration

Public options 继续只有：

```ts
interface CreateDayloomCoreOptions {
  worldRoot: string;
  llmConfigPath: string;
}
```

Caller TOML ownership guard 保持：

```text
不得包含 [promptpile-react]
[promptpile] 不得拥有
  dir / dirs / output_dir / quiet / input / continue / tools_file / after_hook
```

Core2 不解释 provider model/base-url/API-key 语义。

每个 Session kind 使用 Core2-owned concrete prompt assets；不增加 caller-owned per-session config path、provider registry 或 backend interface。

React 仍固定 max-step=1；send/submit 继续使用 Core2 派生私有 config。

---

## 24. Public events / temporal semantics

Public event 固定：

```ts
export type CoreEvent =
  | { type: 'state.changed'; state: CoreState }
  | { type: 'output.delta'; sessionId: string; text: string };
```

规则：

```text
subscribe() 不 replay；initial state 用 getState()
listener 按注册集合快照同步顺序 dispatch
listener exception 隔离，不影响其它 listener / operation
state.changed 的 state 必须是事件发生后的 snapshot
output.delta 只来自普通 send() 的 React Final delta
submit Final 永远 private
Thought / Observe / Check / raw Agent Event 永不公开
```

Observable temporal theorem：

```text
startSession success Promise settle 前 → ready state 已发布
send() 开始 React 前 → running state 已发布
send success Promise settle 前 → ready state 已发布
submit 开始 React 前 → submitting state 已发布
submit/cancel/failure Promise settle 前 → terminal state 已发布
stable mutation Promise settle 前 → new World state 或 unchanged failure state 已发布
```

不冻结同一 public state 的冗余 `state.changed` 次数；实现应避免无意义重复事件。

TUI loading 只从 `session.status = running | submitting` 投影，不增加 presentation event。

---

## 25. Error taxonomy

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

固定映射：

```text
当前 capability 不允许                 → NOT_AVAILABLE
另一个 Core2 mutation 正在执行          → BUSY
用户 text trim 后为空                   → INVALID_INPUT
Promptpile append/compression failure   → CONVERSATION_FAILED
React completion/event-stream failure   → AGENT_FAILED
submit JSON / business relation invalid → SUBMISSION_INVALID
publication lock 已占用 / pinned base改变 → WORLD_CONFLICT
operation 中 visible World 已损坏       → WORLD_INVALID
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

Malformed World 由 `CoreWorldState.invalid` 表达，不作为 constructor exception。

Publication recheck 必须区分：

```text
visible graph 合法但 pinned base != visible base → WORLD_CONFLICT
visible graph 自身无法通过 Protocol/Profile read → WORLD_INVALID
```

不得把损坏 World 伪装成普通 conflict。

---

## 26. Mechanical publication primitive

完整 lifecycle 有六个真实 publication caller：

```text
init
planning
play
revise
settle
abandon-day
```

必须从当前 `publishPlay()` 收敛出一个 **mechanical publication primitive**。

Private change contract 固定：

```ts
type WorldChange =
  | {
      op: 'put';
      path: string;
      mediaType: 'application/json' | 'text/markdown';
      bytes: Uint8Array;
    }
  | {
      op: 'delete';
      path: string;
    };
```

Business caller 不生成：

```text
sha256
bytes count
fileId
StagingManifestV1
operationId
commitId
revision
createdAt
```

这些由 primitive 机械生成。

Private publication input：

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

Invariant：

```text
base === null 只允许 operationType === init，且 initialManifest 必须存在
base !== null 时 initialManifest 必须不存在
changes path 必须是 Core2-owned path 且通过 Protocol path parser
同一 path 不得出现两次
put bytes 必须与 mediaType 对应 Core2 document contract
delete 不携带 bytes/mediaType
```

Primitive 只负责：

```text
WorldChange → canonical StagingManifestV1
生成 fileId/hash/bytes
buildCandidateTreeV1
hash/encode target tree
construct + protocol-parse target operation/commit
validate operation↔staging
validate parent relation when base exists
validate prepared target relation
acquire publication lock
re-read exact visible World
recheck exact base
install immutable blobs/tree/commit
install prepared operation record
initial publication install manifest
replace current.json as final World-visibility switch
best-effort mark operation published after visibility
release lock
return visible PublishedWorld
```

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

不允许扩张成 transaction framework / command framework。

`operations/<id>.json` 是 lifecycle/diagnostic record，不是 content-addressed immutable object；post-publication status update 不改变 Published World truth。

---

## 27. Publication theorem

### 27.1 Initial publication

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
build + protocol/profile-validate complete candidate graph in memory
→ acquire .locks/publish.lock
→ classify/recheck root still uninitialized
→ install immutable blobs/tree/commit
→ install prepared operation record
→ install manifest.json
→ atomic create/replace current.json as final World-visibility switch
→ best-effort mark operation published
```

只有 `current.json` 成功后才存在 Published World。

#### 同进程 pre-current failure

Primitive 必须知道本 attempt 哪些 durable files 是“新建”而不是“已存在相同 bytes”。

若 `current.json` 尚未成功且 operation 在同一进程失败：

```text
remove manifest if this attempt created it
remove only blob/tree/commit/operation files this attempt newly created
never delete a pre-existing identical immutable object
remove temp files
release lock
```

Cleanup 成功后 live Core state 回到 `uninitialized`，Init 可以重试。

若 cleanup 自身失败，则不得声称 uninitialized；Core 必须 reclassify root，通常得到 `invalid`，operation 返回 `INTERNAL_ERROR` 或更早已确定的 specific error。

#### 进程崩溃 / power loss residue

Core2 不自动 recovery。下次启动若无 `current.json` 但有 durable Archive evidence：

```text
→ invalid
```

fail-closed，不允许 Init 覆盖。

#### post-current diagnostic failure

一旦 `current.json` 成功：

```text
Published World 已经是 public truth
```

随后 operation status diagnostic failure：

```text
不回滚 current
不删除已发布 immutable graph
不把成功 publication 改判为失败
```

### 27.2 Update publication

Planning / Play / Revise / Settle / Abandon pin：

```text
revision
commitId
rootTreeHash
```

Lock 内 re-read：

```text
visible invalid                       → WORLD_INVALID
visible valid but exact base changed → WORLD_CONFLICT
```

失败时本 operation 不替换 `current.json`。

Update pre-current failure不要求删除已安装但 unreachable 的 content-addressed immutable objects；它们不影响 current truth。Temp files必须清理，lock必须释放。

Settle 必须支持：

```text
changes = []
candidateTreeHash === baseTreeHash
```

总 theorem：

> **先完整构造并验证 target graph；在 exclusive publication ownership 下 recheck exact visible base；安装 target durable graph 后，以 `current.json` 作为最终 World 可见性切换。其后的 diagnostic 更新不参与 World truth。**

---

## 28. Dispose / child ownership 强闭环

Core2 继续只拥有一个 `activeChild` identity；child start/end 必须 identity-safe：

```ts
childStarted(child) {
  activeChild = child;
}

childEnded(child) {
  if (activeChild === child) activeChild = null;
}
```

同时 Core2 必须保存**单一当前 public operation Promise/handle**，只用于 dispose 等待，不是 queue/manager。

`dispose()` 固定：

```text
第一次调用同步标记 disposed
→ capabilities 立即全 false
→ 后续 public mutation 立即 DISPOSED
→ listeners 立即停止接收新事件
→ kill exact activeChild if any
→ await 当前唯一 in-flight public operation 的 finally / compression drain / child close
→ await 该 operation 所拥有的 Session workspace cleanup
→ rm Core runtimeRoot
→ resolve dispose()
```

多次 `dispose()` 必须幂等并共享同一个 disposal completion，不并行删除 runtimeRoot。

强保证：

> **`dispose()` Promise settle 时，Core2 启动的 child、semantic-summary provider、request-dir cleanup、Session operation 和 runtimeRoot filesystem access 均已结束。此后没有 Core2-owned async work 会再次访问 runtimeRoot。**

Dispose 不重写已经确定的 lower-level error：

```text
child 因 dispose 被 kill 后若 Promptpile/compression 已产生 CONVERSATION_FAILED / AGENT_FAILED
→ 保留该 specific result

底层步骤成功返回，但在 publication 前观察到 disposed
→ DISPOSED，World unchanged

current.json 已完成 visibility switch 后才发生 dispose
→ publication success 是 truth，不回滚；dispose 只负责收尾
```

不得为了 dispose 建 scheduler、cancellation state machine 或 operation manager。

---

## 29. Business failure theorem

四类 conversational Session统一：

```text
send success
  → ready

send append/compression/agent failure
  → Session terminal
  → Published World unchanged

submit parse/business/pre-publication failure
  → Session terminal
  → Published World unchanged

submit publication success
  → Session terminal
  → new Published World

cancel ready
  → Session terminal
  → Published World unchanged
```

失败 Session 不保留供 retry。

Settle / Abandon failure：

```text
pre-current failure → Published World unchanged
post-current success → new Published World is truth
```

---

## 30. Internal implementation boundary

允许共享 concrete helper，因为已有真实重复 caller；禁止为了“未来扩展”抽象。

目标责任边界：

```text
world/read
  World classification
  Protocol graph read
  Dayloom Profile parsers / relation validators

world/publish
  WorldChange
  mechanical publication primitive
  immutable/atomic filesystem mechanics

session/common
  workspace topology
  Promptpile append
  React invocation
  compression invocation
  shared child ownership plumbing

session/init
session/planning
session/play
session/revise
  per-kind context builder
  per-kind prompts/marker
  pinned business state

session/submission
  exact Init/Planning/Play/Revise parsers
  business document builders

core
  public state
  capability legality
  single operation guard
  Session lifecycle
  settle / abandon orchestration
  event publication
  dispose
```

Exact filename可以因现有代码最小改动而合并，但责任不得重新混成 generic framework，也不得增加新的 backend/plugin/registry interface。

---

## 31. TUI safety / acceptance gate

Core2 完整实施期间：

```text
packages/tui/**
→ 保持 agent/restore-complete-tui 已恢复的完整 @dayloom/core backend
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

禁止：

```text
Core2 TUI adapter
fake old runtime
OldCoreBackend/Core2Backend 双 backend framework
```

---

## 32. 与既有文档关系

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

完整有效；其中 semantic-summary prompt 的“Play Session”措辞被本文收敛为 session-neutral Dayloom conversational Session，除此之外 beta.2 lifecycle contract 不变。

### `TUI_CORE2_ADAPTATION_DRAFT.md`

不再作为 completion 规范。

恢复与未来迁移由 `TUI_RESTORATION_PLAN.md` 及未来独立 migration review 控制。

### `@dayloom/core`

只允许作为历史行为参考；不得成为设计依赖。

---

## 33. 实施顺序

实施顺序固定，避免先抽象后找 caller。

### Step 0 — Protect restored TUI

加入 branch/review guard：本阶段 Core2 completion commit 不修改 `packages/tui/**`。

### Step 1 — Read/Profile closure

先实现：

```text
uninitialized / invalid / published
Day ID V0 generator
PersistedPlayV1 parser
summary validator
stable phase invariants
lastSettledDay relation
```

现有 planned Play fixture继续可读。

### Step 2 — Publication primitive

从当前 `publishPlay()` 提取 WorldChange + mechanical primitive。

先把现有 Play publication 重接该 primitive，并保持所有既有 Play tests 全绿，再新增其它 mutation caller。

### Step 3 — Common Session runtime hardening

只提取当前 Play 已验证的：

```text
workspace
append
React
compression
child ownership
single in-flight operation handle for dispose
```

先保证 Play behavior不变。

### Step 4 — Init

实现 exact context-empty contract、prompts/marker、InitSubmissionV1、initial publication、sync pre-current cleanup。

### Step 5 — Planning

实现 exact PlanningContextV0、prompts/marker、nextDay、PlanningSubmissionV1、beat ID construction、PlayPlanV0 publication。

### Step 6 — Revise

实现 exact ReviseContextV0、prompts/marker、ReviseSubmissionV1、full canon replacement。

### Step 7 — Settle

实现 empty-staging deterministic publication。

### Step 8 — Abandon Day

实现 current-day Core2-owned document DELETE publication。

### Step 9 — Dispose closure

完成并验证 dispose wait theorem；不得通过 sleep/poll 测试。

### Step 10 — Full headless lifecycle

从真正空 root 连续执行：

```text
Init
→ Planning(day1)
→ Play(day1)
→ Settle(day1)
→ Revise
→ Planning(day2)
```

另测 planned / awaiting-settle 两种 Abandon 后 replan。

### Step 11 — CI / package guard

完整 Core2 suite：

```text
Ubuntu Node 20
Ubuntu Node 22
Windows Node 20
Windows Node 22
```

全部 green。

只有全部完成后才进入 TUI migration review。

---

## 34. Acceptance tests

以下名称是 normative acceptance checklist；可按现有测试文件组织，但语义不得省略。

### Architecture / source

```text
core2-has-no-legacy-core-imports
core2-has-no-tui-imports
core2-has-no-deep-protocol-or-promptpile-imports
core2-retains-play-plan-v0-shape
core2-package-no-longer-claims-play-only
```

### World/Profile

```text
core2-empty-root-is-uninitialized
core2-empty-directories-are-uninitialized
core2-housekeeping-only-root-is-uninitialized
core2-empty-root-exposes-init-only
core2-partial-archive-is-invalid-not-uninitialized
core2-crashed-initial-publication-residue-is-invalid
core2-valid-current-ignores-unreachable-immutable-objects
core2-invalid-world-exposes-no-mutations
core2-published-world-validates-four-canon-blobs
core2-day-generator-produces-day1-day2
core2-planned-validates-current-plan-relation
core2-awaiting-settle-validates-persisted-play-relation
core2-awaiting-settle-validates-nonempty-summary
core2-idle-validates-last-settled-day-relation
```

### Context / prompt contracts

```text
core2-init-context-layer-is-empty
core2-planning-context-v0-is-canonical
core2-planning-context-omits-summary-section-without-last-settled-day
core2-planning-context-includes-verified-last-settled-summary
core2-play-context-v0-remains-unchanged
core2-revise-context-v0-is-canonical
core2-revise-context-summary-conditional-is-canonical
core2-summary-prompt-is-session-neutral
core2-submit-markers-are-exact-per-kind
core2-all-prompts-contain-summary-authority-boundary
```

### Init

```text
core2-init-starts-only-from-uninitialized
core2-init-cancel-keeps-uninitialized
core2-init-parser-rejects-unknown-fields
core2-init-allows-empty-canon-strings
core2-init-requires-nonempty-title
core2-init-submit-publishes-revision-1-idle
core2-init-generates-world-id-in-core
core2-init-does-not-create-plan
core2-init-current-json-is-final-world-visibility-switch
core2-init-sync-precurrent-failure-cleans-only-created-files
core2-init-sync-precurrent-failure-returns-uninitialized-after-successful-cleanup
core2-init-cleanup-failure-reclassifies-root
core2-concurrent-init-detects-world-conflict
core2-init-postcurrent-diagnostic-failure-keeps-published-world
```

### Planning

```text
core2-planning-starts-only-from-idle
core2-planning-parser-is-exact
core2-planning-model-does-not-own-day-or-beat-identity
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
core2-persisted-play-parser-matches-current-builder
```

### Revise

```text
core2-revise-starts-only-from-idle
core2-revise-parser-is-exact
core2-revise-allows-empty-canon-strings
core2-revise-atomically-replaces-four-canon-docs
core2-revise-preserves-world-id-title-and-day-history
core2-revise-parent-commit-preserves-old-canon
core2-revise-cancel-keeps-world-unchanged
```

### Settle

```text
core2-settle-only-available-awaiting-settle
core2-settle-revalidates-current-play-relation
core2-settle-publishes-idle-day-null-last-settled-day
core2-settle-keeps-day-documents-byte-identical
core2-settle-empty-staging-is-valid
core2-settle-conflict-does-not-publish
core2-settle-invalid-visible-world-is-world-invalid
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

### Session temporal / errors

```text
core2-all-session-kinds-use-one-conversation-per-session
core2-start-session-installs-session-only-after-context-success
core2-all-session-kinds-stream-send-final
core2-all-session-kinds-keep-submit-final-private
core2-all-session-kinds-use-compression-lifecycle
core2-all-session-kinds-terminalize-on-conversation-failure
core2-all-session-kinds-terminalize-on-agent-failure
core2-all-session-kinds-terminalize-on-invalid-submission
core2-all-session-kinds-drain-summary-provider-before-operation-settles
core2-send-running-state-precedes-output-delta
core2-operation-final-state-is-visible-before-promise-settles
core2-visible-world-damage-maps-world-invalid-not-conflict
core2-stale-child-end-cannot-clear-new-child
```

### Publication primitive

```text
core2-publication-generates-staging-identity-internally
core2-business-callers-cannot-supply-hash-fileid-revision-commitid
core2-publication-rejects-duplicate-change-paths
core2-publication-current-is-final-world-visibility-switch
core2-postcurrent-diagnostic-failure-does-not-change-success
core2-update-precurrent-failure-keeps-current-unchanged
```

### Dispose closure

```text
core2-dispose-is-idempotent
core2-dispose-capabilities-false-immediately
core2-dispose-kills-exact-active-child
core2-dispose-waits-for-inflight-operation-finally
core2-dispose-waits-for-summary-provider-drain
core2-dispose-does-not-remove-runtime-root-before-operation-cleanup
core2-dispose-settlement-leaves-no-runtime-root-access-in-flight
core2-dispose-does-not-rollback-postcurrent-publication
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
running       → loading projectable from status
submitting    → loading projectable from status
send          → output.delta available
```

---

## 35. Definition of Done

Core2 只有全部满足才算完整：

1. `@dayloom/archive-protocol` + Core2 World Profile V0 是 persisted-data 唯一规范来源。
2. Production Core2 不 import legacy Core 或 TUI。
3. 现有 PlayPlanV0 / PlaySubmissionV1 / Play Context V0 不因补 lifecycle 被重写。
4. 空 `worldRoot` 与只有空 Archive directories 的 root → `uninitialized`。
5. partial/malformed durable archive → `invalid`，绝不被 Init 覆盖。
6. Published read 对 canon、current day、lastSettledDay 执行 exact Profile relation validation。
7. PersistedPlayV1 read parser 与当前 Play builder完全一致。
8. `uninitialized` 只提供 Init；`idle` 提供 Planning + Revise；`planned` 提供 Play + Abandon；`awaiting-settle` 提供 Settle + Abandon。
9. Init/Planning/Play/Revise 各自有 canonical immutable Context V0；Init context为空，Play context不改版。
10. 四类 Session 各有 concrete Core2-owned prompt + exact submit marker；semantic-summary prompt session-neutral。
11. Init/Planning/Revise submission parser 全部 exact-key、unknown-field rejecting，模型不拥有结构 identity。
12. Init submit 首次原子发布 Archive V2 → `idle`，不生成 plan。
13. 同进程 Init pre-current failure只清理本 attempt 新建内容；cleanup 失败必须 reclassify，不虚报 uninitialized。
14. Crash residue fail-closed 为 invalid，不增加 recovery coordinator。
15. Planning target Day ID 由 Core2 生成，V0 为 `day1/day2/...`；beat ID由 Core2生成。
16. Planning 持久化现有 PlayPlanV0 → `planned`。
17. Play 保持现有 Promptpile React、streaming、compression、strict relation validation、atomic publication correctness。
18. Play submit → `awaiting-settle`，且 persisted play/summary可由 read-side重新严格验证。
19. Settle deterministic 发布新 commit → `idle`，推进 `lastSettledDay`，不重写 day bytes。
20. Revise 使用 full canon snapshot replacement，不引入 patch framework。
21. Abandon 只从 visible tree 删除 Core2-owned current-day docs，parent history保留；replan复用同一未 settle day。
22. 四类 conversational Session 从创建到 terminal 使用一个持续 writable Conversation identity。
23. 四类 Session 共用已验证 Promptpile / React / compression mechanics，不复制四套 runtime。
24. compression beta.2 live-trigger、restore-source、timeout/drain、error preservation theorem全部保持。
25. 六类 publication 使用一个 mechanical primitive；business caller只提供 WorldChange + target control，不提供 Protocol identity/hash/revision。
26. Publication lock内严格区分 WORLD_CONFLICT 与 WORLD_INVALID。
27. `current.json` 始终是最终 World visibility switch；之后只允许不影响 World truth 的 diagnostic 更新。
28. Public operation Promise settle前最终 public state已发布。
29. `dispose()` settle时不存在 Core2-owned child、provider cleanup、Session operation或 runtimeRoot filesystem access仍在 flight。
30. Public API/event不含 presentation state。
31. 不引入 command bus、StateMachine、RuntimeOperations、plugin/provider framework、queue、scheduler、并发系统或 recovery coordinator。
32. Core2 implementation 阶段不修改 restored TUI 来迁就未完成能力。
33. 从空 World 到 `day2 planned` 的完整 headless lifecycle通过；planned/awaiting 两种 Abandon/replan通过。
34. 每个合法 stable state都有合法下一步；invalid 是明确 fail-closed diagnostic terminal，不存在意外业务死路。
35. Core2 package metadata不再宣称 Play-only runtime。
36. Core2 tests在 Linux/Windows × Node 20/22全绿。
37. 只有以上全部满足，才允许重新迁移 TUI。
38. 后续 TUI migration以 interaction capability closure为验收标准，不要求旧 Core API/data/event compatibility。

---

## 36. 最终架构 theorem

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
│  business legality + exact submission validation              │
│  one mechanical Archive publication primitive                │
│  one single-operation lifecycle + deterministic dispose       │
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

实现纪律：

```text
没有真实第二 caller → 不抽象
已有真实共同 mechanics → 只抽 mechanical helper
模型产生业务内容 → Core2产生稳定结构 identity
World truth只由 validated publication产生
失败先保证 World truth不被误改，再保证本 operation完全收尾
```

最终一句话：

> **Core2 不重写旧 Core，也不为 TUI 定制接口；它围绕新的 Archive V2 / Dayloom World Profile V0，完整拥有 Dayloom 产品生命周期，以一个持续 Conversation、一个机械 publication theorem 和一个单执行流生命周期形成优雅、可验证、无死路的 application closure。**
