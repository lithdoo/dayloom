# Session Draft and Submission V1

**状态**：冻结实施契约  
**最后核对**：2026-08-25  
**适用范围**：Init、Planning、Play、Revise Session  
**依赖**：Archive V2、World Profile V1、Promptpile React Process Pile v1

本文是 `SESSION_MARKDOWN_DRAFT_SUBMIT_DESIGN_DRAFT.md` 的规范性执行契约。设计说明负责解释原因；本文件中的 MUST、MUST NOT、精确表格、类型和数值决定实现行为。二者冲突时，本文件优先。

## 1. 固定组件边界

生产实现只允许以下组件拥有相应责任：

| 组件 | 唯一责任 | 禁止责任 |
|---|---|---|
| `DraftStore` | Draft 创建、锁、原子保存、恢复、lint、归档 | 不调用模型、不读取或发布 World |
| `SessionFileRuntime` | 启动多 server gateway、导出工具、执行 hook、验证工具闭合 | 不理解 Session 业务、不发布 World |
| `SubmissionPipeline` | 编排 lint、assignment、convert、validate、repair、review、diff、publish | 不直接解析 Promptpile 私有 Artifact |
| `CandidateAssembler` | 将 pinned tree 与 overlay put 合成候选文档源并计算 diff | 不调用模型、不写 current pointer |
| `CandidateValidator` | 返回稳定排序的结构化 diagnostics | 不修复、不发布 |
| `MutationPublisher` | 对已验证 `WorldChange[]` 执行 Archive V2 原子发布 | 不读取 Draft、不调用模型 |

`core.ts` 只拥有公开状态机、能力计算、组件编排和事件线性化。

## 2. 目录、身份与单写者

### 2.1 根目录

公开创建参数固定为：

```ts
interface CreateDayloomCoreOptions {
  worldRoot: string;
  llmConfigPath: string;
  runtimeRoot?: string;
}
```

- `worldRoot`、`llmConfigPath`、`runtimeRoot` 全部在初始化时解析为绝对路径。
- 未提供 `runtimeRoot` 时固定使用 `<worldRoot>/.dayloom-runtime`。
- `runtimeRoot/drafts` 持久；`runtimeRoot/transient/<instance-id>` 临时。
- `dispose()` MUST 删除当前 instance transient，MUST NOT 删除 `drafts`。

### 2.2 单写者锁

- 一个规范化 `worldRoot` 同时只允许一个 Dayloom Core writer。
- 锁路径固定为 `<runtimeRoot>/world.lock`，以 `wx` 创建。
- 锁内容精确为 `{schemaVersion:1, instanceId, pid, hostname, createdAt}`。
- 同主机且 PID 存活时，第二个实例初始化失败为 `WORLD_BUSY`。
- 同主机且 PID 不存活时，Core 将旧锁原子改名到 `transient/stale-locks/<timestamp>-<instance-id>.json` 后重试一次。
- 主机名不同的锁不自动回收，初始化失败为 `WORLD_BUSY`。
- 正常 `dispose()` 在所有子进程和当前 operation settled 后删除自己的锁。

### 2.3 Draft 唯一性

Draft identity key 固定为：

```text
<world-identity>/<kind>/<target>
```

- 未初始化 World：`world-identity = sha256(normalized worldRoot)`。
- 已发布 World：`world-identity = manifest.worldId`。
- Init/Revise 的 `target = global`。
- Planning/Play 的 `target = targetDay`。
- 每个 identity key 最多一个 active Draft。
- startSession 恢复 base commit ID 和 root tree hash 均匹配的 Draft。
- 基线不匹配的 Draft 原子移动到 `drafts/stale/<draft-id>`，不自动 rebase。

## 3. Draft Format V1

每个 Draft 的固定布局：

```text
<draft-id>/
  meta.json                 # Core 独占写
  draft.yaml                # 小型结构、顺序、引用和确认状态
  content/                  # Markdown 长文本
  diagnostics.json          # Core 独占写
  archive/                  # 成功发布后的只读快照
```

### 3.1 通用规则

