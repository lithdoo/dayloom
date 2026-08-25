# Dayloom Session 草稿文档与转换式提交设计草案

> 状态：Draft / 待评审
> 日期：2026-08-25
> 实施范围：`@dayloom/core` Session 运行时、提交管线、Promptpile MCP 集成、World Profile V1 校验
> 非目标：不修改 Archive V2 协议与原子发布语义；Settle 与 abandon 保持无 AI
> 关联：修订 `SESSION_ARCHIVE_RETRIEVAL_MCP_DRAFT.md` §16 中「可写 MCP / 候选文件编辑排除出 v1」的决定；吸收 `deprecated-drafts/` 中 Session Patch 三稿的可写 MCP 机制

## 1. 背景与问题

当前架构存在一个读写不对称：

- **读侧**为 AI 优化：存档以目录层次 + 大量纯文本文件（markdown 散文、小型 yaml 状态）表达，经 pinned `archive-view` 与五个只读检索工具暴露给模型，完全避开了结构化解析。
- **写侧**却要求 AI 在 submit 的 Final 阶段**一次性输出完整的 SubmissionV2 JSON 对象**（`packages/core/src/session/submission-v2.ts`）：Init 要把整个世界（canon 散文、全部角色 profile、关系网、地点、Arc、事实、线索、种子）嵌进一个 JSON 的字符串字段；Play 要把全天事件的 scene/dialogue 长文嵌进 JSON 字符串。

失败被以下机制放大为灾难：

1. `parseJson` 是裸 `JSON.parse`，无围栏剥离与修复；`exact()` 要求键集合精确匹配；另有大量语义约束（唯一性、依赖顺序、引用闭合、pinned world ID 交叉校验）。
2. Final 阶段无工具，AI 没有任何机会在提交前预检自己的 JSON。
3. `submit()` 解析失败抛 `SUBMISSION_INVALID` 后，catch 分支执行 `terminalize(session)`（`packages/core/src/core.ts`），递归删除会话根（含 Conversation 目录）。**用户与 AI 多轮收敛的成果因一个转义错误全部丢失，且无重试。**

唯一保住的是 Archive V2 原子性：失败不污染已发布 World。本草案的目标是在保持该保证的前提下，消除一次性大 JSON 生成，并把失败从「灾难性」降为「可恢复的局部问题」。

## 2. 总体方案

```text
对话期（send 循环）
  用户 <-> AI 对话
        |
        v
  AI 通过可写 MCP 增量维护草稿 markdown（draft workspace）
        |
        | 用户显式 submit
        v
提交期（转换管线，新建独立 AI 会话）
  转换 AI：读草稿 + 只读 pinned archive-view
        |
        v
  逐文件写候选存档（candidate workspace，可写 MCP）
        |
        v
  程序干跑校验（Profile V1 + 格式 + 引用闭合）——阻塞性门槛
        |         \
        | 通过      \ 错误清单
        v            v
  AI 一致性审查    修复 AI（有界循环，每轮修复后重跑程序校验）
        |
        v
  Core diff(candidate, pinned) -> WorldChange[] -> publishMutation 原子发布
```

三个关键转变：

1. **内容积累从「会话记忆」变为「持久草稿文档」**。AI 在自己擅长的形态（markdown 散文、小步编辑）里工作，每次编辑失败只损失一次编辑。
2. **提交从「一次 LLM 调用」变为「干净上下文的转换会话」**。转换 AI 只读草稿与 pinned 视图，天然规避会话漂移污染（见 `REACT_THOUGHT_FINAL_DRIFT_PROBLEM_REPORT.md`）；任务从「凭记忆一次性成型大 JSON」变为「照源文档逐文件誊写」，每个文件小、失败可定位。
3. **校验从「一锤定音」变为「双重验证 + 有界修复」**。程序校验权威且阻塞；AI 审查内容矛盾作为附加层；错误清单回喂修复 AI，而不是销毁会话。

## 3. 设计原则（约束实现的不变量）

