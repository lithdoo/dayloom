# Dayloom Session 持久草稿与转换式提交设计

> 状态：FROZEN FOR IMPLEMENTATION (v1)
> 日期：2026-08-25
> 范围：`@dayloom/core` 的 Init / Planning / Play / Revise Session
> 非目标：不修改 Archive V2、World Profile V1、原子发布、Settle 与 abandon 的产品语义
> 规范契约：`doc/contracts/SESSION_SUBMISSION_V1.md`
> 指令追踪：`doc/contracts/SESSION_PROMPT_TRACEABILITY_V1.md`
> 冻结证据：`doc/contracts/SESSION_SUBMISSION_V1_FREEZE_REPORT.md`

本文解释架构动机与端到端设计；精确格式、工具、路径、数值、ID、API、事件和时序以规范契约为准。冻结后，改变依赖、权限、Draft 格式、operation policy、校验权力、资源限制或公开行为必须先显式修订设计与契约。

## 1. 决策摘要

Dayloom 不再要求模型在 submit 的 Final 中一次性输出 SubmissionV2 JSON。四类 Session 统一采用以下模型：

```text
对话期
  用户 <-> 对话 AI
              |
              v
       持久 Draft（Markdown）

提交期
  Draft + pinned World + 转换契约
              |
              v
      转换 AI 写 Candidate Overlay
              |
              v
       Core 合成完整候选 World
              |
              v
   程序校验 -> 有界修复 -> 内容审查
              |
              v
     operation-scoped diff
              |
              v
       Archive V2 原子发布
```

核心决策：

1. Draft 是唯一的会话创作成果，Conversation 只是交互与可压缩历史。
2. Draft 持久化，临时 Session、MCP gateway、Candidate 全部可丢弃重建。
3. Candidate 是本次 operation 的受限 overlay，不是完整 pinned World 的可写副本。
4. Core 将 pinned World 与 overlay 合成完整候选树；未授权路径永远继承 pinned World。
5. 程序校验是唯一发布门槛；AI 内容审查只生成 advisory diagnostics，不修改 Candidate、不阻塞发布，也不提供调用方严格模式。
6. 所有持久 ID 由 Core 根据 Draft 中显式稳定 key 确定性分配。
7. 旧 SubmissionV2 的业务约束完整迁移到 Draft lint、转换契约、Candidate validator 和发布策略；旧 JSON 输出格式不迁移。
8. 四类 Session 走同一条管线，不保留长期双轨实现。

## 2. 不变量

以下规则在重构后保持不变：

- Core 的策略、生命周期、Schema、标识和发布权优先于用户文本、Conversation、摘要、模型输出与工具结果。
- Published World 是已发布事实的唯一权威；Draft 和 Candidate 都是不可信提议。
- AI 只能写 Core 私有 Draft 或 Candidate Overlay，不能直接写 World。
- pinned commit ID、revision 与 root tree hash 在发布前必须再次匹配；冲突时不部分发布。
- Settle 与 abandon 保持无 AI、确定性执行。
- Final 不使用工具，不声称尚未发布的内容已经发布。
- 用户沉默、未反对或发送无关消息不构成确认；模型提议不能升级为用户决定。
- 任何失败都不改变当前 Published World。

## 3. 生命周期与目录模型

### 3.1 持久根与临时根分离

```text
runtimeRoot/
  drafts/
    <draft-id>/
      meta.json
      content/
      diagnostics.json
      archived/
  transient/
    <core-instance-id>/
      sessions/<session-id>/
      candidates/<operation-id>/
      gateways/<runtime-id>/
```

- `runtimeRoot` 是显式 Core 配置；未提供时固定为 `worldRoot/.dayloom-runtime`。
- 一个规范化 `worldRoot` 同时只允许一个 Core writer；锁获取、同主机失效锁回收和异主机失败语义由规范契约固定。
- `dispose()` 只删除当前实例的 `transient/<core-instance-id>`，不删除 Draft。
- Draft 成功发布后生成不可变快照写入 `archived/`，随后清空当前工作 Draft。
- Candidate、转换 Conversation、修复 Conversation 与 gateway 均为临时资源。