- `meta.json` 和 `diagnostics.json` 不向模型开放写权限。
- `draft.yaml` 与 `content/**/*.md` 可由 Draft server 写。
- 所有文件必须为 UTF-8 普通文件且不得为符号链接。
- YAML 禁止 alias、自定义 tag、重复 key 和非有限 number。
- `draft.yaml.schemaVersion` 必须为 `1`，`kind` 必须等于 Session kind。
- 所有集合顺序具有业务意义；Core 不按字典序重排。
- stable key 必须匹配 `^[a-z][a-z0-9-]{0,63}$` 并在同类集合唯一。
- 每个可独立确认的节点拥有 `decision`，只能为 `confirmed` 或 `proposed`。
- `confirmed` 只能用于用户明确提供或明确确认的值；模型生成但未确认的内容必须为 `proposed`。
- 转换只持久化 `confirmed` 内容；`proposed` 内容写入 diagnostics，不进入 Candidate。
- Core 不从 Markdown 标题或自然语言猜测 stable key、引用或确认状态。

通用节点类型固定为：

```ts
type DraftDecision = 'confirmed' | 'proposed';
type DraftValue<T> = { decision: DraftDecision; value: T };
type DraftText = { decision: DraftDecision; path: string };
```

一个 entity、Beat、Event 或 Revise operation 是最小确认单元，其内部不能混用不同 decision。尚未整体确认的节点必须保持 proposed。

### 3.2 长文本引用

`draft.yaml` 中的 Markdown 引用统一为相对 `content/` 的 POSIX 路径：

```yaml
premise:
  decision: confirmed
  path: canon/premise.md
```

引用路径必须以 `.md` 结尾，解析后必须留在 `content/`，并且只能被一个语义字段拥有。Markdown 文件可以为空，除非对应 World Profile 字段要求非空。

### 3.3 Session 类型

Init `draft.yaml` 必须精确包含：

```text
schemaVersion, kind, title, canon, worldState,
characters, locations, arcs, initialFacts, unresolvedThreads, storySeeds
```

- `canon` 精确包含 premise/rules/style/userRole Markdown 引用。
- character 精确包含 key/profile/relationships/status/locationKey/tags。
- location 精确包含 key/profile/status/tags/triggers。
- arc 精确包含 key/profile/status/stage。
- relationship 使用 character stable key；locationKey 使用 location stable key。

对应类型固定为：

```ts
interface InitDraftV1 {
  schemaVersion: 1; kind: 'init';
  title: DraftValue<string>;
  canon: { premise: DraftText; rules: DraftText; style: DraftText; userRole: DraftText };
  worldState: DraftValue<{ status: string; elapsed: string | null; variables: Record<string, string | number | boolean | null> }>;
  characters: Array<{ decision: DraftDecision; key: string; profile: string; relationships: Array<{ characterKey: string; relation: string; status: string }>; status: string; locationKey: string | null; tags: string[] }>;
  locations: Array<{ decision: DraftDecision; key: string; profile: string; status: string; tags: string[]; triggers: Array<{ condition: string; effect: string }> }>;
  arcs: Array<{ decision: DraftDecision; key: string; profile: string; status: 'inactive' | 'active'; stage: string }>;
  initialFacts: Array<{ decision: DraftDecision; text: string }>;
  unresolvedThreads: Array<{ decision: DraftDecision; text: string }>;
  storySeeds: Array<{ decision: DraftDecision; text: string }>;
}
```

`profile` 字段是相对 `content/` 的 Markdown 路径，不是内嵌长文本。

Planning 必须精确包含：

```text
schemaVersion, kind, targetDay, intent, knownContext,
constraints, openQuestions, maxEvents, beats
```

- beat 精确包含 key/intent/priority/dependsOn。
- priority 只能为 `required | optional`。
- dependsOn 只能引用当前 beat 之前出现的 key。

对应类型固定为：

