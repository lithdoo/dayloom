# Dayloom World Profile V1 草案

> 状态：Draft / 设计讨论稿  
> 日期：2026-08-21  
> 范围：`@dayloom/core2`、Dayloom World application semantics  
> Archive 基线：`@dayloom/archive-protocol` V2  
> 目标：在保留 Archive V2 事务与不可变发布模型的前提下，把 Dayloom 的内容丰富度恢复到早期 filesystem World 水平。

---

## 1. 背景

Dayloom 早期 filesystem World 的核心优势不是存档技术，而是世界语义非常完整：

```text
World
├── canon/          世界设定
├── state/          当前世界状态
├── characters/     人物现态、关系、记忆、timeline
├── scenes/         场景现态、记忆、triggers、timeline
├── arcs/           长期剧情线与进度
├── memory/         短期 / 长期 / 结构化记忆
├── days/           每天发生的事实历史
└── logs/           状态变化与生成追踪
```

早期模型把世界信息分成三层：

1. `days/**`：历史事实，描述“发生过什么”；
2. `state/**`、`characters/**`、`scenes/**`、`arcs/**`：当前现态，描述“世界现在是什么样”；
3. `memory/**`、各实体 `memory.md` / `timeline.md`：从历史派生的压缩理解。

后续 Archive V1/V2 重构显著增强了事务、不可变历史、OCC、恢复与 publication correctness，但 Core2 MVP 的 Dayloom World Profile 被收窄为：

```text
canon/premise.md
canon/rules.md
canon/style.md
canon/user-role.md

days/<day>/plan.json
days/<day>/play.json
days/<day>/summary.md
```

这个 MVP profile 后续随着 Init / Planning / Revise / Settle / TUI 全生命周期接入而成为正式产品路径，但 profile 本身没有同步扩展，导致世界语义容量相比早期 filesystem World 大幅下降。

当前问题包括：

- Init Session 中确认的人物、关系、地点、组织、历史、长期冲突没有正式持久化位置；
- Planning 失去 `known_context`、`constraints`、`open_questions`、beat priority/dependency 等信息；
- Play Event 被压缩为 `userInput + assistantOutput`，缺少 location、participants、time advance、learned facts、state patch 等语义；
- `settle()` 当前基本只推进 control pointer，不执行真正的世界结算；
- 历史 day 即使仍在 Archive tree 中，后续 Session 也很少读取，长期连续性主要依赖最近一次 summary；
- 世界事实可能存在于 Conversation 中，却在 `/submit` 时被极窄 Submission schema 丢失。

这会造成典型的长期模拟“重置感”：事件发生了，但没有成为下一天可持续读取的 World state。

---

## 2. 核心判断

### 2.1 Archive V2 不需要结构性重构

Archive V2 已经能够承载早期 filesystem World 的全部主要内容。

Protocol 当前只需要理解：

```text
WorldDocumentPath
ArchiveMediaType
Blob
RootTree
Commit
Operation
Staging
Current pointer
Integrity / OCC / Recovery
```

Root Tree entry 本质是：

```ts
interface DocumentTreeEntryV1 {
  path: string;
  blobHash: string;
  mediaType: ArchiveMediaTypeV1;
  bytes: number;
}
```

Archive media types 已支持：

```text
text/markdown
text/plain
application/json
application/yaml
```

因此下面这些路径天然可以作为 Archive V2 World documents：

```text
state/*.yaml
characters/**/*.md
characters/**/*.yaml
locations/**/*.md
locations/**/*.yaml
arcs/**/*.md
arcs/**/*.yaml
memory/**/*.md
memory/**/*.yaml
days/**/*.md
days/**/*.json
days/**/*.yaml
```

Archive Protocol 不应该重新引入 Character / Location / Arc / Memory 等业务 DTO。

### 2.2 主要问题位于 Core2 application layer

当前 Core2 `packages/core2/src/world/publish.ts` 使用极窄 `coreOwned` 白名单，只允许修改：

```text
canon/(premise|rules|style|user-role).md
days/dayN/(plan|play).json
days/dayN/summary.md
```

这不是 Archive V2 的限制，而是 Core2 World Profile 的限制。

本草案的基本方向：