### 3.2 Draft 身份

`meta.json` 是 Core 所有的确定性元数据：

```json
{
  "schemaVersion": 1,
  "draftId": "draft_<uuid>",
  "kind": "init | planning | play | revise",
  "worldIdentity": "uninitialized:<resolved-world-root-hash> | <world-id>",
  "baseCommitId": null,
  "baseRootTreeHash": null,
  "targetDay": null,
  "status": "active | submitting | submit-failed | archived",
  "createdAt": "ISO-8601",
  "updatedAt": "ISO-8601"
}
```

同一 World、Session kind 和生命周期目标最多存在一份 active Draft。`startSession(kind)`：

- 有匹配基线的 active Draft：恢复它；
- 没有 Draft：创建并写入骨架；
- Draft 基线已过期：保留旧 Draft 为 `submit-failed`，创建新 Draft，不自动 rebase；
- Init Draft 以规范化 worldRoot 的稳定 hash 标识，发布后绑定新 worldId 并归档。

Conversation 不要求跨进程恢复；恢复后的新 Conversation 以 Draft 当前内容作为权威创作上下文。

## 4. 统一 Session File Runtime

现有 Archive Retrieval Runtime 重构为策略驱动的 Session File Runtime。一个 gateway 可挂载多个独立 filesystem server，工具使用 namespaced 名称，避免多根工具重名：

| Server | 根目录 | 权限 | 用途 |
|---|---|---|---|
| `archive` | pinned `archive-view` | 只读 | 检索已发布事实 |
| `draft` | Draft `content/` | 读写 | 对话期维护草稿 |
| `candidate` | Candidate Overlay | 读写 | 转换与修复 |

工具名固定采用 `mcp__<server>__<tool>`。每个运行阶段只导出所需能力：

- Archive：`list_directory`、`directory_tree`、`search_files`、`search_files_content`、`read_file_lines`。
- Draft：`list_directory`、`read_file_lines`、`write_file`。
- Candidate：`list_directory`、`directory_tree`、`read_file_lines`、`write_file`。

不导出 `edit_file`、`move_file`、压缩包、媒体、目录统计、动态 Roots 或删除工具。四类 AI Session 的 v1 operation 都只需要 put；Revise 的逻辑删除通过重写集合文档表达，物理 Day 删除仍由无 AI 的 abandon 路径拥有。

### 4.1 写能力边界

- server 级根目录隔离和 `ALLOW_WRITE` 是第一道边界；
- gateway 精确 `allowed_tools` 是第二道边界；
- after-hook 校验工具名、参数、调用数、结果闭合和单轮字节上限；
- Core 在每轮后重新扫描 workspace，拒绝符号链接、非普通文件、路径逃逸、非法扩展名、超量文件和超量字节；
- mutation 工具不自动重试；状态不确定时必须读回目标文件；
- Draft 和 Candidate 写入失败只产生明确 ToolResult，不得被模型解释为成功。

### 4.2 ReAct 继续策略

继续执行不再硬编码为“下一次 Archive Retrieval”，而是绑定当前运行阶段的能力集合：

```ts
interface ContinuationPolicy {
  allowedNextTools: readonly string[];
  requireConcreteNextAction: boolean;
  maximumSteps: 10;
}
```

只有 Observe 明确为 `needs-more`，并给出一个具体、未重复、属于当前能力集合的下一工具动作时，Check 才能继续。继续不得用于自由构思、替用户选择、机械扩写或重复确认。

Final 前统一验证所有 ToolCall 都有顺序一致、完整且有界的 ToolResult；写工具还必须通过 workspace 扫描。

## 5. Draft 契约

Draft 是 Markdown 文档，不是自由无结构聊天记录。骨架由 Core 创建，标题不可删除；内容可以为空，空缺代表尚未确定。

