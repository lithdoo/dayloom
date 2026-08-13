# Dayloom Promptpile React / MCP Agent Runtime 重构草案

> 状态：Draft / Phase 3 设计入口  
> 日期：2026-08-13  
> 目标：在 World 与 Persistent Conversation 稳定后，把 Dayloom 的 AI 执行边界从 direct Promptpile single-completion wrapper 升级为 `promptpile-react` orchestration + `promptpile-mcp` tool execution，并使用公开 Agent Event Protocol 驱动 Dayloom runtime。  
> 实施顺序：**Phase 3 / 3**  
> 前置：`WORLD_DOCUMENT_MODEL_DRAFT.md`、`PERSISTENT_CONVERSATION_COMPRESSION_DRAFT.md`

## 1. 一句话结论

当 Dayloom 开始需要：

- 多步模型推理；
- World / staging tools；
- Conversation archive retrieval；
- 一轮用户输入内连续调用多个工具；
- Final streaming；

它的执行单位已经不再是“一次 completion”，而是一个完整 **agent turn**。

因此 Phase 3 的目标关系应从：

```text
Dayloom
→ promptpile
→ assistant text
```

升级为：

```text
Dayloom
→ promptpile-react
    → promptpile single completions
    → calls artifacts
    → promptpile-mcp tool execution
    → Observe / Check
    → Final
→ Agent Event Protocol
→ Dayloom presentation projection
```

Dayloom 不应该自己重新实现 ReAct loop、generic MCP executor 或 Promptpile private streaming transport。

## 2. 为什么这一阶段必须最后做

Agent runtime 同时依赖前两个阶段定义的稳定对象。

它需要 Phase 1 回答：

```text
工具到底读什么？
工具到底改什么？
什么是 staging？
什么才算 Published World？
```

它需要 Phase 2 回答：

```text
Agent 在哪个 Conversation 上运行？
Conversation 如何长期存在？
何时允许压缩？
重启后如何恢复？
```

如果 Phase 3 先做，MCP tools 和 React adapter 会直接绑定旧强类型 World / 临时 Conversation，随后至少重写一次。

所以 Phase 3 是前两个稳定系统的 **consumer**，不能反过来定义它们。

## 3. Promptpile ecosystem 的目标 ownership

Phase 3 应严格尊重当前 Promptpile package 分层：

```text
promptpile-protocol
= shared public pure data contracts

promptpile
= exactly one Chat Completions execution primitive
+ Conversation runtime/publication

promptpile-react
= Thought → Observe → Check → Final orchestration

promptpile-mcp
= generic MCP tool execution ownership

promptpile-compress
= Conversation compression/archive lifecycle

Dayloom
= World + Session + staging + business tools + publish + presentation
```

这个 ownership 是本阶段最重要的设计约束。

## 4. `promptpile-react` 应成为主要 AI 执行入口

Phase 2 可以暂时保留 direct Promptpile；Phase 3 则应把正式用户回合迁移到 React。

原因是新版用户回合已经可能包含：

```text
Thought
→ ToolCall
→ ToolResult
→ Observe
→ Check
→ more Thought/tool cycles
→ Final
```

这不再适合抽象成：

```ts
streamReply(request): AsyncIterable<string>
```

因为 `string` 只能表达 Final 文本，无法表达 agent turn lifecycle、失败 phase 或 terminal result。

## 5. Dayloom 不再拥有 ReAct FSM

Dayloom 不应复制：

```text
Thought
Observe
Check
continue?
max step?
Final
```

这些状态和转移属于 `promptpile-react`。

Dayloom 应做的是：

```text
start one agent turn
→ observe public events
→ project status/final output
→ apply Dayloom business success/failure policy
```

这样未来 Promptpile React 内部 phase implementation 演化时，Dayloom 不需要同步维护第二套 FSM。

## 6. MCP 的角色：executor，不是 orchestration

必须明确：

```text
promptpile-react
≠ generic tool executor
```

Thought completion 产生 calls artifact 后，真实工具副作用由 `promptpile-mcp` 或兼容 executor 负责。

