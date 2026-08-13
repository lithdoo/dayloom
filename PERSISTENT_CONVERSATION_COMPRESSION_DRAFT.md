# Dayloom 持久 Conversation 与压缩生命周期重构草案

> 状态：Draft / Phase 2 设计入口  
> 日期：2026-08-13  
> 目标：把 Dayloom 的 AI Session 从内存 `messages[]` + 临时 Promptpile Conversation 迁移为持久 Conversation，并引入 `promptpile-compress` 管理长期上下文生命周期。  
> 实施顺序：**Phase 2 / 3**  
> 前置：`WORLD_DOCUMENT_MODEL_DRAFT.md` 形成稳定的 World / Session / staging 边界。  
> 后续：`PROMPTPILE_AGENT_RUNTIME_DRAFT.md`

## 1. 一句话结论

Phase 2 只解决一个问题：

> **一个 Dayloom AI Session 如何拥有一个长期存在、可以压缩、归档、恢复和继续使用的 Promptpile Conversation。**

这一阶段不要求 ReAct，也不要求 MCP。理想中间状态是：

```text
Document World V2       ✅
Persistent Conversation ✅
Compression lifecycle   ✅

AI execution
= 仍可 direct Promptpile / one completion
```

这样可以单独证明 Conversation lifecycle，而不把 Agent complexity 混进来。

## 2. 当前模型的问题

当前正式实现的自然语言 Session 以进程内 `messages[]` 作为主要对话状态，每次模型调用时：

```text
messages[]
→ 创建临时目录
→ 重写 system/user/assistant 文件
→ 调一次 Promptpile
→ 读取输出
→ 删除临时 Conversation
```

这让 Promptpile Conversation Directory 退化成一次性 provider request envelope。

后果包括：

1. 进程重启后无法把 Conversation 当作可恢复的一等状态。
2. 每次请求重新复制完整历史，历史身份并不稳定。
3. Promptpile 的 Conversation artifacts、tool artifacts、archive/compression 能力无法形成长期价值。
4. 对话增长后只能不断重复发送历史，没有正式 context lifecycle。
5. UI transcript、内存 messages 与 Promptpile files 可能形成多份竞争性 truth。
6. 后续 ReAct / MCP 会产生更多 calls/results/artifacts，临时目录模型会变得更不自然。

因此 Phase 2 的首要变化不是“加一个 compress 命令”，而是先让 Conversation 本身变成持久对象。

## 3. 核心原则

### 3.1 一 Session 对应一个持久 Conversation identity

目标关系：

```text
Dayloom Session
        │
        └── persistent Promptpile Conversation
```

Conversation 不因一次模型调用结束而删除。

Session workspace 应保存足以恢复该映射的信息；内存引用只能是缓存。

### 3.2 `messages[]` 不再是 AI Conversation authority

Phase 2 后：

```text
Promptpile Conversation
= AI interaction truth

Dayloom transcript / presentation messages
= UX/read model

in-memory messages[]
= optional cache, not authority
```

不能再要求 AI runtime 每次接收“截至当前的完整消息数组”才能继续。

### 3.3 Conversation 与 World 必须保持独立

必须继续区分：

```text
Promptpile Conversation
= 对话、模型输出、tool artifacts、压缩历史

Dayloom Session Workspace
= staging / run / recovery / mapping

Dayloom World Archive
= published world truth
```

Conversation compression 不得直接修改 Published World；World commit 也不能把 Conversation archive 当作自身事实来源。

## 4. Phase 2 的目标运行模型

从：

```text
user input
→ build full messages[]
→ temp Conversation
→ completion
→ delete
```

迁移到：

```text
user input
→ append/advance persistent Conversation
→ optional compression lifecycle
→ completion on same Conversation
→ durable assistant artifacts
→ Session continues later on same Conversation
```

这一阶段可以继续只运行一次 completion；不要求 Thought/Observe/Check/Final。

## 5. 为什么 Compress 必须建立在 Persistent Conversation 之后

如果 Conversation 仍然每轮重建，则 compression 没有稳定的生命周期对象。

错误组合：

```text
temp Conversation
→ compress
→ completion
→ delete directory
```

这无法获得真正的 archive / restore / recovery 价值。

正确关系：

```text
persistent Conversation
        ↓
context budget grows
        ↓
promptpile-compress lifecycle
        ↓
active history + summary + archive
        ↓
continue same Session
```