> 保留 Archive V2；重建 Dayloom World Profile；让 Core2 生命周期真正生成、读取、修改丰富的 World documents。

---

## 3. 目标

World Profile V1 必须恢复以下产品能力。

### 3.1 丰富的初始化世界

Init 应能正式建立：

- 世界前提与规则；
- 主角 / 用户角色；
- NPC；
- 人物关系；
- 地点 / 场景；
- 组织 / factions；
- 世界当前基础状态；
- 初始剧情线 / 长期冲突；
- 初始已知事实；
- 潜在 story seeds。

这些内容不能只存在于 Init Conversation，也不能被迫全部塞进 `premise.md`。

### 3.2 长期世界连续性

一天结束后，World 必须能够记住：

- 人物状态变化；
- 人物关系变化；
- 地点状态变化；
- 世界变量变化；
- 剧情线阶段变化；
- 新获得的重要事实；
- 未解决线索；
- 长期重要事件；
- 下一天可能继续发展的 seed。

### 3.3 丰富但不强 schema 化

不要重新走 Archive V1 的“所有世界语义都必须变成 TypeScript DTO”路线。

原则：

```text
Core2 必须确定理解的字段
→ structured document / strict schema

主要供 AI / 人理解的语义
→ Markdown / document-native
```

例如：

```text
characters/alice/profile.md
```

可以包含自然语言身份、性格、目标、秘密、口吻等内容，Core2 不需要理解所有结构。

而：

```text
characters/alice/state.yaml
```

如果 Core2 必须知道 `status`、`location` 等字段，则这些字段可以强类型校验。

---

## 4. 非目标

本草案不要求：

- Archive Protocol V3；
- 回退到直接修改 filesystem 的旧存档方式；
- 为 Character / Scene / Arc 建立大型 domain class hierarchy；
- 一次性恢复早期所有实验性文件；
- 第一版就实现复杂 semantic search / vector database；
- 第一版就实现自动剧情导演、复杂数值系统或通用 RPG schema。

第一阶段目标是恢复**世界信息容量和跨天连续性**。

---

## 5. World Profile V1 建议布局

建议从早期 filesystem World 的语义模型恢复，但使用 Archive V2 publication。

```text
<Published Root Tree>

canon/
  premise.md
  rules.md
  style.md
  user-role.md

state/
  world.yaml
  calendar.yaml
  progress.yaml
  variables.yaml

characters/
  index.yaml
  <character-id>/
    profile.md
    relationships.md
    state.yaml
    memory.md
    timeline.md

locations/
  index.yaml
  <location-id>/
    profile.md
    state.yaml
    memory.md
    triggers.yaml
    timeline.md

arcs/
  index.yaml
  <arc-id>/
    profile.md
    state.yaml
    timeline.md

memory/
  short-term.md
  long-term.md
  facts.yaml
  unresolved-threads.yaml
  important-events.yaml

story-seeds/
  active.md

days/
  dayN/
    plan.json
    timeline.md

    events/
      eventN/
        event.yaml
        scene.md
        dialogue.md
        user-action.md
        result.yaml
        state-patch.yaml

    summary.md
    diary.md
    settlement.yaml
    next-day-seed.yaml
```

说明：

- `locations/` 作为 V1 正式名称；旧版 `scenes/` 语义可映射到 Location / Scene document；
- `story-seeds/` 可单独存在，也可并入 `memory/unresolved-threads.yaml`，实现时再冻结；
- `timeline.md` 是可派生索引，不应成为唯一历史事实来源；
- `days/**` 仍然是已发生叙事的事实历史；
- entity memory / timeline 应能从 `days/**` 回溯或重算。

---

## 6. Namespace 与 ownership

Archive Protocol 继续只管理合法路径，不理解 Dayloom namespace。

Core2 的 World Profile policy 管理 application namespace：

```text
canon/**
state/**
characters/**
locations/**
arcs/**
memory/**
story-seeds/**
days/**
custom/**
```

Core2 不允许业务 mutation 直接操作 Archive control-plane 路径：

```text
manifest.json
current.json
commits/**
objects/**
operations/**
.locks/**
.dayloom/**
```

不要用当前单个 `coreOwned` 正则继续硬编码每一个最终业务文件。

建议拆分为：

