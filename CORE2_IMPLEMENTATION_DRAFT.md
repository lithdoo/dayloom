# Dayloom Core2 实现草案

> 状态：Implementation Draft / 实施入口  
> 日期：2026-08-13  
> 目标包：`@dayloom/core2`

## 1. 目标

停止继续在现有 `@dayloom/core` 上叠加新 Archive、Promptpile React、Conversation compression 的兼容改造。

建立一个独立、最小、只有一套语义的新 Core：

```text
@dayloom/core2
= Archive V2 only
= persistent Conversation
= promptpile-react execution
= Dayloom Session / World lifecycle
```

旧 `core` / `core-old` 只作为旧行为参考，不是 `core2` 的兼容目标。

`core2` 只需要支撑 Dayloom 已有的产品交互语义：

```text
Hub
→ 根据 World 状态选择可开始的 Session
→ 进入 Session
→ 用户与 AI 多轮交互
→ Final 流式显示
→ submit 或 cancel
→ Session 结束
→ 回到 Hub，读取新的 World 状态
```

**TUI 是 Core2 的 consumer，不是 Core2 的设计中心。**

---

## 2. 四个 ownership

Core2 只围绕四个明确 ownership 设计：

```text
@dayloom/archive-protocol
= persisted data correctness

Promptpile ecosystem
= Conversation artifact I/O
= agent orchestration

Core2
= business legality
= Session lifecycle
= World publication

Presentation
= TUI / future UI projection
```

这四条是实现判断的最终边界。

### Archive Protocol owns persisted-data correctness

`@dayloom/archive-protocol` 是唯一的 Archive / World 持久化协议来源。

它负责：

- strict parsing；
- portable document paths；
- canonical tree encoding；
- object identity；
- staged PUT / DELETE algebra；
- relation validation；
- recovery classification；
- archive-relative layout vocabulary。

Core2 不重新定义另一套持久化 World DTO 再转成 protocol DTO。

可以存在方便业务读取的 derived read model，但持久化边界始终以 protocol object 为准。

### Promptpile owns Conversation artifacts and agent orchestration

Core2 只拥有 Conversation 的：

```text
identity
location
lifecycle association with Session
```

Core2 **不实现 Promptpile Conversation 文件格式，不直接重写 Conversation artifacts**。

Conversation 的 append、completion artifact、OCC / receipt 等语义由 Promptpile / Promptpile React 自己负责。

Promptpile React 负责 Thought / Observe / Check / Final orchestration；Core2 不重新实现 React FSM。

### Core2 owns business legality and publication

模型可以产生建议或 submission payload，但不能直接决定什么 World mutation 是合法的，也不能绕过 Archive Protocol 发布 World。

Core2 决定：

```text
当前可以开始哪个 Session
当前 Session 能否接受输入
当前 Session 能否 submit / cancel
submission 是否是合法业务结果
如何构造 protocol staging / candidate
何时发布 World
```

### Presentation owns interaction projection

Core2 不输出 TUI widget state，也不复制旧 `RuntimeSnapshot` / `RuntimeEvent` / `MessageStore`。

TUI adapter 把 Core2 state / events 投影为现有 TUI 所需状态。

---

## 3. 明确非目标

Core2 MVP 不做以下事情：

```text
兼容 @dayloom/core public API
兼容旧 RuntimeSnapshot / RuntimeEvent / RuntimeCommand
兼容旧 MessageStore / ConversationClient
兼容旧 Archive layout
同时支持 Archive V1 / V2
legacy archive 自动迁移
并发 Session
并发 agent turn
并发 World mutation
内部任务队列 / scheduler
自动重试 agent turn
崩溃中的 agent turn resume
promptpile-compress
MCP tools
semantic search
多 provider UI
通用 AgentRuntime 插件系统
提前设计 ConversationMaintenance 抽象
```

如果以后确实需要其中某项，再基于已工作的 Core2 增加。

---

## 4. 依赖边界

MVP 依赖图：

```text
@dayloom/core2
├── @dayloom/archive-protocol
├── promptpile-react
└── Node.js >= 20
```

禁止：

```text
@dayloom/core2 → @dayloom/core
@dayloom/core2 → @dayloom/core-old
@dayloom/core2 → @dayloom/tui
@dayloom/core2 → @dayloom/tui-old

@dayloom/archive-protocol/src/*
@dayloom/archive-protocol/dist/*
promptpile-react/src/*
promptpile-react/dist/*
```

Core2 只使用协议包 public exports，以及 Promptpile React packaged executable / public Agent Event Protocol。