因此 Phase 2 内部顺序也应是：

```text
先 persistent Conversation
再 compression lifecycle
```

## 6. `promptpile-compress` 的定位

Dayloom 不应自己重新实现 Conversation compression transaction。

当前 Promptpile ecosystem 已把以下职责放在 `promptpile-compress`：

- turn selection；
- context budgeting；
- compression staging；
- archive commit；
- summary；
- restore；
- recovery；
- recompress；
- cooperating-writer locking；
- generation precondition；
- fault/retry handling。

Dayloom 应作为 lifecycle consumer / orchestrator，而不是复制这些语义。

理想 ownership：

```text
Dayloom
= decides when this Session may advance
+ supplies product policy / budgets
+ records Session diagnostics

promptpile-compress
= owns Conversation compression mutation correctness
```

## 7. Compression 不等于无限上下文

Phase 2 必须明确产品语义：

```text
long-lived Conversation
≠ model always sees every historical byte
```

更准确的长期状态是：

```text
recent live history
+
semantic/compact summary
+
lossless archived history
+
future on-demand retrieval path
```

因此 Compress 的目标是维护 **bounded active context**，而不是承诺无限 token。

## 8. Archive 与 Retrieval 要分开

`promptpile-compress` 负责 compression/archive lifecycle，但 archive retrieval/search 是另一个问题域。

Phase 2 可以建立：

```text
compress
restore
recovery
archive identity
```

但不要求同时完成：

- vector database；
- semantic ranking；
- arbitrary search agent；
- web search；
- full MCP retrieval toolchain。

如果产品需要历史检索，可以在稳定 archive contract 上使用独立 consumer，例如 grep/search 或后续 MCP tools。

不要把“压缩”和“检索”合成一个不可测试的大模块。

## 9. Session 恢复语义

Phase 2 的核心价值之一是：进程生命期不再等于 Session 生命期。

应能概念上支持：

```text
process exits/crashes
        ↓
restart
        ↓
load Session workspace
        ↓
resolve persistent Conversation
        ↓
inspect/recover compression state if needed
        ↓
continue or safely cancel
```

恢复时不应依赖完整内存 `messages[]`。

如果 Conversation 本身处于压缩 mutation/recovery 状态，应先完成或显式处理该 lifecycle，再允许下一次 completion。

## 10. Writer ownership 与串行化

Phase 2 不应该在 Dayloom 内重新实现 Promptpile 的 Conversation OCC 或 Compress 的 mutation lock。

应区分：

```text
Dayloom Session ownership
= 业务层谁可以推进这个 Session

Promptpile Conversation OCC
= completion / append publication correctness

promptpile-compress lock
= compression lifecycle mutation correctness
```

Dayloom 可以在业务层保证同一 Session 不同时启动多个互斥操作，但不能把自己的 Session lock 冒充底层 Conversation transaction protocol。

建议的高层串行关系：

```text
Session operation
→ optional compression lifecycle
→ completion / append
→ persist Session run result
```

同一个 Conversation 上不要让 compress 与 completion 无序并发。

## 11. Conversation identity 与 Session metadata

Phase 2 应让 Session workspace 持久保存 Conversation 的稳定映射，而不是每次通过临时目录推导。

概念上需要能回答：

```text
这个 Session 使用哪个 Conversation？
Conversation 当前是否存在？
上一次成功推进到哪里？
是否存在需要恢复的 compression lifecycle？
当前 Session 是否允许继续？
```

具体字段和文件布局属于后续 implementation design，本草案不冻结。

## 12. 用户输入与 Conversation append

Phase 2 后，用户输入应该成为持久 Conversation 的增量，而不是触发一次完整重建。

目标语义：

```text
previous durable Conversation
+
new user input
→ next durable Conversation state
```

不能再要求：

```text
read UI transcript
→ regenerate every prior message file
```

这样 UI transcript 才能真正降级成 presentation/read model。

## 13. 输出与 UI 的关系

Phase 2 不要求改变页面。

即使底层从临时 request 变成持久 Conversation，Dayloom 仍可以向展示层投影为：

```text
user message
assistant streaming message
error/status
```

Phase 2 的 breaking change 应主要发生在 runtime/storage boundary，而不是聊天页面。