```text
Archive path correctness
        ↓
Dayloom namespace policy
        ↓
operation-specific mutation policy
```

例如：

- Init 可以创建 canon/state/characters/locations/arcs/memory；
- Planning 主要修改当前 day plan 与必要 seed；
- Play 只能追加当前 day event/history scratch 或提交 event result；
- Settle 可以更新现态与 memory，并生成 day ending artifacts；
- Revise 修改低频 World semantic documents，但不能任意改写 settled history。

---

## 7. Media type

Core2 不应再把 `WorldChange.mediaType` 限制成：

```text
application/json | text/markdown
```

应直接对齐 Archive Protocol public media type：

```text
text/markdown
text/plain
application/json
application/yaml
```

建议：

```text
.md    → text/markdown
.yaml  → application/yaml
.json  → application/json
.txt   → text/plain
```

JSONL 如继续需要，可第一阶段以 `text/plain` 保存；未来若确实需要 Protocol 对 JSONL 每行做语法校验，再考虑增加 `application/x-ndjson`，不是本草案的 blocker。

---

## 8. Init Session V1

### 8.1 当前问题

当前 Init `/submit` 只允许：

```json
{
  "version": 1,
  "title": "...",
  "canon": {
    "premise": "...",
    "rules": "...",
    "style": "...",
    "userRole": "..."
  }
}
```

这会形成严重的信息漏斗：Conversation 中建立的角色、关系、地点、组织和 story seeds 没有正式位置进入 Published World。

### 8.2 目标模型

Init 应是 World authoring session，而不是剧情模拟。

建议 lifecycle：

```text
Start Init
   ↓
Conversation + authoring interaction
   ↓
形成 staged candidate World documents
   ↓
用户继续修改 / 补充 / 检查
   ↓
/submit
   ↓
Core2 deterministic validation
   ↓
Archive V2 atomic publication
```

关键点：

> `/submit` 不应该再次把整个世界压缩成一个小 JSON；它应该发布已经形成的 candidate World documents。

### 8.3 Init phase boundary

Init prompt 必须明确：

- 当前是 AUTHORING ROOM；
- 不推进 world time；
- 不进入 Day 1；
- 不把候选剧情写成已经发生的事件；
- 不进行 NPC in-world roleplay；
- examples / proposals 默认是设计候选，不是历史事实；
- 只有用户显式 `/submit` 才结束 Init；
- AI 不能因为“设定已经差不多”而自动进入故事。

---

## 9. Planning Session V1

恢复早期 DailyPlan 中有长期价值的语义。

建议计划至少包含：

```ts
interface DayPlanV1 {
  intent: string;
  knownContext: string[];
  constraints: string[];
  openQuestions: string[];
  beats: Array<{
    id: string;
    intent: string;
    priority: 'required' | 'optional';
    dependsOn: string[];
  }>;
  maxEvents: number;
}
```

是否完全采用上述 JSON schema 可后续调整，但以下能力不能再次丢失：

- 已知上下文；
- 约束；
- 未决问题；
- beat priority；
- beat dependency；
- 当天事件预算。

Planning context 不应该只包含四个 canon + 上一天 summary，还应能读取：

- relevant current state；
- relevant characters；
- relevant relationships；
- active arcs；
- unresolved threads；
- recent memory。

---

## 10. Play Session V1

### 10.1 Event 重新成为世界事件

当前 Core2 event 主要保存：

```text
id
beatId
userInput
assistantOutput
```

目标应恢复事件作为状态变化最小来源的语义。

建议 event 至少能够表达：

```text
identity
source beat
title
location
participants
time / time advancement
situation
user action
outcome
learned facts
consequences
state changes
```

不要求全部塞进一个大型 JSON。

推荐 document-native：

```text
days/dayN/events/eventN/
  event.yaml
  scene.md
  dialogue.md
  user-action.md
  result.yaml
  state-patch.yaml
```

### 10.2 Play context

Play 不应只读取：

```text
canon + current plan
```

应构造相关上下文：

```text
current world state
relevant characters
relevant relationships
relevant locations
active arcs
recent memory
unresolved threads
current day plan
recent day history when needed
```

第一阶段不要求 semantic vector search，可以先使用确定规则：

- plan 中直接提到的实体；
- active / nearby entities；
- active arcs；
- short-term memory；
- unresolved threads；
- last N summaries。

