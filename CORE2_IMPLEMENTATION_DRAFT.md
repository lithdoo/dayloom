# Dayloom Core2 实现草案

> 状态：Draft / 新实现入口  
> 日期：2026-08-13  
> 目标包：`@dayloom/core2`  
> 目标：停止继续在现有 `@dayloom/core` 上叠加 Archive V2、Promptpile React、Conversation compression 的兼容改造，建立一个直接面向新协议与新 Agent runtime 的独立 Core 实现。

## 1. 决策摘要

Dayloom 后续的新 runtime 不再以“逐步改造现有 core 并维持内部兼容”为主要路线。

新路线是：

```text
@dayloom/core / @dayloom/core-old
= legacy implementation
= regression / behavior reference
= 不再作为新架构的内部兼容目标

@dayloom/core2
= new implementation
= Archive V2 only
= Promptpile React first
= persistent Conversation from day one
= compression optional / later extension
```

`core2` 的兼容目标不是旧 `core` API，也不是当前 TUI 的 DTO / event / snapshot 形状。

`core2` 只要求能够支撑当前 Dayloom 已形成的产品交互语义：

```text
Hub
→ 根据 World 状态选择业务流程
→ 进入 Session
→ 用户与 AI 多轮交互
→ assistant 可流式显示
→ submit 或 cancel
→ Session 结束
→ 回到 Hub / 得到新的 World 状态
```

TUI 是 `core2` 的一个 consumer，不是 `core2` 的设计中心。

---

## 2. 为什么建立 Core2

当前重构同时包含三个大变化：

1. Archive / World 持久化协议切换到新的 `@dayloom/archive-protocol`；
2. AI execution 从 direct Promptpile completion 升级为 `promptpile-react` agent turn；
3. 长期 Conversation 需要具备 compression / archive 生命周期。

如果继续在现有 `core` 中逐层兼容，会同时存在：

```text
legacy archive semantics
+ Archive V2 semantics
+ legacy Session/messages semantics
+ persistent Conversation semantics
+ completion streaming semantics
+ agent event semantics
```

兼容成本会逐步超过真正产品能力的实现成本。

`core2` 的目的不是重写一遍旧 Core，而是移除这些历史约束，使新实现只需要回答：

```text
Dayloom 的 World 如何读取与提交？
Session 如何运行？
一个 agent turn 如何推进 Session？
如何把 runtime 状态投影给任意 presentation consumer？
```

---

## 3. Core2 的目标

### 3.1 必须实现

`core2` 第一阶段必须具备：

- 直接依赖新的 `@dayloom/archive-protocol`；
- 只支持新的 Archive V2 / document-oriented World；
- 独立的 Session lifecycle；
- 持久 Promptpile Conversation identity；
- `promptpile-react` agent execution；
- Final output streaming；
- submit / cancel 业务生命周期；
- World mutation / publication；
- 与 presentation 无关的 runtime events / state；
- 能被当前 TUI 通过 adapter 使用。

### 3.2 可以延后

以下能力不应阻塞 `core2` 首个可用版本：

- `promptpile-compress`；
- archive history retrieval；
- MCP tools；
- semantic search；
- 多 provider UI；
- legacy archive import；
- 与旧 Core API 的兼容层。

其中 compression 可以延后，但 **persistent Conversation 不可以延后**。

---

## 4. 明确的非目标

`core2` 不负责：

```text
复刻 @dayloom/core 的 public API
复刻 RuntimeSnapshot shape
复刻 RuntimeEvent union
复刻 RuntimeCommand union
复刻 MessageStore
复刻 ConversationClient.streamReply()
复刻当前 TUI driver 的内部调用方式
兼容旧 Archive layout
在 core2 内维护 legacy / v2 双实现
```

也禁止将 `core2` 设计成所谓 `tui-core`：

```text
错误：
TUI 需要什么字段
→ Core2 就暴露什么字段

正确：
Core2 暴露稳定的 application/runtime semantics
→ TUI adapter 投影为 TUI 所需状态
```

---

## 5. 依赖边界

目标依赖图：