1. **程序校验保持权威**。发布门槛只由程序校验（Profile V1 schema、跨文档引用、索引一致性、路径 allowlist）决定。AI 一致性审查是尽力而为的附加层，其输出只能生成修复建议，不能替代或绕过程序校验。
2. **每次 AI 修复后必须重跑完整程序校验**。修复本身可能引入新的格式错误。
3. **AI 永远只写候选空间**。草稿 workspace 与 candidate workspace 都是 Session/提交管线私有目录；真实存档只经 Core 的 staging → candidate tree → 原子替换 `current.json` 路径写入。「Session 不拥有 World transition 权」不变量原样保留。
4. **pinned base 冲突检查照旧**。转换管线以打开会话时固定的 `PublishedWorld` 为基线；发布时基线变更即冲突，不部分发布。
5. **失败保留草稿**。转换/修复达到上限失败时：不发布、保留草稿与错误清单、会话可回到对话期继续完善或再次提交。`terminalize` 不再在提交失败路径上删除草稿。
6. **修复循环有硬上限**（建议 3 轮），上限外按失败处理并完整呈现错误清单。
7. **Settle 与 abandon 保持确定性 Core 行为**，不接入草稿、转换或任何 AI/MCP 面。

## 4. 对话期：草稿文档

### 4.1 形态与位置

- 每个对话型 Session（init / planning / play / revise）拥有一个草稿目录 `draft/`，核心是一个或少量 markdown 文档（如 `draft/world.md`、`draft/day-plan.md`、`draft/day-events.md`、`draft/revisions.md`）。
- 草稿目录**不在**随会话销毁的临时区，而在 runtimeRoot 下按 world + session kind 持久化，提交成功后归档或清理，失败后保留。
- 草稿不是存档的一部分，不参与 Profile V1 校验；它是 AI authoring 面向的自由文本，只约束顶层章节骨架（见 4.3）。

### 4.2 可写 MCP

- 复用现有 `promptpile-mcp` 网关（`packages/core/src/promptpile/archive-retrieval.ts`），按已弃用 Patch 草稿验证过的双 server 拓扑挂载：
  - `archive_fs`：现有只读 `rust-mcp-filesystem`，根 = pinned `archive-view`（Init 无此 server，与现状一致）；
  - `draft_fs`：可写 `rust-mcp-filesystem`，根 = 草稿目录（放开 `ALLOW_WRITE`）。
- 草稿写工具仅在 Thought 阶段可用（与现有检索工具同一策略面）；Final 仍无工具。
- 每轮 send 中，AI 以小步编辑（读取-修改-写回）维护草稿；提示词要求「先读后写、按节编辑、不整篇重写」。

### 4.3 草稿骨架（按 Session 类型）

草稿骨架是提示词约定 + 转换 AI 的阅读指南，不是程序 schema：

- **Init**：标题 / Canon（premise、rules、style、userRole）/ 初始世界状态与变量 / 角色（含关系）/ 地点（含触发器）/ Arc / 初始事实 / 未解决线索 / 故事种子。
- **Planning**：当日意图 / 已知上下文 / 约束 / 开放问题 / beats（含优先级与依赖）。
- **Play**：按时间顺序的事件记述（场景、对话、用户行动、结果、习得事实、时间推进、beat 完成情况、提议的状态变更）。
- **Revise**：变更清单（改什么、从什么改成什么、为什么）。

## 5. 提交期：转换管线

### 5.1 转换会话

- `submit()` 不再复用对话 Conversation，而是新建一次性转换会话，输入仅为：草稿文档、pinned archive-view（只读）、Session 类型对应的转换契约提示词。
- 转换 AI 通过可写 MCP 在 **candidate workspace** 逐文件产出候选存档（markdown 散文文件 + 小型 yaml），目录结构即 World Profile V1 布局。candidate workspace 初始化为 pinned 视图的可写副本（Init 为空目录 + `profile/dayloom.json` 由 Core 预置）。
- 单文件 yaml 只有几行到几十行，结构化生成风险被切小且可定位；长散文落在 markdown 里，不再经受 JSON 转义。

### 5.2 程序干跑校验

- 从 `publishMutation` 中抽取 Profile V1 校验为可独立调用的 **dry-run validator**：输入 candidate workspace，输出机器可读错误清单（文件路径、约束名、期望/实际、修复提示）。
- 校验范围：文件路径 allowlist 与命名约定、yaml schema、索引文件与实体目录一致性、跨文档引用闭合（角色/地点/Arc/beat ID）、Play 对 planned beats 的引用、Revise 的 expected 前置值。
- 校验通过是发布的必要条件。

### 5.3 AI 一致性审查与修复循环