---

## 11. Settlement V1

### 11.1 当前问题

当前 Core2 `settle()` 基本执行：

```text
changes = []
awaiting-settle → idle
lastSettledDay = current day
```

这不是完整的 Dayloom 世界结算，只是 control transition。

### 11.2 Settlement 应重新承担长期状态沉淀

目标：

```text
current day events
+ current World state
+ active characters / locations / arcs
+ memory
        ↓
Settlement
        ↓
产生 day artifacts
        +
产生 World state mutations
        ↓
Archive V2 atomic publication
```

至少生成：

```text
days/dayN/summary.md
days/dayN/diary.md
days/dayN/settlement.yaml
days/dayN/next-day-seed.yaml
```

并根据当天事实更新：

```text
state/**
characters/**
locations/**
arcs/**
memory/**
story-seeds/**
```

典型变化：

- 人物关系改变；
- 人物状态 / 目标改变；
- 地点状态改变；
- 世界变量改变；
- arc stage / progress 改变；
- 新的结构化事实；
- 新的 unresolved thread；
- 长期重要事件；
- next-day seeds。

原则：

> 今天发生的事实必须能够改变明天模型读取到的 World。

---

## 12. Memory 模型

Memory 不是新的事实来源，而是对 `days/**` 历史的派生理解。

建议：

```text
memory/short-term.md
  最近数日高密度连续性信息

memory/long-term.md
  稳定长期关系、重要经历、重复模式

memory/facts.yaml
  可稳定引用的结构化事实

memory/unresolved-threads.yaml
  尚未解决的线索 / 承诺 / 冲突

memory/important-events.yaml
  值得长期保留的历史事件索引
```

Entity memory：

```text
characters/<id>/memory.md
locations/<id>/memory.md
```

应尽量能从 day history 重算或修正。

不能让 Memory summary 成为覆盖原始历史的唯一事实来源。

---

## 13. Revise Session V1

Revise 不应继续只替换四个 canon 文档。

Revise 应支持受控修改：

```text
canon/**
state/**            # 仅当明确修改世界当前状态
characters/**
locations/**
arcs/**
memory/**           # 需要谨慎，通常优先重算
custom/**
```

但默认禁止无痕改写：

```text
settled days/**
用户原始 input artifacts
已发布事件历史
```

如果确实需要 retcon，应设计明确的 revision / correction 语义，而不是普通 revise 静默覆盖历史。

---

## 14. Conversation 与 Published World 的边界

World Profile V1 必须同时解决已有 Conversation 污染问题。

权威 Conversation 应只包含：

```text
User
Visible Assistant
User
Visible Assistant
```

React 内部：

```text
Thought
Observe
Check
```

必须属于 ephemeral scratch / internal reasoning，不得永久混入 authoritative Conversation。

另外必须建立清晰的信息流：

```text
Conversation
    ↓
明确形成 candidate World changes
    ↓
validated staging
    ↓
Published World
```

不能再出现：

```text
Conversation 中已经确认大量事实
    ↓
/submit 时被压成极小 JSON
    ↓
大量事实永久消失
```

---

## 15. Archive V2 是否需要修改

### 15.1 本草案结论

恢复到早期 filesystem World 的内容丰富度，**不需要 Archive V2 结构性修改**。

Archive V2 已提供：

- generic document path；
- Markdown / text / JSON / YAML；
- immutable blob；
- content-addressed root tree；
- immutable commit；
- staging algebra；
- atomic publication；
- OCC；
- integrity validation；
- recovery semantics。

这些已经足以承载丰富 World Profile。

### 15.2 可能的非阻塞增强

未来可考虑：

- `application/x-ndjson` media type；
- 更方便的 generic document diff / inspection API；
- staging helper ergonomics。

但这些都不是恢复内容丰富度的前置条件。

不要因为 World Profile 扩展而启动 Archive V3。

---

## 16. 实施顺序

### P0 — 冻结 World Profile V1

在写实现前先冻结：

- namespace；
- history / current state / derived memory 三层语义；
- 哪些文档是 authoritative；
- 哪些文档可派生；
- operation mutation policy；
- Core2 必须强类型理解的最小字段集。