```text
@dayloom/core2
├── @dayloom/archive-protocol
├── promptpile-react
└── Node.js runtime

later:
@dayloom/core2
├── @dayloom/archive-protocol
├── promptpile-react
├── promptpile-compress
└── Node.js runtime
```

禁止依赖：

```text
@dayloom/core2 → @dayloom/core
@dayloom/core2 → @dayloom/core-old
@dayloom/core2 → @dayloom/tui
@dayloom/core2 → @dayloom/tui-old
```

建议在 `core2` 中加入 architecture guard，直接检查上述禁止依赖。

因为 `promptpile-react` 当前要求 Node.js 20+，`core2` 的 runtime baseline 应直接设为：

```text
Node.js >= 20
```

不要为 Node 18 额外建立兼容分支。

---

## 6. Archive Protocol 的 ownership

`@dayloom/archive-protocol` 是 `core2` 唯一的 World / Archive 数据协议来源。

协议包负责：

- strict parsing；
- portable document path；
- canonical tree encoding；
- object identity；
- staged PUT / DELETE algebra；
- relation validation；
- recovery classification；
- archive-relative layout vocabulary。

`core2` 负责协议包刻意不负责的 application/runtime 行为：

- filesystem I/O；
- publication ownership；
- atomic visibility；
- Session lifecycle；
- business policy；
- agent execution；
- user-visible operation lifecycle。

重要原则：

```text
Core2 不重新定义另一套 World DTO 再转换成 protocol DTO。
```

允许存在 application read model，但 protocol object 在持久化边界必须保持 authoritative。

---

## 7. Core2 的建议内部结构

第一版保持最小结构：

```text
packages/core2/
├── package.json
├── src/
│   ├── index.ts
│   ├── world/
│   │   ├── repository.ts
│   │   ├── read-model.ts
│   │   └── publication.ts
│   ├── session/
│   │   ├── session.ts
│   │   ├── manager.ts
│   │   ├── workspace.ts
│   │   └── types.ts
│   ├── agent/
│   │   ├── runtime.ts
│   │   ├── events.ts
│   │   └── promptpile-react-runner.ts
│   ├── runtime/
│   │   ├── runtime.ts
│   │   ├── events.ts
│   │   └── state.ts
│   └── infrastructure/
│       ├── filesystem.ts
│       ├── process.ts
│       └── ids.ts
└── test/
```

这个目录不是冻结设计。

原则是：不要从现有 `core` 复制完整目录结构，也不要预先重建所有旧 abstraction。

---

## 8. Session 是 Core2 的主要 application unit

Core2 的核心对象是业务 Session，而不是 ConversationClient。

概念上：

```text
World
  ↓
start business Session
  ↓
Session owns workspace + Conversation identity
  ↓
zero or more user / agent turns
  ↓
submit | cancel
  ↓
World publication or no-op
  ↓
Session terminal state
```

Session kind 首期仍可保持现有产品概念：

```text
init
planning
play
revise
```

但这些名称不要求继承旧 Core 的具体类型定义。

---

## 9. Persistent Conversation 从第一天存在

`core2` 不再使用：

```text
in-memory messages[]
→ 每轮创建临时 Promptpile directory
→ 重写完整 history
→ completion
→ 删除 directory
```

目标是：

```text
Dayloom Session
        │
        └── persistent Promptpile Conversation
```

Conversation 的 identity / location 必须可由 Session workspace 恢复。

因此：

```text
process lifetime != Session lifetime
```

Conversation 是 AI interaction authority；TUI transcript 只是 projection / read model。

这一步即使暂时没有 compression，也必须成立。

---

## 10. Promptpile React 是正式执行入口

`core2` 不建立新的 `ConversationClient.streamReply(): AsyncIterable<string>` abstraction。

一个 AI execution unit 是 **agent turn**，不是一次 completion。

目标关系：

```text
Core2 Session
    ↓
AgentRuntime
    ↓
PromptpileReactRunner
    ↓
promptpile-react executable
    ↓
Agent Event Protocol / stream-json
    ↓
Core2 AgentTurnEvent
```

`promptpile-react` 自己负责：

```text
Thought
→ Observe
→ Check
→ continue / stop
→ Final
```

Core2 不重新实现 React FSM。

---