```ts
interface PlanningDraftV1 {
  schemaVersion: 1; kind: 'planning'; targetDay: string;
  intent: DraftValue<string>;
  knownContext: DraftValue<string[]>;
  constraints: DraftValue<string[]>;
  openQuestions: DraftValue<string[]>;
  maxEvents: DraftValue<number>;
  beats: Array<{ decision: DraftDecision; key: string; intent: string; priority: 'required' | 'optional'; dependsOn: string[] }>;
}
```

Play 固定布局：

```text
draft.yaml
content/events/e001/{scene,dialogue,user-action}.md
content/events/e002/{scene,dialogue,user-action}.md
```

`draft.yaml` 精确包含 schemaVersion/kind/targetDay/events；event 精确包含 key/beatId/title/locationId/participantIds/scene/dialogue/userAction/result/proposedPatch。事件 key 必须依次为 `e001`、`e002`，不得跳号。用户未明确表达的动作不得进入 userAction。

对应类型固定为：

```ts
type DraftDomainPatchV1 =
  | { op: 'set-world-variable'; key: string; expected: string | number | boolean | null; value: string | number | boolean | null }
  | { op: 'set-character-status'; characterId: string; expected: string; value: string }
  | { op: 'move-character'; characterId: string; expectedLocationId: string | null; locationId: string | null }
  | { op: 'set-location-status'; locationId: string; expected: string; value: string }
  | { op: 'set-arc-stage'; arcId: string; expected: string; value: string };

interface PlayDraftV1 {
  schemaVersion: 1; kind: 'play'; targetDay: string;
  events: Array<{
    decision: DraftDecision; key: string; beatId: string | null; title: string;
    locationId: string | null; participantIds: string[];
    scene: string; dialogue: string; userAction: string;
    result: { summary: string; learnedFacts: string[]; timeAdvanced: string | null; completedBeatIds: string[]; skippedBeatIds: string[]; endDay: boolean };
    proposedPatch: DraftDomainPatchV1[];
  }>;
}
```

`scene`、`dialogue`、`userAction` 是相对 `content/` 的 Markdown 路径。

Revise 必须精确包含 schemaVersion/kind/operations。所有 replace/state 操作必须携带 pinned 精确前置值。新实体使用 stable key，不使用模型自造的持久 ID。

对应类型固定为：

```ts
type ReviseDraftOperationV1 = { decision: DraftDecision } & (
  | { op: 'replace-canon'; field: 'premise' | 'rules' | 'style' | 'userRole'; expected: string; value: string }
  | { op: 'replace-character-profile'; characterId: string; expected: string; value: string }
  | { op: 'replace-location-profile'; locationId: string; expected: string; value: string }
  | { op: 'replace-arc-profile'; arcId: string; expected: string; value: string }
  | { op: 'create-character'; key: string; profile: string; status: string; locationId: string | null; tags: string[]; relationships: Array<{ characterId: string; relation: string; status: string }> }
  | { op: 'create-location'; key: string; profile: string; status: string; tags: string[]; triggers: Array<{ condition: string; effect: string }> }
  | { op: 'create-arc'; key: string; profile: string; status: 'inactive' | 'active'; stage: string }
  | DraftDomainPatchV1
  | { op: 'add-story-seed'; text: string }
  | { op: 'remove-story-seed'; seedId: string; expectedText: string }
);

interface ReviseDraftV1 {
  schemaVersion: 1; kind: 'revise'; operations: ReviseDraftOperationV1[];
}
```

Revise 的 `profile` 和所有 replace operation 的 `value`/`expected` 是相对 `content/` 的 Markdown 路径；validator 读取文件字节后比较 expected 与 pinned 当前文本。

## 4. Session File Runtime V1

### 4.1 固定依赖

- `@rustmcp/rust-mcp-filesystem@0.4.3`
- `promptpile-mcp@0.1.0-beta.3`
- `promptpile-protocol@0.1.0-beta.2`
- `promptpile-react@0.1.0-beta.5`

不得运行时 fallback，不得从全局安装或网络 `npx` 获取替代 provider。

### 4.2 Server 与工具

gateway 固定 `flat_names=false`。工具精确为：