所有新实体和 Beat 使用显式稳定 key：

```md
## 角色：林夏
<!-- dayloom:key=lin-xia -->
```

key 只在 Draft 内稳定，不是持久 ID。必须匹配 `[a-z][a-z0-9-]*`，在对应命名空间唯一。Core 不从自然语言猜测实体身份。

### 5.1 Init Draft

`content/world.md`：

- 标题
- Canon：premise、rules、style、userRole
- 初始 World 状态：status、elapsed、variables
- 角色：stable key、profile、关系、status、location key、tags
- 地点：stable key、profile、status、tags、triggers
- Arc：stable key、profile、status、stage
- 初始事实
- 未解决线索
- 故事种子

禁止编造先前日期、计划或历史，禁止推进时间或开始 Day 1。

### 5.2 Planning Draft

`content/day-plan.md`：

- 固定 targetDay
- 当日 intent
- known context
- constraints
- open questions
- max events
- 有序 beats：stable key、intent、priority、dependsOn keys

targetDay、lastSettledDay、Canon 和已结算历史不可修改。Beat 依赖只能指向前序 Beat。

### 5.3 Play Draft

Play 按事件分文件，避免单文档无限增长：

```text
content/
  play.md
  events/
    e001.md
    e002.md
```

`play.md` 记录固定 Day、计划范围和事件顺序。每个事件文件包含：

- 对应 Beat ID 或空
- 标题、地点 ID、参与角色 ID
- 场景、对话、用户动作
- 结果摘要、习得事实、时间推进
- completed/skipped Beat IDs
- endDay
- 提议的状态变更及精确 expected 前置值

只记录用户实际表达的动作；不得替用户行动、选择或接受。

### 5.4 Revise Draft

`content/revisions.md` 按稳定条目记录：

- 修改目标
- 精确当前值或引用路径
- 候选新值
- 修改原因
- 新实体 stable key 与完整定义

禁止修改 Manifest 标识、标题、已结算 Day、审计数据和生命周期 control。

### 5.5 Draft lint

每次 submit 前运行轻量、确定性 lint：

- 必需标题存在；
- stable key 格式与唯一性；
- Draft 内引用闭合；
- Planning 依赖顺序；
- Play 事件文件顺序和重复检查；
- 文件/目录/字节配额；
- UTF-8、普通文件、无符号链接。

lint 不判断内容是否丰富，也不替用户补全创作选择。阻塞项以结构化 diagnostics 返回，Session 保持 `ready`。

## 6. 转换式提交

### 6.1 状态机

```text
ready
  -> submitting
      -> lint
      -> allocate IDs
      -> convert
      -> validate
          -> repair -> validate       （最多 3 轮）
      -> review
      -> diff
      -> publish
  -> success: archive Draft, terminalize Session
  -> failure: preserve Draft + diagnostics, return ready
```

任何修复之后都必须重新运行完整程序校验。修复次数是提交管线总预算，不因重新 submit 而继承；相同错误连续出现两次时提前停止，避免无效循环。

### 6.2 确定性 ID 分配

Core 在转换前解析 stable keys，并基于 pinned IDs 分配下一可用 ID：

- character key -> `characterN`
- location key -> `locationN`
- arc key -> `arcN`
- Planning Beat 顺序 -> `beatN`
- Play 事件顺序 -> `eventN`
- trigger、fact、thread、seed 延续现有各集合分配规则

映射写入 Core-owned `assignment.json`，以只读任务数据提供给转换 AI。转换 AI 只能使用给定映射，不能创建额外持久 ID。

### 6.3 Candidate Overlay

Candidate 只包含本次 operation 允许新增或替换的文件：

```text
candidate/
  files/
    <允许修改的 World 路径>
  task.json          # Core-owned, read-only
```

允许路径由现有 `assertMutationPathAllowedV1` 发展为显式 operation policy：