- 程序校验通过后，审查 AI（干净上下文）对照草稿与候选读一遍，输出内容矛盾清单（如：关系不对称、时间线冲突、草稿有而候选漏、候选私自新增）。
- 程序错误清单与 AI 审查清单统一喂给修复 AI，在 candidate workspace 上做定点修复；每轮修复后重跑 5.2。
- 循环上限 3 轮。审查 AI 结论为空或仅剩「建议级」条目时进入发布。

### 5.4 发布

- Core 对比 candidate workspace 与 pinned 视图，直接算出 `WorldChange[]`（write/delete per file），走现有 `mutationPublisher` 原子发布，control 语义（phase / day / lastSettledDay）与现行各 Session 类型一致。
- 现有 `buildInitMutationV1` 等 JSON→文件扇出 builder 在此路径退役；SubmissionV2 解析器随之退役（保留至旧路径完全下线）。
- 审计（`buildSessionAuditV1`）改为记录：草稿快照、转换会话 transcript、校验/修复轮次与错误清单。

### 5.5 ID 分配

持久化 ID（`character1`、`location2`、`day_0001` 等）的分配规则二选一，实施前定案：

- **方案 A（推荐）**：Core 在转换会话开始前，对草稿中新实体做一次确定性预分配，写入转换任务说明；转换 AI 只使用给定 ID。
- **方案 B**：转换 AI 按现有命名约定自行起名，dry-run validator 校验唯一性与格式。

方案 A 保持「所有持久化标识由 Core 生成”的现行原则，识别新实体的代价是转换前多一次轻量 AI 或规则解析。

## 6. 失败模式与恢复

| 失败点 | 行为 |
|---|---|
| 对话期草稿编辑失败 | 单次工具失败经现有 hook 转为 ToolResult 证据，会话继续；不损失草稿已有内容 |
| 转换会话崩溃 | 保留草稿，candidate 丢弃，可重新 submit |
| 程序校验修复循环达上限 | 不发布，保留草稿 + 错误清单，回到对话期或再次 submit |
| 发布时 pinned base 冲突 | 现行 `WORLD_CONFLICT` 语义不变，草稿保留 |
| 进程崩溃 | 已发布 World 不变（原子性）；草稿在持久化目录中幸存 |

任何失败都不再触发「删除会话根 + 丢失全部成果」。

## 7. 与现有契约/冻结设计的关系

1. `SESSION_ARCHIVE_RETRIEVAL_MCP_DRAFT.md` §16 将「可写 MCP / 候选文件编辑」排除出 v1；本草案是对该决定的显式设计修订（该稿自身规定此类变更须显式修订而非临时实现决定）。只读检索的全部冻结语义（pinned 视角、五工具契约、hook/闭环、Final 守卫）不变。
2. `doc/contracts/CORE_RUNTIME_V1.md` 需修订：submit 语义（转换管线替代一次性 Final JSON）、失败不销毁会话、草稿生命周期。
3. `doc/contracts/WORLD_PROFILE_V1.md` 不变；candidate 产物必须完全符合其现行布局与约束。
4. `deprecated-drafts/` 三份 Session Patch 草稿的可写 MCP 与「submit 扫盘」机制被本草案吸收；差异在于本草案的对话期产物是自由 markdown 草稿而非结构化 patch 文件，提交期由转换 AI 而非纯程序 freezer 完成结构化。

## 8. 开放问题

1. 草稿骨架是否需要最低限度的程序 lint（如「必需章节存在」），以便转换前尽早失败。
2. Play 长跑一整天后草稿体量控制：是否按事件分文件（`draft/events/e01.md` …）。
3. 审查 AI 的「建议级 / 阻塞级」矛盾分级标准。
4. 旧 SubmissionV2 路径的下线节奏：直接切换还是按 Session 类型灰度（Init 先行，Play 最后）。
5. 转换会话与修复循环的 token/时延预算及可观测性（事件投影到 `work.*`）。

## 9. 分阶段落地顺序

1. **契约修订**：更新 `CORE_RUNTIME_V1.md` 与冻结检索稿的修订记录。
2. **dry-run validator 抽取**：从 `publishMutation`/Profile V1 校验中抽出独立校验器并输出结构化错误清单（纯重构，可先行合入）。
3. **对话期草稿**：双 server 网关（`draft_fs` 可写）、草稿持久化目录、Thought 提示词与骨架约定。
4. **转换管线**：转换会话、candidate workspace、修复循环、diff→`WorldChange[]` 发布、失败保留语义。
5. **切换与退役**：按 Session 类型切换到新提交路径，退役 SubmissionV2 一次性 JSON 路径与对应 builder。