## 11. PromptpileReactRunner 必须保持很薄

`PromptpileReactRunner` 的职责只包括：

1. 根据 Session / Conversation 准备 CLI execution；
2. 启动 `promptpile-react`；
3. 消费 machine-readable event stream；
4. 校验 public events；
5. 映射为 Core2 agent events；
6. 管理 abort / process exit / stderr diagnostics。

禁止：

- import `promptpile-react/src/*`；
- import `promptpile-react/dist/*` 私有模块；
- 重新实现 Thought / Observe / Check FSM；
- 解释 Promptpile private transport；
- 将 Promptpile 内部 event shape 直接暴露成 Core2 public contract。

当前 `promptpile-react` 只承诺 executable / protocol integration surface，因此 Core2 应尊重这个边界。

---

## 12. Core2 Agent 事件

Core2 可以定义自己的 presentation-neutral event vocabulary。

示意：

```ts
type AgentTurnEvent =
  | { type: 'turn.started'; turnId: string }
  | { type: 'turn.status'; phase: string }
  | { type: 'output.started'; messageId: string }
  | { type: 'output.delta'; messageId: string; text: string }
  | { type: 'output.completed'; messageId: string }
  | { type: 'turn.completed'; result: AgentTurnResult }
  | { type: 'turn.failed'; error: CoreError }
```

具体字段不在本草案冻结。

约束只有两个：

1. event 描述 application / agent semantics；
2. event 不描述某个具体 UI component。

例如：

```text
output.delta              ✅
terminal.textbox.append   ❌
```

---

## 13. Runtime public surface

Core2 public API 应围绕 application capability，而不是旧 Core compatibility。

示意：

```ts
const runtime = await createDayloomCore({ worldRoot })

runtime.getState()
runtime.subscribe(listener)

await runtime.startSession('play')
await runtime.sendSessionInput('进入酒馆')
await runtime.submitSession()
await runtime.cancelSession()

await runtime.dispose()
```

这只是设计方向，不是冻结接口。

不要因为现有 TUI 使用：

```text
executeCommand()
getAvailableCommands()
MessageStore
RuntimeSnapshot
```

就要求 Core2 复制这些名字或数据格式。

---

## 14. “兼容当前 TUI”真正意味着什么

Core2 需要支持以下 **交互语义**：

### Hub 语义

- consumer 能读取当前 World 状态；
- consumer 能知道当前可开始的业务流程；
- mutation 执行期间有 busy / progress / failure 信号。

### Session 语义

- consumer 能知道 Session 已开始；
- consumer 能知道 Session kind；
- user 可以连续发送自然语言输入；
- assistant Final 可以流式呈现；
- user 可以 submit；
- user 可以 cancel；
- Session 有明确 terminal state。

### 结束语义

- submit 成功后 World state 更新；
- cancel 不发布业务 mutation；
- Session 结束后 consumer 可以回到 Hub projection。

以下不属于兼容要求：

```text
旧 event name 一致
旧 event payload 一致
旧 snapshot shape 一致
旧 command string 一致
旧 message id 规则一致
旧错误 code 一致
```

---

## 15. TUI 应通过 adapter 迁移

目标关系：

```text
existing TUI components
        ↑
TuiRuntimeDriver / TuiDriverState
        ↑
new core2 runtime adapter
        ↑
@dayloom/core2
```

迁移时优先重写：

```text
packages/tui/src/runtime-driver/*
```

而不是让 `core2` 实现旧 runtime driver 期待的全部 Core API。

Adapter 可以：

- 把 Core2 runtime state 投影成 `TuiDriverState`；
- 把 Core2 events 转成 TUI messages；
- 保留当前 slash command UX；
- 保留当前 Hub page / Session page 交互；
- 隔离 presentation-specific loading / recent result state。

这些都属于 TUI package，而不是 Core2。

---

## 16. Submit 的 ownership

`submit` 是 Dayloom application command，不是 Promptpile React 自己的生命周期状态。

概念流程：

```text
user requests submit
        ↓
Core2 Session validates submit is allowed
        ↓
agent produces submission intent / candidate content
        ↓
Core2 validates business result
        ↓
Archive Protocol builds / validates candidate target
        ↓
Core2 publication transaction
        ↓
Session completed
```