```ts
interface OperationDocumentPolicy {
  mayPut(path: string): boolean;
  requiredOutputs: readonly string[];
  preservedNamespaces: readonly string[];
}
```

Core 合成候选树时：

1. 从完整 pinned tree 开始；Init 从空树和 Core 生成的 profile descriptor 开始。
2. 应用经过策略校验的 overlay puts。
3. 追加 Core 确定性生成的审计文件。
4. 未授权路径原样继承，绝不因 archive-view 未投影而删除。

### 6.4 转换 AI

转换使用新的单次 Conversation，只接收：

- Core 策略与 Session 类型转换契约；
- Draft 快照；
- assignment.json；
- 只读 pinned archive-view；
- 只读 operation policy 摘要；
- 可写 Candidate Overlay。

转换 AI 的任务是逐文件誊写，不进行新创作：

- Draft 已确认内容必须完整迁移；
- Draft 未确定内容不得自行补全；
- Candidate 不得出现 Draft 与 pinned World 均无来源的新事实；
- 精确当前值、实体 ID 和历史事实必须来自 pinned evidence；
- 长文本写 Markdown，小型状态写 JSON/YAML；
- 完成后 Final 只输出结构化转换摘要，不承载业务数据。

### 6.5 程序校验

校验器面向统一 `DocumentSource`，既可读取 Archive tree/blob，也可读取合成后的普通 Candidate：

```ts
interface DocumentSource {
  list(): Promise<readonly DocumentEntry[]>;
  read(path: string, mediaType: ArchiveMediaTypeV1): Promise<Uint8Array>;
}

interface ValidationIssue {
  code: string;
  path: string | null;
  constraint: string;
  expected?: unknown;
  actual?: unknown;
  repairHint?: string;
}
```

一次校验尽可能收集全部独立问题，结果稳定排序。覆盖：

- World Profile V1 完整结构；
- 路径与媒体类型；
- JSON/YAML schema；
- 索引与实体目录一致性；
- 跨文件引用闭合；
- control 与 Day tree 关系；
- operation 路径权限；
- Planning Beat 依赖；
- Play 计划/事件/补丁引用；
- Revise expected 前置值；
- stable key 到持久 ID 映射完整性；
- Draft 已确认内容的转换覆盖率。

### 6.6 AI 内容审查

程序校验通过后，审查 AI 对照 Draft、pinned evidence 和 Candidate，输出固定结构：

```json
{
  "advisory": [{"code":"...","paths":["..."],"reason":"...","evidence":"..."}]
}
```

审查只检查语义转换质量：遗漏、无来源新增、关系语义矛盾、时间线冲突。它不能修改程序规则，也不能宣布 World 合法。

- 审查输出统一降格为 advisory：记录审计并继续发布。
- 审查不触发 Candidate 修复；只有程序 validator 的 error 可以进入修复循环。
- 审查失败或超时记录 diagnostics；只要程序校验通过，Core 继续发布。

### 6.7 发布

Core 从 validated candidate 与 pinned tree 计算 operation-scoped `WorldChange[]`：

- 只包含实际字节变化；
- 路径按 Archive 规范稳定排序；
- 重复路径、空操作和越权路径失败关闭；
- 发布前再次核对 pinned revision、commit ID 与 root tree hash；
- 通过现有 `publishMutation` 原子安装 blobs、tree、commit、operation 和 current pointer。

Init 的 worldId 由 Core 生成；Manifest title 来自通过校验的 `state/world.yaml`，不由转换 Final 返回。

## 7. 提示词与业务指令完整迁移

提示词仍全部位于 `packages/core/src/session/prompts/` 并单独导出，全部使用中文。迁移不是复制旧文本，而是把每条指令放到唯一正确的责任层。