目标链：

```text
Thought completion
→ ToolCall artifact
→ promptpile-mcp execution claim
→ MCP server tools/call
→ ToolResult artifact
→ Observe
→ Check
```

Dayloom 不需要自己拥有：

- ToolCall parser；
- generic MCP session lifecycle；
- execution retry engine；
- duplicate side-effect claim；
- ToolResult atomic publication；
- MCP response vector validation。

这些已经属于 Promptpile protocol / MCP execution layer。

## 7. Dayloom 只拥有业务工具语义

Phase 1 稳定后，Dayloom 可以把自身业务能力暴露为 scoped MCP tools。

概念上可能包括：

```text
world.read
world.list/search
staging.read
staging.write/replace
staging.delete
staging.inspect
```

具体工具集合不在本草案冻结。

必须保持原则：

```text
MCP tool
= adapter over stable Dayloom domain capability
```

而不是：

```text
Dayloom domain capability
= 为 MCP JSON shape 临时创造的实现
```

这样业务层仍可在没有 MCP 的情况下独立测试。

## 8. Conversation history / compression tools

Phase 2 已经建立 persistent Conversation + Compress 后，Phase 3 才可以把 archive retrieval 等能力作为 Agent tools 使用。

应保持职责分离：

```text
promptpile-compress
= mutation lifecycle

archive retrieval/search consumer
= read/search archived history

promptpile-mcp
= executes exposed tools

promptpile-react
= decides whether the model continues
```

不要把 Compress 本身改造成 Agent orchestrator，也不要让 Dayloom 重写 archive mutation。

## 9. 对话输出数据格式必须改变

这是本阶段一个明确的 breaking change。

旧模型：

```text
ConversationClient
→ AsyncIterable<string>
```

适合：

```text
one completion
→ assistant delta
```

但不适合 agent turn。

新 runtime boundary 应概念上变成：

```text
AgentTurnRequest
→ stream of structured AgentTurn events
```

Dayloom 必须能够区分至少三类事实：

```text
1. runtime lifecycle
2. final user-visible content
3. terminal success/failure
```

具体 TypeScript 类型属于 implementation design，本草案只冻结“不能继续只用 string delta 表达整个 agent turn”。

## 10. 使用 Agent Event Protocol，而不是 Promptpile output-pile

当前 `promptpile-react` 已提供公开 `stream-json` machine output，其 Agent Event Protocol 只投影 orchestration 允许公开的事件，例如：

```text
session.started
phase.started
phase.completed
final.delta
session.completed
session.failed
```

Phase 3 后，Dayloom 应消费这个 public boundary。

Dayloom 不应继续直接依赖 Promptpile single-completion 的：

```text
--output-pile-fd 3
assistant_delta
assistant_done
error
```

因为那是更低层的 completion transport，不是 Dayloom 的 agent runtime contract。

目标 ownership：

```text
Promptpile output pile
= Promptpile ↔ React internal/private execution transport

Agent Event Protocol
= React → Dayloom public realtime projection
```

## 11. 展示页面应尽量保持原样

底层输出数据格式破坏性变化，不意味着聊天 UI 也要破坏性变化。

Dayloom 应建立明确 projection：

```text
Agent Event Protocol
        ↓
Dayloom runtime/presentation model
        ↓
现有页面
```

用户仍主要看到：

```text
User
Assistant
User
Assistant
```

建议映射：

```text
new user input
→ 原 user message

final.delta
→ 原 assistant streaming bubble

session.completed
→ finalize assistant message

session.failed
→ 原错误/重试体验
```

而以下内部状态默认不成为 transcript 正文：

```text
Thought
Observe
Check
MCP tool calls
compression lifecycle
internal receipts/diagnostics
```

它们最多用于 loading/status/diagnostics。

因此本阶段应坚持：

```text
runtime semantics: breaking change
presentation behavior: intentionally stable
```

## 12. 三种“消息”必须分开

Phase 3 后尤其需要避免把所有东西都叫 message。