加入一个简单 architecture guard 检查这些边界即可。

---

## 5. Core2 运行模型

Core2 是一个**单用户、单 Session、单执行流 runtime**。

MVP 明确不支持并发。

任意时刻：

```text
最多一个 active Session
最多一个正在执行的 agent turn
最多一个正在执行的 World mutation / publication
```

如果 busy 时收到另一个 `send` / `submit` / `startSession`，直接拒绝。

`cancel` 可以终止当前 agent process，然后结束 Session。

不实现：

```text
并发队列
operation scheduler
多个 Session interleave
多个 agent turn merge
自动 conflict resolution
```

Archive publication 仍必须满足协议要求的 exclusive publication ownership。Core2 的策略是**独占执行，不支持竞争**；如果检测到 pinned base 已变化或无法取得独占 publication ownership，直接 fail closed，而不是尝试并发合并。

---

## 6. 最小状态机

Core2 不需要复杂 runtime FSM。

概念状态只有：

```text
Hub
│
├── startSession
▼
Session.ready
│
├── send
▼
Session.running
│
├── agent success
▼
Session.ready
│
├── send ...
│
├── submit ─────→ completed → Hub
│
└── cancel ─────→ cancelled → Hub
```

任何 agent turn 失败：

```text
Session.running
→ failed
→ Session terminal
→ 回到 Hub
```

MVP **不自动 retry agent turn**。

这是有意的：Promptpile React 的 user append 可能已经持久化，即使后续模型阶段失败也不会回滚。为了避免重复 append 和复杂恢复，首版把 agent failure 视为当前 Session 的 terminal failure，保留 Conversation / Session workspace 供诊断，未来再单独设计 recovery。

Terminal Session 不再接受任何 mutation。

---

## 7. Session 是主要 application unit

Core2 的主要对象是 Dayloom business Session，而不是 `ConversationClient`。

一个 Session 完整拥有：

```text
Session id
Session kind
pinned World base
workspace
persistent Conversation location
business lifecycle state
```

流程：

```text
load current World
→ validate Session kind is startable
→ create Session workspace
→ create/recover persistent Conversation location
→ zero or more user/agent turns
→ submit | cancel | failure
→ terminal
```

首版只实现一个 Session kind，推荐 `play`。

其它 `init / planning / revise` 在 vertical slice 完成后再增加。

---

## 8. Persistent Conversation

Persistent Conversation 从第一版存在，即使 compression 暂不实现。

禁止旧模式：

```text
messages[] in memory
→ 每轮 mkdtemp
→ 重写完整 history
→ completion
→ 删除目录
```

目标：

```text
Dayloom Session
        │
        └── persistent Promptpile Conversation directory
```

同一个 Session 的所有 user / agent turns 使用同一个 Conversation identity。

Conversation 是 AI interaction authority；TUI transcript 只是 presentation projection。

Core2 只保存足以重新找到 Conversation 的 Session metadata，不复制 Conversation 内容作为第二份 authority。

### User input ownership

`send(text)` 的逻辑是：

```text
Core2 validate Session.ready
→ Promptpile React 在该 persistent Conversation 上 append user input
→ React 执行 agent turn
→ Core2 消费 public Agent Event Protocol
→ Final delta 投影为 CoreEvent
→ success 后回到 Session.ready
```

如果 React 在 append 后失败，Conversation 保留已写 artifact；Core2 不尝试回滚，也不自动重试，该 Session 进入 terminal failed。

这样只有一个 Conversation writer 语义，不需要 Core2 自己实现去重或重放协议。

---

## 9. Promptpile React boundary

Core2 MVP 只有一个 agent implementation：`PromptpileReactRunner`。

不提前建立通用 provider / `AgentRuntime` 插件层。

`PromptpileReactRunner` 是 Core2 私有 infrastructure，职责只有：

```text
prepare CLI args / config
→ spawn promptpile-react
→ consume stream-json
→ validate public Agent Event Protocol
→ translate into internal turn result / public CoreEvent
→ handle abort / stderr / process exit
```

它禁止：

```text
import promptpile-react internals
重新实现 Thought / Observe / Check
解释 Promptpile private receipt / transport
直接把 Promptpile event shape 暴露给 presentation
```

Public consumer 只看 Core2 自己的一套 state / events。

---

## 10. Public Core state / events

Core2 public surface 围绕 application capability，不围绕旧 Core compatibility。

示意：

```ts
const core = await createDayloomCore({ worldRoot })

core.getState()
core.subscribe(listener)

await core.startSession('play')
await core.send('进入酒馆')
await core.submit()
await core.cancel()
await core.dispose()
```

