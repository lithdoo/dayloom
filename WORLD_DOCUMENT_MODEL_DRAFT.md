# Dayloom 文档原生 World 数据模型重构草案

> 状态：Draft / Phase 1 设计入口  
> 日期：2026-08-13  
> 目标：把 Dayloom 的 AI 语义内容从过度强类型结构迁移为文档原生 World，同时保留严格、最小、可验证的控制平面。  
> 实施顺序：**Phase 1 / 3**  
> 后续依赖：`PERSISTENT_CONVERSATION_COMPRESSION_DRAFT.md`、`PROMPTPILE_AGENT_RUNTIME_DRAFT.md`

## 1. 一句话结论

Dayloom V2 的第一步不是先引入 Agent、MCP 或 Conversation 压缩，而是先重新定义 **World 到底是什么**：

```text
AI / 人主要理解的世界语义
→ 文档原生内容

程序必须确定性理解的生命周期与一致性
→ 少量强结构化控制数据
```

这一步建立后，后续 Conversation、Compress、ReAct 与 MCP 才有稳定的业务对象可消费。

## 2. 为什么必须先做这一阶段

当前正式实现把大量 AI 生成内容映射为固定 TypeScript/domain schema，例如不同种类的 canon、plan、event、submission 与 projector。这个模型的问题不是“JSON 不好”，而是 **程序结构化了大量它并不真正需要确定性理解的 AI 语义**。

长期看会产生以下成本：

1. 每增加一种世界内容，都需要同步修改 schema、validator、reader、transaction 与 submission。
2. AI 先理解自然语言世界，再生成严格结构，下一轮又把严格结构转回文本让 AI 重新理解。
3. `/submit` 容易变成“再次让模型解释完整对话并生成结构化结果”，形成第二次语义判断和漂移。
4. World 内容形态受程序 schema 限制，难以自然扩展人物、地点、事件、知识、记忆、自定义资料等内容。
5. 后续 MCP staging tools 如果直接绑定现有强类型领域对象，Phase 1 一旦变化，Agent/tool surface 还要二次推翻。

因此 World model 必须先于 Agent runtime 冻结。

## 3. 核心原则

### 3.1 AI 语义文档化，控制状态结构化

判断标准：

> **程序必须确定性理解它，就结构化；主要由 AI / 人理解它，就文档化。**

适合文档原生的内容包括但不限于：

- 世界背景；
- 规则说明；
- 文风；
- 人物；
- 地点；
- 时间线；
- 剧情记录；
- 长期记忆；
- 计划与阶段目标；
- 用户自定义知识；
- 其它未来新增语义内容。

仍应保持严格结构化的内容包括但不限于：

- archive/schema version；
- world identity；
- commit/tree/blob identity；
- current pointer；
- revision / parent relation；
- active session / operation identity；
- lifecycle state；
- staging manifest；
- permission / quota；
- lock / conflict information；
- hash / size / media type；
- recovery metadata。

这不是“全部 Markdown 化”，而是明确 semantic plane 与 control plane 的不同职责。

## 4. 目标领域模型

Dayloom V2 应把 World 理解为：

```text
World
├─ immutable published document state
├─ minimal structured control plane
└─ explicit publication history
```

语义文档可以采用 Markdown、JSON、YAML 或其它受控媒体类型，但它们作为 **World document** 存在，而不是要求 Dayloom core 为每种语义建立专用领域对象。

路径结构应能自然扩展，例如：

```text
world.md
rules.md
style.md
characters/**
locations/**
timeline/**
memory/**
days/**
custom/**
```

这些路径是产品约定或 profile，而不应全部成为 archive reader 的硬编码 schema。

## 5. 三个必须分开的状态域

Phase 1 必须为后续 V2 固定三个不同的 truth domain：

```text
1. Published World
   = 已正式发布的世界事实

2. Session Staging
   = 本次 Session 中尚未发布的工作状态

3. AI Conversation
   = AI 对话和工具上下文
```

本阶段只负责前两个的 World 侧边界，并为第三个留出稳定接口。

必须明确：

```text
AI 说过某件事
≠ World fact

AI 建议修改某个文档
≠ World fact

staging 中存在修改
≠ World fact

只有成功 publication
= Published World fact
```

## 6. Staging 必须成为正式的一等概念

未来 AI 不应该通过“最终 JSON submission”来描述它想修改什么，而应该在对话过程中逐步形成可检查的 staged state。

Phase 1 应先建立与 AI runtime 无关的 staging 语义：

```text
Published base
     ↓
Session staging overlay
     ↓
validation
     ↓
atomic publication
```

本阶段不要求 MCP；测试和当前业务代码可以直接调用 staging API。

后续 Phase 3 的 Dayloom MCP tools 只是这些稳定业务能力的一个 adapter，而不能反过来定义 staging 模型。