### 12.1 Promptpile Conversation artifacts

```text
= AI context / durable interaction truth
```

包括 user/assistant/tool artifacts、ReAct artifacts、compression/archive state 等。

### 12.2 Agent runtime events

```text
= non-durable realtime execution projection
```

用于状态、Final streaming、terminal result。

### 12.3 Dayloom presentation messages

```text
= user-facing UX/read model
```

主要保持 user / assistant / error/status。

关系：

```text
Conversation artifacts
≠ Agent events
≠ Presentation messages
```

三者可以相互投影，但不能互相冒充 canonical truth。

## 13. Final 是默认用户可见 assistant 输出

ReAct 内部可能产生多个 completion，但用户页面不应该把每个 Thought 当 assistant 回复。

默认产品语义应是：

```text
Thought / Observe / Check
= internal agent work

Final
= user-facing assistant reply
```

这与 React public event contract 的信息最小化方向一致，也能避免把 hidden/internal reasoning 泄漏进 UI transcript。

## 14. Direct Promptpile 的角色变化

Phase 3 后，Dayloom production runtime 不应再把 Promptpile 当主要直接 provider entry。

更合理关系：

```text
Dayloom
→ promptpile-react public CLI

promptpile-react
→ promptpile public CLI
```

Dayloom 可以在 diagnostics/tests 中理解 Promptpile artifacts，但不应该越过 React 去控制其内部每次 completion。

## 15. 禁止 private package layout coupling

当前旧 adapter 会通过 package path 推导：

```text
promptpile/dist/index.js
```

Phase 3 应删除这种 coupling。

正式集成只允许依赖：

- public CLI/bin metadata；
- explicit executable override；
- PATH；
- versioned public artifacts/protocols。

不依赖：

```text
promptpile/dist/*
promptpile/src/*
promptpile-react/dist/* private layout
```

这样 Dayloom 才真正消费 package contract，而不是 implementation topology。

## 16. Node / package contract 需要同步

当前 Promptpile 新 runtime packages 已以 Node 20+ 为主要支持基线。

如果 Dayloom 正式 runtime 直接依赖/启动这些 package，则 Dayloom 不能继续宣称一个比必需 runtime 更低的 Node 支持范围。

Phase 3 应让：

```text
Dayloom declared runtime support
= required Promptpile ecosystem runtime support
= CI matrix
```

具体 package version pinning/compatibility policy属于 implementation freeze 阶段，但不能继续模糊依赖。

## 17. Cancellation / failure ownership

Dayloom 可以决定：

```text
用户取消本次 turn
Session 是否继续可用
UI 如何显示失败
```

但底层不同 failure 应由各 owner 提供明确语义：

```text
React
→ phase / terminal failure

Promptpile
→ completion/publication failure

MCP
→ tool execution / indeterminate ownership

Compress
→ compression/recovery failure

Dayloom
→ World/staging/business failure
```

Dayloom 的职责是组合这些结果，而不是把它们重新压成一个“LLM call failed”字符串。

## 18. `/submit` 不属于 React Final

Phase 1 已把 `/submit` 重新定位为 staged state 的 deterministic publication。

因此必须保持：

```text
React Final
= 给用户的自然语言结果/说明

Dayloom /submit
= validate + publish staging
```

不能重新回到：

```text
Final JSON
→ parse
→ commit World
```

否则 Phase 1 的核心收益会被 Phase 3 反向破坏。

## 19. 不做什么

本阶段明确不做：

- 不重新设计 World archive；
- 不重新设计 staging transaction；
- 不重新设计 persistent Conversation identity；
- 不让 React 拥有 World publication；
- 不让 Promptpile core 执行 generic tools；
- 不让 Dayloom 实现第二套 ReAct FSM；
- 不让 Dayloom 实现第二套 MCP executor；
- 不公开 Thought/Observe/Check 正文到普通 UI；
- 不把 compression lifecycle 当聊天正文；
- 不因为 Fork/Receipt/Fingerprint 可用就强制全部引入；
- 不继续依赖 private `dist/*` layout。