具体函数名不在本草案冻结。

### Core state 必须表达业务 legality

Presentation 不应该自己根据 World phase 推导业务规则。

Core state 至少需要表达等价语义：

```text
当前在 Hub 还是 Session
当前 World read model
哪些 Session kind 当前允许开始
当前 Session kind / status
当前是否 busy
当前是否允许 submit
当前是否允许 cancel
```

Core2 决定“什么操作合法”；TUI 只决定“如何显示这些操作”。

### 只有一套 public event vocabulary

不要同时暴露 `AgentTurnEvent` 和 `RuntimeEvent` 两套 public stream。

Promptpile Agent Events 只在 runner 边界内部存在：

```text
Promptpile Agent Event
        ↓ private translation
Core2 state transition + CoreEvent
        ↓
TUI / future presentation
```

CoreEvent 只需要覆盖 consumer 真正需要观察的事实，例如：

```text
state changed
session started / ended
output delta
operation failed
```

不描述具体 TUI component。

---

## 11. Submit 必须形成结构化闭环

`submit` 是 Dayloom application command，不是 Promptpile React 自己的生命周期状态。

普通对话 turn 的 Final 是用户可见自然语言。

Submit 使用一个**专用 submission run**：

```text
user requests submit
→ Core2 validate submit is allowed
→ run Session-specific submission prompt on same Conversation
→ React Final returns SessionSubmission text
→ strict parser validates SessionSubmission
→ Core2 converts validated submission into protocol staging operations
→ Archive Protocol builds / validates candidate
→ Core2 publication transaction
→ Session completed
→ reload current World
→ Hub
```

关键规则：

```text
model Final
≠ persisted World
```

Final 只是 untrusted submission input。

每个 Session kind 只需要定义三件事：

```text
conversation / submission prompt policy
strict submission parser
validated submission → protocol staging operations
```

不建立一套新的通用 World DTO，也不建立复杂 command bus。

首个 `play` vertical slice 只实现 `play` 所需的 submission schema。

### Submit failure

任何一步失败都不能发布部分 World：

```text
React submission run fails
parser fails
business validation fails
protocol validation fails
publication fails
```

结果统一为：

```text
no new current World
→ Session failed terminal
→ error exposed to consumer
```

Archive publication 必须以 `current.json` 的最终 atomic visibility 为最后一步。

---

## 12. Cancel

Cancel 保持简单：

```text
abort active promptpile-react process if any
→ do not publish World mutation
→ mark Session cancelled
→ leave active Session
→ Hub
```

Conversation / workspace 可以保留用于诊断；MVP 不要求自动清理策略。

Cancel 不恢复旧 transaction shape，也不尝试撤销已经由 Promptpile 发布的 Conversation artifacts。

---

## 13. TUI compatibility

“兼容当前 TUI”只表示用户交互逻辑等价：

```text
Hub
→ 看到当前允许的流程
→ 开始 Session
→ 多轮输入
→ Final streaming
→ submit / cancel
→ 回到 Hub
```

不要求兼容：

```text
旧 event name / payload
旧 snapshot shape
旧 command string
旧 message id
旧 error code
旧 core factory
```

迁移方向：

```text
existing TUI components
        ↑
TuiRuntimeDriver / TuiDriverState
        ↑
core2 TUI adapter
        ↑
@dayloom/core2
```

Adapter 属于 TUI package。

如果 TUI 需要某个 presentation-only 字段，应在 adapter 中生成，而不是加入 Core2 domain API。

---

## 14. Compression 暂不实现

Core2 MVP 不依赖 `promptpile-compress`。

因为 Conversation 从第一天就是 persistent 的，未来加入 compression 时只需要在 agent execution 前增加 Promptpile ecosystem 提供的 compression lifecycle：

```text
persistent Conversation
→ compress when needed
→ promptpile-react
```

在真正接入之前：

- 不定义 `ConversationMaintenance` interface；
- 不定义 compression policy hierarchy；
- 不提前设计 summary / archive retrieval API。

Compress 应是后续 extension，不是第二次 Core 重构。

---

## 15. 建议最小目录

不要从旧 Core 复制完整结构。

第一版可以保持：

```text
packages/core2/
├── package.json
├── src/
│   ├── index.ts
│   ├── core.ts
│   ├── state.ts
│   ├── events.ts
│   ├── world/
│   │   ├── repository.ts
│   │   └── publication.ts
│   ├── session/
│   │   ├── session.ts
│   │   ├── workspace.ts
│   │   └── play.ts
│   └── promptpile/
│       └── react-runner.ts
└── test/
```