模型输出不能绕过 protocol validation 直接发布 World。

如果未来使用 MCP business tools，也仍应满足：

```text
agent decides / requests capability
≠ agent owns World publication correctness
```

---

## 17. Cancel 的 ownership

Cancel 必须保持简单：

```text
cancel active agent process if any
→ close Session without World publication
→ preserve or clean Session workspace according to policy
→ emit terminal cancellation state
```

Cancel 不需要为了兼容旧 Core 恢复旧 transaction shape。

---

## 18. Compression 的处理方式

### 18.1 MVP

Core2 MVP 可以不依赖 `promptpile-compress`。

但调用顺序应天然允许未来增加 maintenance：

```text
prepare persistent Conversation
→ optional Conversation maintenance
→ run agent turn
```

MVP 中 maintenance 等价于 no-op。

### 18.2 后续加入

未来可以实现：

```text
ConversationMaintenance
        ↓
PromptpileCompressMaintenance
        ↓
runCompressionBeforeCompletion(...)
```

但不要为了这一未来能力提前建立大型 compression abstraction hierarchy。

Compress 的加入应是 extension，不是 Core2 第二次架构迁移。

---

## 19. MCP 暂不进入首个 vertical slice

Promptpile React 与 MCP 是不同 ownership：

```text
promptpile-react
= orchestration

promptpile-mcp
= generic tool execution

core2
= Dayloom business capabilities
```

Core2 首个版本可以先证明：

```text
persistent Conversation
+ React turn
+ Final streaming
+ submit publication
```

需要工具后，再把稳定的 Dayloom capability 暴露成 MCP tools。

不要先围绕 MCP JSON shape 重写 domain capability。

---

## 20. 第一条 vertical slice

不要先实现全部 init / planning / play / revise。

第一条 vertical slice 只选择一个 Session kind，推荐 `play`，完整证明：

```text
load Archive V2 World
        ↓
start play Session
        ↓
create/recover persistent Conversation
        ↓
user input
        ↓
promptpile-react
        ↓
stream Final output
        ↓
second user input on same Conversation
        ↓
promptpile-react
        ↓
submit or cancel
        ↓
Archive V2 publication or no-op
        ↓
Session terminal
```

这条链通过后，再扩展其它 Session kind。

---

## 21. 建议实施顺序

### Step 0 — Core2 package skeleton

建立：

```text
packages/core2
```

要求：

- `@dayloom/archive-protocol` direct dependency；
- `promptpile-react` direct dependency；
- Node >= 20；
- architecture guard；
- 不 import legacy core / tui。

### Step 1 — World read path

先只实现：

```text
worldRoot
→ protocol-backed repository
→ read current World state
```

不实现 legacy fallback。

### Step 2 — Session workspace + persistent Conversation

证明：

```text
start Session
→ durable Session identity
→ durable Conversation location
→ restart 后可恢复必要 metadata
```

暂时可以使用 fake AgentRuntime。

### Step 3 — Promptpile React runner

实现：

```text
persistent Conversation
→ promptpile-react
→ public agent events
→ Core2 events
```

必须包含 abort / non-zero exit / malformed event tests。

### Step 4 — 一个完整 Session kind

推荐 `play`。

完成：

```text
start
send
stream
send again
submit/cancel
terminal state
```

### Step 5 — TUI runtime adapter

保持现有 UI component 尽量不动，替换 driver 到 Core2 的连接方式。

此时检查“交互语义兼容”，而不是“API diff”。

### Step 6 — World publication

让 submit 真正通过 Archive Protocol candidate validation + Core2 publication 更新 World。

### Step 7 — 扩展其它 Session kind

按产品优先级增加：

```text
planning
init
revise
```

### Step 8 — Conversation compression

只有 Conversation 长度 / context budget 真正成为当前问题时，再加入 `promptpile-compress`。

---

## 22. 测试策略

Core2 测试不以 legacy Core 单元测试逐个移植为目标。

### Protocol boundary tests

验证：

- 只使用 `@dayloom/archive-protocol` public exports；
- malformed archive object fail closed；
- publication target 必须通过 protocol validation。