| 现有指令来源 | 新归属 | 迁移结果 |
|---|---|---|
| `DAYLOOM_AGENT_POLICY` | 对话、转换、修复、审查共同 system policy | 完整保留 |
| `WRITABLE_SUMMARY_AUTHORITY_NOTE` | 对话期 Thought/Final | 完整保留；转换期不读取旧 Conversation |
| Archive namespace guide | 对话与转换的 archive read policy | 完整保留并改为 namespaced 工具 |
| 渐进检索策略 | 通用 File Runtime Thought policy | 完整保留 |
| Init Session role | Init 对话角色 + Init Draft 契约 | 完整迁移 |
| Planning Session role | Planning 对话角色 + Planning Draft 契约 | 完整迁移 |
| Play Session role | Play 对话角色 + Play Draft 契约 | 完整迁移 |
| Revise Session role | Revise 对话角色 + Revise Draft 契约 | 完整迁移 |
| Observe 来源、决定、未解决项规则 | 通用 Observe handoff | 完整保留，并增加 draft/candidate 写入证据 |
| Check 继续门禁 | capability-aware Check | 完整保留，泛化下一工具动作 |
| Final visibility/discipline | 对话可见 Final | 完整保留 |
| InitSubmissionV2 Schema 语义 | Init Draft lint + assignment + Candidate validator | 字段与约束完整迁移，JSON 输出退役 |
| PlanningSubmissionV2 Schema 语义 | Planning Draft lint + Candidate validator | 完整迁移 |
| PlaySubmissionV2 Schema 语义 | Play event Draft + Candidate validator | 完整迁移 |
| ReviseSubmissionV2 operations/expected 语义 | Revise Draft + operation policy + Candidate validator | 完整迁移 |
| submit marker | Core 内部转换任务启动事件 | 不再写入用户 Conversation |
| summary prompt | 对话压缩 | 保留；明确 Draft 才是创作成果权威 |

新提示词模块按责任组织：

```text
session/prompts/
  policy.ts
  archive.ts
  file-runtime.ts
  observe.ts
  check.ts
  final.ts
  draft/
    init.ts
    planning.ts
    play.ts
    revise.ts
  conversion/
    common.ts
    init.ts
    planning.ts
    play.ts
    revise.ts
  repair.ts
  review.ts
  summary.ts
  index.ts
```

旧 submit Final prompt 不做兼容转发；当新路径切换完成后直接删除，避免存在两个事实来源。

## 8. API、事件与失败恢复

### 8.1 状态

公开 Session 状态保持简洁：

- `ready`
- `running`
- `submitting`

提交失败后恢复 `ready`，diagnostics 通过结果和事件提供，不新增永久 `failed` 状态。

### 8.2 结果

`CoreResult` 的失败结果增加可选 diagnostics：

```ts
{
  ok: false,
  error: {
    code: "DRAFT_INVALID | CONVERSION_FAILED | CANDIDATE_INVALID | WORLD_CONFLICT | ...",
    message: string,
    diagnostics?: readonly ValidationIssue[]
  }
}
```

### 8.3 事件

保留现有 `work.*` 与 `output.*`，增加稳定的提交阶段事件：

```ts
submission.stage = lint | allocate | convert | validate | repair | review | publish
submission.diagnostics
```

转换、修复和审查属于 `work.*`，永不投影为用户对话 Final。普通 `send()` 的 Final 仍使用 `output.*`。

### 8.4 失败矩阵

| 失败点 | World | Draft | Candidate | Session |
|---|---|---|---|---|
| Draft 写失败 | 不变 | 保留已有内容 | 无 | ready |
| Draft lint 失败 | 不变 | 保留 | 无 | ready |
| 转换崩溃 | 不变 | 保留 | 删除 | ready |
| 校验/修复达上限 | 不变 | 保留 | 删除 | ready |
| 内容审查异常 | 不变 | 保留 | 按程序校验结果继续或失败 | submitting/ready |
| 用户取消 submit | 不变 | 保留 | 删除 | ready |
| WORLD_CONFLICT | 不变 | 标记基线过期并保留 | 删除 | ready |
| 发布成功 | 新 revision | 归档后清空 active | 删除 | terminal |
| 进程崩溃 | 原子 current 保证 | 持久保留 | 启动时清理 | 可恢复 |