| Server | 写权限 | 工具 |
|---|---:|---|
| archive | false | `mcp__archive__list_directory`, `directory_tree`, `search_files`, `search_files_content`, `read_file_lines` |
| draft | true | `mcp__draft__list_directory`, `read_file_lines`, `write_file` |
| candidate | true | `mcp__candidate__list_directory`, `directory_tree`, `read_file_lines`, `write_file` |

表中省略前缀的后续工具继承同一 `mcp__<server>__` 前缀。不得导出 `edit_file`、`move_file`、压缩、媒体、Roots、终端或物理删除工具。

- archive server 显式 `ALLOW_WRITE=false`、`ENABLE_ROOTS=false`。
- draft/candidate server 显式 `ALLOW_WRITE=true`、`ENABLE_ROOTS=false`。
- mutation 工具 `retry_max_attempts=1`；只读工具最多一次 provider-owned retry。
- 模型每次写之前必须读取当前文件；成功回执后 Core hook 必须确认文件为合规普通文件。

### 4.3 固定限制

```ts
const SESSION_FILE_LIMITS = {
  reactMaxSteps: 10,
  draftMaxFiles: 64,
  draftMaxFileBytes: 256 * 1024,
  draftMaxTotalBytes: 4 * 1024 * 1024,
  candidateMaxFiles: 512,
  candidateMaxFileBytes: 512 * 1024,
  candidateMaxTotalBytes: 16 * 1024 * 1024,
  maxToolResultLineBytes: 32 * 1024,
  conversationMaxToolCallsPerThought: 8,
  conversionMaxToolCallsPerThought: 16,
  repairMaxToolCallsPerThought: 8,
  conversionTimeoutMs: 300_000,
  repairTimeoutMs: 180_000,
  reviewTimeoutMs: 180_000,
  repairRounds: 3,
  reviewRounds: 1,
  yamlMaxDepth: 32,
  collectionMaxItems: 10_000,
  diagnosticsMaxItems: 200,
  diagnosticMessageMaxBytes: 2 * 1024,
} as const;
```

调用者不能覆盖这些值。

## 5. Candidate Overlay 与 operation policy

Candidate V1 只支持 put，不支持物理 delete。Revise 的逻辑删除通过重写集合 YAML 表达；Settle 和 abandon 保持现有确定性 Core 路径。

```text
candidate/
  files/<World document path>
  task.json       # Core 独占写、模型只读
```

### 5.1 Init

- base 为空。
- Core 独占生成 `profile/dayloom.json`。
- Candidate 必须生成四个 canon Markdown、四个 state YAML、三个实体 index、五个 memory 文档和 `story-seeds/active.yaml`。
- 每个 character 必须生成 profile/relationships/state/memory/timeline 五个文件。
- 每个 location 必须生成 profile/state/memory/triggers/timeline 五个文件。
- 每个 arc 必须生成 profile/state/timeline 三个文件。
- 不允许 `days/`、`audit/`、`custom/`。

### 5.2 Planning

只允许且必须生成目标 Day 的：

```text
days/<day>/plan.json
days/<day>/timeline.md
days/<day>/dialogue/planning.md
days/<day>/events/index.yaml
```

其他路径全部继承 pinned tree。

### 5.3 Play

只允许且必须生成：

```text
days/<day>/events/index.yaml
days/<day>/timeline.md
days/<day>/play-index.json
days/<day>/events/<event-id>/event.yaml
days/<day>/events/<event-id>/scene.md
days/<day>/events/<event-id>/dialogue.md
days/<day>/events/<event-id>/user-action.md
days/<day>/events/<event-id>/result.yaml
days/<day>/events/<event-id>/state-patch.yaml
```

Play 不生成 summary、settlement、diary 或 next-day-seed。

### 5.4 Revise

只允许按 operation 修改：

- `canon/{premise,rules,style,user-role}.md`
- `state/{progress,variables}.yaml`
- `characters/index.yaml` 与 character 实体文件
- `locations/index.yaml` 与 location 实体文件
- `arcs/index.yaml` 与 arc 实体文件
- `story-seeds/active.yaml`