这也为 Phase 3 以后用 Agent Event Protocol 替换文本 delta source 留出空间。

## 14. 与 Phase 1 的关系

Phase 2 不改变 World transaction。

```text
World V2
= published/staging truth

Conversation V2
= AI interaction/history truth
```

Conversation 中提到某件事仍不代表 World 已经改变。

如果 Phase 1 已建立 staging，Phase 2 只负责让未来 AI 能跨多轮长期讨论和使用它；本阶段不需要 MCP tool 调用就可以验收 Conversation lifecycle。

## 15. 与 Phase 3 的关系

Phase 3 会把一次“用户回合”的执行从 direct Promptpile completion 升级成 `promptpile-react` ReAct turn。

Phase 2 必须提前提供稳定基础：

```text
persistent Conversation identity
compression lifecycle
session ↔ conversation mapping
recovery semantics
```

这样 Phase 3 只需要改变：

```text
怎么推进 Conversation
```

而不是再次改变：

```text
Conversation 是什么、放在哪里、如何恢复
```

## 16. 不做什么

本阶段明确不做：

- 不定义 Thought/Observe/Check/Final FSM；
- 不要求 `promptpile-react`；
- 不实现 generic MCP tool execution；
- 不定义 Dayloom World MCP tools；
- 不把 compression event 变成用户可见聊天消息；
- 不把 archive summary 当作 Published World 文档；
- 不承诺无限 context；
- 不复制 Promptpile OCC；
- 不复制 Compress lock/recovery algorithm；
- 不因为持久 Conversation 而改变 Phase 1 的 deterministic World publication。

## 17. 主要风险

### 17.1 多份 Conversation truth

如果 `messages[]`、transcript、Conversation directory 都继续可独立写入，就会形成漂移。

Phase 2 必须最终只保留一个 AI Conversation authority。

### 17.2 Compression 与 completion 并发

如果同一 Conversation 上允许无序同时 compress 和 completion，会破坏 lifecycle reasoning。

业务 orchestrator 必须明确操作顺序，但 correctness 应分别由各 package owner 负责。

### 17.3 把 summary 当完整记忆

压缩摘要必然是有损投影。需要保留 archive，并为未来 retrieval 留出口。

### 17.4 把 Session longevity 等同于资源无限

长期 Session 仍需要：

- context budget；
- compression threshold；
- disk policy；
- tool/turn budget；
- cancellation；
- diagnostics。

## 18. Phase 2 成功判定

进入 Phase 3 前，应能证明：

```text
Dayloom Session
⇒ resolves one durable Conversation identity
```

```text
process restart
⇒ core Session/Conversation relation can be reconstructed from persisted state
```

```text
new user turn
⇒ advances existing Conversation
≠ rebuilds all historical messages from UI memory
```

```text
compression success
⇒ Conversation remains valid and continuable
```

```text
compression failure/crash
⇒ recovery/restore path is explicit
⇒ no silent history loss is accepted as success
```

```text
World publication
⊥ Conversation compression
```

即二者生命周期独立，互不冒充对方的 truth。

此外：

- `messages[]` 不再是 AI history authority；
- temp Conversation-per-request 模型被移除；
- 长对话可以触发压缩而继续同一 Session；
- 页面仍可维持原有 user/assistant 展示模型；
- 本阶段在没有 React/MCP 的情况下也能独立通过测试。

## 19. 实施顺序

完整三阶段顺序：

```text
Phase 1
WORLD_DOCUMENT_MODEL_DRAFT.md
        ↓
Phase 2
PERSISTENT_CONVERSATION_COMPRESSION_DRAFT.md
        ↓
Phase 3
PROMPTPILE_AGENT_RUNTIME_DRAFT.md
```

Phase 2 的价值是把“长期 AI Session”先变成一个可靠的数据/lifecycle 事实，然后再让 Phase 3 改变它的执行方式。

## 20. 最终目标

Phase 2 完成后，Dayloom 应从：

```text
stateless-ish LLM provider wrapper
```

迁移为：

```text
persistent AI Session host
```

其核心关系是：

```text
Dayloom Session
    ↓
persistent Promptpile Conversation
    ↓
compression / archive / recovery
    ↓
continued model work
```

这会成为 Phase 3 ReAct + MCP runtime 的稳定基础，而不是由 Agent runtime 反过来定义 Conversation 生命周期。