`cancel` 在 `running` 和 `submitting` 均可用。取消只杀死当前子进程并清理 transient 资源，不删除 Draft。

## 9. 审计

发布成功时 Core 确定性写入：

```text
audit/sessions/<session-id>/
  meta.json
  transcript.json
  draft.md 或 draft-index.json + draft files
  assignment.json
  conversion-transcript.json
  validation.json
  review.json
  candidate-diff.json
```

审计不进入 archive-view，不暴露给 AI，不允许出现在 Candidate Overlay。审计构建失败时发布失败关闭，保证每个成功 mutation 都有完整来源记录。

## 10. 资源与安全上限

所有限制由 Core 固定，调用者不能通过 LLM 配置覆盖；精确数值只定义在 `SESSION_FILE_LIMITS` 及规范契约中：

- ReAct：每次 run 最多 10 steps；
- 修复：最多 3 轮；内容审查修复最多 1 轮；
- 单 Thought 工具调用数按阶段固定；
- Draft/Candidate 最大文件数、单文件字节和总字节；
- 只接受 UTF-8 普通文件；拒绝符号链接、设备文件和路径逃逸；
- YAML alias、深度、集合大小和 JSON 深度有界；
- gateway 只绑定随机 token 的 loopback；
- transient 启动时清理同实例孤儿目录，Draft 永不被孤儿清理误删。

`SESSION_FILE_LIMITS` 的 v1 数值已经冻结，提示词只说明行为，不重复数值。

## 11. 一次性迁移顺序

实现按基础设施分阶段合入，但产品路径只切换一次：

1. **契约基线**：本设计、Core Runtime 契约与检索设计修订记录冻结。
2. **DocumentSource 与 validator**：抽离 Profile 校验、结构化 diagnostics、operation policy、候选树合成与安全 diff。
3. **Session File Runtime**：统一多 server gateway、通用 hook、capability-aware ReAct 守卫。
4. **持久 Draft**：四类骨架、stable key、lint、恢复、归档与资源限制。
5. **转换管线**：ID assignment、Candidate Overlay、转换、修复、审查和审计。
6. **全量切换**：Init / Planning / Play / Revise 同时切换到新 submit 管线；Settle / abandon 不变。
7. **退役旧路**：删除 SubmissionV2 parser、四个旧 builder、submit Final JSON prompts、submit marker 及对应测试 fixture。
8. **验收**：完整生命周期、失败恢复、进程恢复、冲突、取消、安全、打包和真实 DeepSeek 示例。

不按 Session 类型长期灰度，避免维护两套提交真相。开发期间可以用内部测试开关对比结果，但发布包只包含新路径。

## 12. 完成定义

只有以下条件全部满足，设计才算落地完成：

1. 四类 Session 对话中持续维护可恢复 Draft。
2. Core 重启后能恢复 Draft，`dispose()` 不删除 Draft。
3. submit Final 不再承载任何业务 JSON。
4. 所有旧 SubmissionV2 字段、引用、前置值和权限约束都有明确的新执行层及测试。
5. Candidate 不能修改 operation policy 外的路径，也不会删除 archive-view 未投影文件。
6. 每次修复后重新运行完整程序校验。
7. 提交失败后 Session 回到 ready，用户能看到结构化 diagnostics 并继续对话或重试。
8. 发布成功仍经 Archive V2 原子 current pointer，冲突不部分发布。
9. Settle 与 abandon 的行为和测试完全不变。
10. 旧 SubmissionV2、旧 submit Final prompt 和旧 builder 从生产代码、导出、文档及测试中全部消失。
11. 所有提示词位于独立目录、中文编写、单独导出，并通过指令迁移矩阵和架构 guard 防止遗漏。
12. 真实示例脚本完成 Init → Planning → Play → Settle → Revise 流程，包含一次校验失败修复和一次进程重启 Draft 恢复。