如果实现过程中某个文件自然变大，再拆分。

不要因为“未来可能有多个实现”预先创建 interface hierarchy。

---

## 16. 真正的 vertical slice 实施顺序

### Step 0 — package skeleton

建立 `packages/core2`：

```text
@dayloom/archive-protocol direct dependency
promptpile-react direct dependency
Node >= 20
architecture guard
```

### Step 1 — World read + legality

完成：

```text
worldRoot
→ protocol-backed read
→ CoreState
→ startable Session kinds
```

只支持 Archive V2，不 fallback legacy archive。

### Step 2 — Session workspace + persistent Conversation

完成：

```text
start play Session
→ durable Session id / metadata
→ persistent Conversation location
→ Session.ready
```

### Step 3 — React conversation turn

完成：

```text
send user input
→ same persistent Conversation
→ promptpile-react
→ Final streaming
→ Session.ready
```

至少证明连续两个 user turns 使用同一个 Conversation。

### Step 4 — Submit + publication

完成：

```text
submit
→ dedicated submission run
→ strict PlaySubmission parser
→ protocol staging / candidate validation
→ exclusive publication
→ current World update
→ Session completed
```

同时实现 cancel：

```text
cancel
→ no World publication
→ Session cancelled
```

到这里 Core2 application lifecycle 才算闭环。

### Step 5 — TUI adapter

重写 TUI runtime driver 到 Core2 的连接。

验证：

```text
Hub → Play Session → turns → submit → Hub
Hub → Play Session → cancel → Hub
```

### Step 6 — 其它 Session kinds

再按产品需求增加：

```text
planning
init
revise
```

### Later — Compress / MCP / migration

只在有真实需求时加入。

---

## 17. MVP 测试

只测试架构闭环需要的事实。

### Archive boundary

```text
只使用 @dayloom/archive-protocol public API
malformed archive fail closed
staging / candidate 必须 protocol-valid
publication conflict fail closed
```

### Promptpile React boundary

```text
valid stream-json
malformed protocol event → fail
non-zero exit → fail
abort → cancelled
Final delta streaming
```

### Session lifecycle

```text
start play
send first turn
send second turn on same Conversation
busy 时第二个 mutation 被拒绝
agent failure → Session failed terminal
submit success → World changes exactly once
submit failure → World unchanged
cancel → World unchanged
terminal Session cannot advance
```

这里的“busy 时拒绝”不是并发支持，只是保证 Core2 不接受并发调用。

### TUI behavior

只测试用户可观察流程：

```text
Hub → Session → stream → submit → Hub
Hub → Session → cancel → Hub
```

不测试旧 Core payload compatibility。

---

## 18. MVP 完成标准

Core2 MVP 只有在以下链路完整成立时才完成：

```text
Archive V2 World
        ↓
Core2 decides Play is legal
        ↓
start Play Session
        ↓
persistent Conversation
        ↓
user turn
        ↓
promptpile-react
        ↓
Final streaming
        ↓
second turn on same Conversation
        ↓
submit
        ↓
strict PlaySubmission
        ↓
protocol staging / candidate
        ↓
exclusive atomic publication
        ↓
new World
        ↓
Hub
```

并同时满足：

1. `core2` 不依赖 legacy Core / TUI；
2. 只支持 Archive V2；
3. 不自己实现 Promptpile Conversation artifact semantics；
4. 不重新实现 React FSM；
5. 不支持并发，只允许单 Session / 单执行流；
6. 模型输出不能绕过 strict submission validation；
7. submit 成功只产生一次合法 World publication；
8. submit 失败 / cancel / agent failure 不产生部分 World；
9. TUI 通过 adapter 保持等价交互；
10. MVP 不包含 Compress、MCP、legacy migration 或其它预留型功能。

---

## 19. 最终架构原则

```text
Protocol owns persisted-data correctness.
Promptpile owns Conversation artifacts and agent orchestration.
Core2 owns business legality, Session lifecycle and World publication.
Presentation owns interaction projection.
```

以及一条实施原则：

```text
只实现当前闭环所需要的 abstraction。
没有第二个实现时，不提前设计插件层；
没有并发需求时，不设计并发系统；
没有 compression 需求时，不设计 compression framework；
没有 legacy runtime 需求时，不保留 legacy compatibility。
```

任何新增设计如果不能直接服务下面这条链路，应默认推迟：

```text
World → Session → Conversation → React → Submission → Publication → World
```