## 20. 主要风险

### 20.1 把所有 Promptpile packages 都塞进 Dayloom ownership

错误方向：

```text
Dayloom orchestrates everything directly
```

会重新复制 Promptpile ecosystem 已经完成的分层。

### 20.2 把 Agent events 直接作为 UI transcript

会泄漏内部 lifecycle，破坏用户体验，并把非 durable runtime projection误当对话事实。

### 20.3 MCP tools 直接操作 Published World

AI tool mutation 必须进入 Phase 1 定义的 staging，不得绕过 Dayloom publication boundary。

### 20.4 继续保留旧 `ConversationClient` 作为 canonical abstraction

可以短期有 adapter，但最终 `AsyncIterable<string>` 不能再表达完整 agent turn contract。

### 20.5 把 React success 等同于 World success

React `session.completed` 只能证明 agent turn 成功，不能证明 `/submit` 或 World publication 成功。

## 21. Phase 3 成功判定

最终应能证明：

```text
Dayloom successful agent turn
⇒ one persistent Conversation was advanced through public boundaries
⇒ React reached a valid success terminal
⇒ any executed generic/domain tool had an execution owner
⇒ Final was projected to the user
⇒ no Published World mutation happened implicitly
```

以及：

```text
Dayloom /submit success
⇒ Phase 1 staging validation succeeded
⇒ expected World base still matched
⇒ publication succeeded atomically
⇒ no second LLM interpretation was required
```

还应满足：

- production Dayloom 不解析 Promptpile private output-pile；
- production Dayloom 不依赖 `promptpile/dist/*`；
- React / MCP ownership 没有复制到 Dayloom；
- Dayloom-scoped MCP tools 只是稳定 domain capabilities 的 adapter；
- presentation UI 仍可维持原有 user/assistant 模型；
- internal Thought/Observe/Check 不进入普通 transcript；
- runtime event contract 能表达 terminal success/failure；
- cancellation / crash 后能结合 Phase 2 persistent Conversation 做诊断和恢复。

## 22. Executable evidence 方向

Formal Freeze 前应有跨层 witness，至少证明：

```text
Dayloom Session
→ persistent Conversation
→ optional compression
→ public promptpile-react CLI
→ real Promptpile completions
→ calls artifact
→ promptpile-mcp
→ Dayloom-scoped MCP fixture/tool
→ staging mutation
→ Observe / Check
→ Final stream-json
→ Dayloom presentation projection
```

以及 `/submit` 独立证明：

```text
staging
→ validation
→ deterministic World publication
```

两条 witness 不应合成一个无法定位问题的巨型测试；Agent turn success 与 World publish success 是两个不同 theorem。

## 23. 三阶段总顺序

```text
Phase 1
WORLD_DOCUMENT_MODEL_DRAFT.md
        │
        │ defines World/staging/publication
        ▼
Phase 2
PERSISTENT_CONVERSATION_COMPRESSION_DRAFT.md
        │
        │ defines durable AI history/lifecycle
        ▼
Phase 3
PROMPTPILE_AGENT_RUNTIME_DRAFT.md
        │
        │ consumes both stable boundaries
        ▼
Dayloom V2 integration / hardening / freeze
```

整体设计先统一 ownership，但实施必须分阶段独立验收。

## 24. 最终目标

Phase 3 完成后，Dayloom 的 AI runtime 应从：

```text
Dayloom domain schema
→ in-memory messages
→ temporary Promptpile completion
→ text delta
→ model-generated submission
```

迁移为：

```text
Document-native World
        ▲
        │ staging tools
        │
persistent Conversation
        │
compression/archive
        │
promptpile-react
        │
promptpile + promptpile-mcp
        │
Agent Event Protocol
        │
Dayloom presentation projection
```

最终 ownership：

```text
Dayloom
= World / Session / staging / business tools / publication / presentation

Promptpile ecosystem
= Conversation / completion / orchestration / generic tool execution / compression lifecycle
```

这是本次三阶段破坏性重构最终需要达到的边界。