### Agent boundary tests

使用 fake executable / fixture stream 验证：

- valid Agent Event stream；
- malformed JSONL；
- unknown event；
- process non-zero exit；
- abort；
- partial Final output；
- Final completion。

### Session tests

验证：

- start；
- multiple turns；
- persistent Conversation identity；
- submit；
- cancel；
- no concurrent mutation；
- terminal Session cannot advance。

### TUI compatibility tests

测试用户可观察流程：

```text
Hub → Session → stream → submit → Hub
Hub → Session → cancel → Hub
```

不要测试 Core2 必须产生旧 RuntimeEvent payload。

---

## 23. Architecture guards

建议 Core2 初期就建立静态 guard：

禁止 source 出现：

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

允许：

```text
@dayloom/archive-protocol
@dayloom/archive-protocol/path
@dayloom/archive-protocol/tree
@dayloom/archive-protocol/staging
```

Promptpile React 通过 packaged executable / public protocol 集成。

---

## 24. Legacy Core 的处理

Core2 建立后，当前 `core` 不需要立即删除。

短期并存：

```text
core-old / core
= legacy behavior reference

core2
= new runtime implementation
```

不要建立：

```text
core2 wraps core
core wraps core2
```

也不要尝试让同一 Session 在两个 Core 之间切换。

当 Core2 + TUI vertical slice 达到产品可用标准后，再决定：

- 是否删除当前 `core`；
- 是否将 `core2` 最终重命名为 `core`；
- 是否保留 legacy CLI / migration tooling。

这些都不是 Core2 MVP 的前置工作。

---

## 25. 旧存档兼容策略

Core2 不直接支持 legacy archive runtime。

如果以后需要旧数据迁移，应设计成独立的一次性边界：

```text
legacy archive
→ migration/import tool
→ valid Archive V2 target
→ Core2
```

而不是：

```text
Core2 repository
→ detect v1/v2
→ forever maintain two storage semantics
```

---

## 26. Failure / recovery 原则

Core2 必须明确区分：

```text
Session failure
Agent turn failure
Conversation state
World publication failure
```

基本原则：

- agent turn 失败不能产生部分 Published World；
- World publication 失败必须 fail closed；
- process crash 后可以从 durable Session metadata 判断是否可恢复；
- Conversation artifact 可以比 UI transcript 更权威；
- recovery 不依赖完整内存 history。

第一版不要求实现所有自动 recovery，但数据布局必须避免让 recovery 不可能。

---

## 27. 不应提前冻结的内容

本草案不冻结：

- 最终 public API 函数名；
- event payload 字段；
- Session workspace 的最终目录名；
- TUI adapter 具体文件结构；
- MCP tool set；
- compression policy；
- semantic summary provider；
-所有 Session prompt 内容。

先通过 vertical slice 获得真实约束，再冻结这些 surface。

---

## 28. Core2 MVP 完成标准

只有满足以下条件，才认为 Core2 第一阶段成立：

1. `packages/core2` 完全不依赖 legacy Core / TUI；
2. World 只通过新的 `@dayloom/archive-protocol` 读写；
3. 一个业务 Session 可以完整运行；
4. 同一 Session 多轮对话复用同一个 persistent Conversation；
5. AI turn 使用 `promptpile-react`，而不是 direct Promptpile compatibility wrapper；
6. Final output 可以流式传给 consumer；
7. submit 能产生经过 protocol validation 的 World publication；
8. cancel 不发布 World mutation；
9. 当前 TUI 可以通过 adapter 完成等价的 Hub / Session 用户交互；
10. 没有为了旧 Core API 或 TUI DTO 引入 compatibility layer。

Compression 不属于上述 MVP hard requirement。

---

## 29. 一句话架构原则

```text
Core2 是 Dayloom 新 application/runtime core。
Archive Protocol 定义持久数据正确性；
Promptpile React 定义 agent orchestration；
Core2 定义 Session 与 World 的业务生命周期；
TUI 只负责把这些语义投影成交互界面。
```

如果某个设计选择要求 Core2 为了“少改 TUI”或“兼容旧 Core”重新承担旧 abstraction，应默认拒绝，并优先修改 adapter / consumer。