禁止 `profile/`、`days/`、`audit/`、`custom/`。未被 operation 指定的允许路径也不得出现在 overlay。

审计永远由 Core 在验证后确定性追加，不属于 overlay。

## 6. ID 分配 V1

- Init character/location/arc 按 Draft 顺序从 1 分配。
- Planning Beat 按 Draft 顺序从 `beat1` 分配。
- Play Event 按 Draft 顺序从 `event1` 分配。
- 每个 location 的 trigger 按 Draft 顺序从 `trigger1` 分配。
- Init fact/thread/seed 分别按 Draft 顺序从 `fact1`/`thread1`/`seed1` 分配。
- Revise 新实体和新增 seed 使用对应 pinned 集合中最小未使用正整数。
- 已发布但之后从集合移除的持久 ID不得重新用于不同语义实体；分配器必须同时考虑当前 tree 与历史 audit assignment。
- assignment 由 `(draft content hashes, base root tree hash)` 唯一确定并写入 `assignment.json`。
- Draft 内容或 base hash 改变时 assignment 整体失效并重新生成。

## 7. 提交流水线

固定顺序：

```text
lint -> allocate -> convert -> validate
     -> [repair -> validate] x 3
     -> advisory review x 1
     -> diff -> publish -> audit/archive/cleanup
```

- convert 使用新的 Conversation，不读取对话 Conversation 或其摘要。
- Final 只输出转换执行摘要，业务内容必须已写入 Candidate。
- validator 返回错误时才能进入 repair。
- 每次 repair 后必须运行完整 validator。
- 相同 `code + path + constraint` 集合连续出现两轮时提前失败。
- AI review 只生成 advisory，不修改 Candidate、不阻塞发布、不提供 caller strict mode。
- publish 前再次比较 pinned revision、commit ID 与 root tree hash。

## 8. ValidationIssue V1

```ts
type ValidationStage = 'draft' | 'candidate' | 'review' | 'publish';
type ValidationSeverity = 'error' | 'advisory';

interface ValidationIssue {
  schemaVersion: 1;
  stage: ValidationStage;
  severity: ValidationSeverity;
  code: string;
  path: string | null;
  constraint: string;
  expected?: string;
  actual?: string;
  repairHint?: string;
}
```

排序固定为 severity、stage、path（null 在前）、code、constraint 的英文码点顺序。程序 validator 只产生 error；review 只产生 advisory。

## 9. 公开结果、状态与事件

新增错误码：

```text
WORLD_BUSY
DRAFT_INVALID
CONVERSION_FAILED
CANDIDATE_INVALID
```

`CoreError` 增加可选 `diagnostics?: readonly ValidationIssue[]`。现有 `SUBMISSION_INVALID` 随旧 SubmissionV2 路径一同退役。

Session 公开状态仍为 ready/running/submitting。提交失败的固定事件顺序：

```text
submission.diagnostics?
work.failed
state.changed(session.status=ready)
```

成功顺序：

```text
submission.stage(publish)
work.completed
state.changed(session=null, world=new revision)
```

新增事件：

```ts
type SubmissionStage = 'lint' | 'allocate' | 'convert' | 'validate' | 'repair' | 'review' | 'diff' | 'publish';

| { type: 'submission.stage'; sessionId: string; operationId: string; stage: SubmissionStage; attempt: number }
| { type: 'submission.diagnostics'; sessionId: string; operationId: string; diagnostics: readonly ValidationIssue[] }
```

`cancel` 在 running 和 submitting 均可用。取消 submit 必须杀死当前子进程、关闭 gateway、删除 Candidate、保留 Draft，并回到 ready。publish 的 current pointer 已变为可见后不接受取消。

## 10. 冻结变更规则

以下变化必须先显式修订本契约，不能作为实现细节处理：

- 依赖版本和 provider；
- model-visible 工具名、参数或权限；
- Draft 格式和确认语义；
- operation 路径矩阵；
- ID 分配；
- 校验与 AI review 的权力；
- 资源限制；
- 公开错误、状态、事件及顺序；
- 原子发布和失败恢复语义。