## 7. `/submit` 的目标语义

Phase 1 应重新定义 `/submit`：

旧思路：

```text
conversation
→ 再调用 AI
→ 生成强类型 JSON
→ parse
→ apply
```

目标思路：

```text
conversation 中已经形成 staged state
→ /submit
→ deterministic validation
→ deterministic publication
```

因此 `/submit` 的职责应逐步从“AI 再解释一次”迁移为“发布已经明确存在的工作状态”。

这会降低：

- 最后一次模型输出漂移；
- JSON 格式失败；
- 讨论内容与最终修改不一致；
- 多轮对话后重新理解全部历史的成本。

## 8. 保留 Dayloom 现有事务优势

现有 Archive V1 中已经有价值的事务设计不应因为“文档原生”被丢弃，包括：

- immutable history；
- atomic current publication；
- operation/workspace；
- locking；
- validation；
- conflict detection；
- crash recovery；
- auditability；
- GC / integrity checking。

Phase 1 的目标是 **替换内容模型，不是削弱事务模型**。

理想方向是：

```text
语义层变得更自由
控制层保持甚至变得更严格
```

## 9. 与 Conversation / Promptpile 的边界

本阶段刻意不依赖后续两个改造完成。

允许保留当前 direct Promptpile adapter，甚至允许暂时保留当前 AI 调用形式，只要新 World / staging / publication 已经能独立运行。

Phase 1 不负责：

- persistent Promptpile Conversation；
- promptpile-compress；
- promptpile-react；
- promptpile-mcp；
- Agent Event Protocol；
- ReAct loop；
- generic tool execution；
- Conversation history retrieval。

这些属于 Phase 2 / Phase 3。

## 10. 对后续 Phase 的稳定输出

Phase 1 完成后，应向后续系统提供稳定的业务能力，而不是暴露 archive 内部布局。

概念上至少应存在：

```text
read published document(s)
list/search visible document paths
inspect staged changes
stage create/replace/delete
validate staging
publish staging
cancel/discard staging
recover operation/session state
```

Phase 3 的 MCP server 未来只需要包装这些稳定能力。

## 11. 不做什么

本阶段明确不做：

- 不设计完整 ReAct runtime；
- 不把 promptpile-react 引入作为完成条件；
- 不实现 generic MCP executor；
- 不把 Conversation compression 混入 World transaction；
- 不把 Conversation archive 当成 World archive；
- 不把所有内容强行统一成 Markdown；
- 不为所有未来文档定义语义 schema；
- 不为了兼容 Archive V1 而长期维护双写模型；
- 不让模型直接写 current pointer / commit / tree / blob / lock 等控制数据。

## 12. 迁移风险

### 12.1 过度文档化

错误方向：

```text
everything → Markdown
```

会失去程序可验证性。

必须持续坚持 control plane 强结构化。

### 12.2 过度兼容旧 schema

如果新 document model 外面长期包着旧 `Submission` / `CanonDocuments` / `PlanBeat` 兼容层，会形成双重领域模型。

Phase 1 可以有短期 migration adapter，但最终只能有一个 canonical World model。

### 12.3 MCP 过早介入

不要为了未来工具调用提前把业务 API 设计成 MCP JSON shape。MCP 是 adapter，不是领域模型。

### 12.4 UI 反向驱动存储结构

TUI / presentation read model 可以继续展示当前用户体验，但不能要求底层 World 恢复为旧强类型语义模型。

## 13. Phase 1 成功判定

在进入 Phase 2 前，至少应能证明：

```text
Published World
= immutable document state
+ minimal structured control
```

以及：

```text
staging mutation
≠ published mutation
```

```text
successful submit/publication
⇒ staged state was validated
⇒ expected base/control state still matched
⇒ immutable content objects were complete
⇒ publication pointer advanced atomically
```

```text
failed publication
⇒ no partially published World becomes visible
```

并且：

- 新增普通世界语义内容不需要新增 core domain schema；
- 程序必须理解的 control state 仍严格验证；
- 可以从持久状态重建核心 read model；
- 不依赖 promptpile-react / MCP 才能验证 World correctness；
- 旧强类型 submission 不再是新 World 的权威入口。

## 14. 与其它两个草案的关系

实施顺序固定为：

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

Phase 2 依赖本阶段稳定的 Session / World identity，但不改变 Published World 语义。

Phase 3 依赖本阶段稳定的 staging/read/publish 能力，把它们暴露为 Dayloom-scoped MCP tools，但不能重新定义 World transaction。

## 15. 最终目标

Phase 1 的核心不是“改文件格式”，而是把 Dayloom 的领域职责重新收敛为：

```text
Dayloom
= safely version a document-native world
+ control staging/publication/recovery

AI runtime
= future consumer of that world
```

当这个边界稳定后，后续 Conversation 与 Agent 改造才不会重复返工。