### P1 — Core2 publication 解锁 generic World documents

修改：

```text
packages/core2/src/world/publish.ts
```

目标：

- 删除当前极窄 `coreOwned` file whitelist；
- 引入 Dayloom namespace + operation policy；
- `WorldChange.mediaType` 对齐 Archive Protocol；
- 保持所有 Archive V2 publication safety。

### P2 — Init rich staging

让 Init 真正生成完整初始 World，而不是最终只提交四个 canon 字符串。

同时修复 Init authoring / simulation phase boundary。

### P3 — World read model / context builder

新增读取：

- state；
- characters；
- locations；
- arcs；
- memory；
- recent history。

不要让每个 Session 默认把整个 World 全量塞进 prompt；需要相关性 selection policy。

### P4 — Rich Planning / Play Event

恢复计划约束与 event consequences。

### P5 — Real Settlement

恢复日记、状态补丁、实体变化、memory、unresolved threads、next-day seeds。

### P6 — Revise

让 Revise 能编辑完整 World Profile，同时保护 settled history。

### P7 — Migration / regression

- 从当前 Core2 tiny profile 读取旧 World；
- 缺失 rich documents 时使用空 profile / lazy initialization；
- 不要求 Archive V2 format migration；
- 增加 10+ days 连续性测试。

---

## 17. 验收标准

World Profile V1 不能只用“测试通过”验收，应增加内容连续性标准。

### Init

初始化一个包含：

- 3 个角色；
- 角色间关系；
- 2 个地点；
- 2 条长期剧情线；
- 5 个已知事实；
- 3 个 story seeds；

的 World，submit 后重新打开 Core，信息仍完整存在且可被 Planning/Play 使用。

### Day continuity

连续推进至少 10 天后：

- 角色关系不会无理由重置；
- 已知事实不会频繁遗忘；
- 地点历史会影响后续互动；
- arc progress 会跨天延续；
- unresolved thread 能在后续重新出现；
- previous consequences 会进入下一天 context；
- day history 仍可完整追溯。

### Publication correctness

恢复丰富度不能破坏 Archive V2 的：

- immutable published objects；
- atomic `current.json` visibility switch；
- OCC；
- crash safety；
- path safety；
- hash validation。

---

## 18. 相关历史与源码

早期 filesystem World：

```text
packages/core-old/README.md
packages/core-old/prompts/spec.md
packages/core-old/src/init/scaffold.ts
packages/core-old/src/init/types.ts
packages/core-old/src/init/project-payload.ts
packages/core-old/src/daily/types.ts
packages/core-old/src/play/types.ts
packages/core-old/src/settle/types.ts
packages/core-old/src/settle/project.ts
```

Archive V1 / V2 历史：

```text
doc/reference/ARCHIVE_FORMAT.md
packages/core/src/archive/
packages/core/src/archive-v2/
packages/archive-protocol/src/
```

关键历史提交：

```text
c84c658 Implement Archive Protocol V2 runtime
b2b2bd8 docs: freeze core2 implementation contract
3ba95d4 feat: implement core2 play runtime
40a3bc4 complete core2 product lifecycle
```

当前 Core2：

```text
packages/core2/src/world/read.ts
packages/core2/src/world/publish.ts
packages/core2/src/session/submission.ts
packages/core2/src/session/lifecycle.ts
packages/core2/src/session/play.ts
packages/core2/src/core.ts
```

---

## 19. 最终原则

本轮重构目标不是“回到旧实现”，而是组合两代架构的优点：

```text
早期 filesystem World
  → 丰富、可读、长期连续的世界语义

Archive V2
  → immutable history、atomic publication、OCC、integrity、recovery

Core2
  → Session lifecycle、Promptpile integration、typed application boundary
```

目标架构：

```text
              Dayloom World Profile V1
        rich document-native world semantics
                       │
                       ▼
                    Core2
          Init / Plan / Play / Settle / Revise
                       │
                       ▼
               Archive Protocol V2
          blob / tree / commit / staging / OCC
```

核心原则：

> Archive V2 负责“可靠保存世界”；World Profile 负责“世界应该包含什么”；Core2 负责“世界如何随用户与时间变化”。

以及：

> 今天发生的事实，必须能够成为明天模型读取到的世界状态。
