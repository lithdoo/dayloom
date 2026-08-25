# Dayloom Session Patch Profiles 目录设计草案

> 状态：Draft / 可直接实施
> 日期：2026-08-24
> 实施范围：使用 World Profile V1 的 Init、Planning、Play、Revise Session
> 非对话流程：Settle 与 abandon 不使用 Patch Profile

## 1. 结论

本文已经冻结四种 Patch Profile，可直接实现 scanner、validator 和 freezer。实现期的资源上限、runner 步数及 MCP 集成参数不改变本文件定义的目录和业务语义。

Dayloom 不使用一套通用目录表达所有对话流程，而采用：

> 统一 patch 运行机制，不同流程拥有独立的目录结构、schema、引用规则和冻结函数。

```text
共同机制
├── Session 私有目录
├── Core-owned writer lane
├── Core-bound Session File Runtime
│   ├── archive_fs：服务端只读 mode-specific pinned snapshot
│   └── patch_fs：可读写当前 patch
├── submit 时稳定扫描与 validate
├── Core 确定性 freeze/build/publish
└── cleanup

流程专属 Patch Profile（Core 内部现行格式）
├── 允许路径
├── 文件 schema
├── 引用与顺序规则
├── update/merge 语义
└── submission freezer
```

Init、Planning、Play、Revise 全部切换为各自的 Patch Profile。Settle 和 abandon 不是对话候选流程，不使用 patch。

## 2. 设计原则

### 2.1 面向 AI authoring，而不是镜像 Archive

Patch 是 AI 易于生成和更新的候选格式，不是 Archive V2 staging，也不要求与正式 Profile V1 文件逐项同构。

第一版只支持 AI 通过 Core-owned Session File Runtime 编辑运行中的 patch。TUI 继续通过 `send()` 表达用户意图，不直接写 patch；人工编辑器、导入器和其他 writer 不在第一版产品边界内。测试 fixture 可以在 Session 启动前准备。submit 始终只信任稳定扫描、Profile validation 和 freezer，不信任“由 AI 生成”这一事实。未来若需要受控外部 writer，必须先增加明确的 Core patch editor API，不允许直接暴露宿主目录。

长正文使用 Markdown 或 YAML block scalar；一个业务实体尽量使用一个文件；只在正文天然独立且可能很长时拆分文件。

Markdown 和 YAML block scalar 虽然承载非结构化正文，但文件路径或 typed operation 已经确定其业务字段。正文一律表示该字段的完整候选最终值，不表示编辑指令、摘要、TODO、diff 或局部替换片段；Core 将其作为不透明 UTF-8 字符串冻结，不推断或合并正文语义。

### 2.2 一个事实只有一个来源

实体存在性直接由文件名确定，不再同时维护 `index.yaml`。冻结时按合法 local key 的 ASCII 字节顺序排序，避免依赖文件系统枚举顺序。

### 2.3 Session 隐式决定 profile

AI 不传 `kind`，也不能选择另一套目录 schema。`session.kind` 是唯一 Profile 判别源，Core 通过内部 handler registry 选择 Patch Profile 及对应 publication adapter；Session 不再保存第二份 profile 标识。Patch Profile 只负责 authoring 目录的 scanner、validator 和 freezer，不拥有 Archive publication 语义。

Authority 按问题划分：immutable pinned business snapshot 决定当前正式事实，patch 决定当前已保存候选，当前用户 turn 决定本轮获准变化。较早 Conversation turn 只是可能过时的讨论历史；它们只有在当前用户 turn 明确引用、接受或延续时才能授权本轮修改。尚在讨论的备选方案不得写入。Archive snapshot 与 patch 正文都是业务数据而非运行时指令。只有 Core validation/freezer/builder/publisher 能确认并发布结果。

### 2.4 Patch 不是 Published World

所有 patch 都禁止包含：

- `current.json`；
- Archive manifest、commit、operation、root tree 和 objects；
- World ID、commit ID 或 operation ID 的控制权；
- audit、Conversation、runtime log 和 provider 配置。

只有 `validate → freeze → existing builder → publishMutation()` 可以产生正式 World mutation。

### 2.5 只统一必要机制

第一版不建设：

- 通用三方 merge；
- 未发布 Session 的跨进程恢复；
- revision directory + pointer 型文件系统；
- 多用户协同编辑；
- 通用 World checkout/overlay；
- 把不同流程强行塞入同一目录 schema 或同一 merge 算法。

### 2.6 Patch Profile 不另立版本协议

Patch Profile 是 Core 私有、随代码同步演进的 authoring format，不是对外交换协议，不写 `schemaVersion`，也不使用 `init-v1`、`play-v1` 一类可协商版本标识。Session kind 唯一决定当前格式；升级时直接同步修改 prompt、scanner、freezer 和测试，不保留旧格式兼容层。

`SubmissionV2` 仍是当前 builder 的规范输入边界。每种 parser 拆成 JSON text parse 与纯 `unknown` value validation 两层；各 freezer 只负责把文件投影为 submission value，并必须调用同一个规范 value validator，不能复制一套逐渐漂移的字段规则。Pinned World 引用、重复 target 和 expected 注入由对应 Profile 完成；进入 builder 后的未分类失败视为实现 invariant，而不是普通候选错误。

### 2.7 规范归属

三份草案按以下边界各自提供唯一规范来源：

- 本文件唯一规定 Patch Profile 的合法路径、文件 schema、引用、顺序和 freeze 语义；
- `SESSION_PATCH_FILESYSTEM_MCP_AND_PROMPTS_DRAFT.md` 唯一规定文件工具、安全边界和 AI 编辑行为；
- `SESSION_PATCH_FLOW_ADAPTATION_DRAFT.md` 唯一规定 Session 状态机、publication、错误恢复、audit 和实施顺序。

其他文件为便于说明而出现的流程或目录摘要均为非规范投影；若与上述归属冲突，以对应唯一规范来源为准。实现中的 Profile schema 与 mode-specific prompt 应由同一 Core-owned descriptor 组装或接受一致性测试，禁止手工维护两份独立字段契约。

## 3. 共同目录边界

每个对话 Session 只需要一个 AI 可编辑候选根：

```text
runtime/sessions/<session-id>/
├── snapshot/              # Core 从 PublishedWorld 投影的 mode-specific 只读证据；Init 为空
└── patch/                 # 当前 Session 唯一可写候选；kind 由 Session 隐式决定
```

规则：

- `archive_fs` 只绑定 `snapshot/` 且服务端只读，`patch_fs` 只绑定 `patch/`；
- Session ID 和宿主绝对路径不进入模型参数；
- 每个 Session 只有一个 Core 授权 writer；
- 四种模式使用同一种 Session File Runtime，内部固定一个 gateway 与两个独立 `fs-mcp-rs` 实例；
- AI 只获得 archive list/read 与 patch list/read/write/remove，不获得配置、连接或 root authority；
- 文件运行时只强制文件系统安全、编码、权限和资源限制，不复制业务 schema；
- 编辑阶段允许未知、缺失或暂时不合法的候选文件；
- `submit()` 不调用 AI；Core 只在 Session ready 且无 in-flight React/after-hook/executor 时扫描稳定目录；
- Core 按当前 Patch Profile 拒绝未知路径并执行完整 validation。

Snapshot 不是整棵 Published World checkout，而是当前 Session mode 的最小可用证据投影。Core 从已经验证的 `PublishedWorld` 内存表示物化它，不再遍历整个 Archive：

| Session | Snapshot 内容 |
| --- | --- |
| Init | 空目录 |
| Planning | `profileV1.contextDocuments`；若存在 last-settled day，再加其 `summary.md` |
| Play | `profileV1.contextDocuments` 与 pinned `days/<day>/plan.json` |
| Revise | `profileV1.contextDocuments` |

`profileV1.contextDocuments` 已包含 canon、state、entities、memory 和 story seeds。Snapshot 不包含 `profile/dayloom.json`、其他 day history、`audit/**`、`custom/**` 或 Archive 控制文件。日后若某个 mode 确实需要新证据，只扩展该 mode 的显式 snapshot manifest，不改为整棵 checkout。

## 4. Init Patch Profile

### 4.1 定位

Init 没有基线 Published World。它的 patch 是完整但可渐进形成的候选 World：

```text
Init Patch
    = InitSubmissionV2 的文件化 authoring format
    != 对现有 World 的 diff
```

### 4.2 目录结构

```text
patch/
├── world.yaml
├── canon/
│   ├── premise.md
│   ├── rules.md
│   ├── style.md
│   └── user-role.md
├── characters/
│   └── <local-key>.yaml
├── locations/
│   └── <local-key>.yaml
├── arcs/
│   └── <local-key>.yaml
└── narrative.yaml
```

该结构完整覆盖 `InitSubmissionV2`，但不复制由现有 builder 自动创建的 memory、timeline、progress、ID 和 Archive 控制文件。

### 4.3 `world.yaml`

```yaml
title: 示例世界
state:
  status: active
  elapsed: null
  variables: {}
```

它映射到 title 与 `worldState`。variables key 和 scalar 规则与当前 Init submission 保持一致。

### 4.4 Canon

四个 Markdown 文件分别映射到 premise、rules、style 和 userRole。正文是否允许空字符串以当前 `InitSubmissionV2` 语义为基线，不在 Patch Profile 中顺带收紧。

每个 Markdown 文件的完整内容就是相应 canon 字段的完整候选值。AI 修改已有 canon 前必须先读取当前文件并保留用户未要求修改的段落；文件中不得写“修改第二段”一类编辑说明。

### 4.5 Character

文件名是 local key，例如 `characters/protagonist.yaml`：

```yaml
profile: |-
  一名负责调查失踪档案的年轻学者。
status: active
locationKey: central-library
tags:
  - investigator
relationships:
  - characterKey: archivist
    relation: colleague
    status: trusted
```

一个文件表达一个完整 character，避免 profile、state 和 relationships 三份文件同步更新。

修改已有实体前必须读取当前文件并完整写回。重命名 local key 时必须同步更新全部 `locationKey`/`characterKey` 引用并删除旧文件；删除实体时必须检查全部引用。编辑阶段允许暂时悬空，但 AI 已知的悬空引用不得故意留到 submit。

### 4.6 Location

例如 `locations/central-library.yaml`：

```yaml
profile: |-
  位于王城中心的古老图书馆。
status: active
tags: []
triggers:
  - condition: 夜幕降临
    effect: 钟楼入口开放
```

trigger ID 不由 AI 提供，由现有 builder 按数组顺序生成。

### 4.7 Arc

例如 `arcs/missing-archive.yaml`：

```yaml
profile: |-
  围绕失踪档案展开的长期调查。
status: active
stage: opening
```

### 4.8 `narrative.yaml`

```yaml
initialFacts:
  - text: 王城已经封锁北门
unresolvedThreads:
  - text: 档案馆失踪了一本记录
storySeeds:
  - text: 玩家收到一封没有署名的信
```

这三个集合当前没有独立编辑或并发合并需求，集中在一个文件比为每条内容创建目录更简单。

### 4.9 Local key 与顺序

- local key 直接来自不含扩展名的文件名；
- character、location、arc 使用独立 namespace；
- key 必须匹配 `[a-z][a-z0-9]*(?:-[a-z0-9]+)*`，长度为 1–64 个 ASCII 字节；
- key 只允许小写 ASCII 字母、数字和单个连字符，因此路径分隔符、`.`、`..`、连续/尾随连字符、大小写别名和 Unicode 规范化冲突天然非法；
- character 的 location/relationship 引用相应文件名 local key；
- 编辑阶段允许暂时悬空，完整 validation 拒绝悬空引用；
- 冻结时按 local key 的 UTF-8/ASCII 字节升序排序，再交给现有 builder 分配持久 ID；
- self-reference 和关系环是否有效继续遵守当前 Init submission 语义。

### 4.10 冻结闭环

```text
Init patch files
    → 严格扫描固定路径
    → 解析 YAML/Markdown
    → 校验 local keys、唯一性和引用
    → 按 key 排序
    → freezeInitPatch()
    → InitSubmissionV2
    → buildInitMutationV1()
    → publishMutation()
```

`freezeInitPatch()` 是唯一转换入口。它不分配 World ID，不直接编码 Profile V1 文件，也不写 Archive。投影完成后必须通过规范 `InitSubmissionV2` 校验，再进入 builder。

## 5. Planning Patch Profile

Planning 的候选只是单日有序计划：

```text
patch/
└── plan.yaml
```

```yaml
intent: 调查失踪档案
knownContext: []
constraints: []
openQuestions: []
maxEvents: 4
beats:
  - key: inspect-library
    intent: 检查图书馆
    priority: required
    dependsOn: []
```

冻结目标是 `PlanningSubmissionV2`。beats 顺序具有业务意义，因此保留在一个有序数组中，不拆成实体目录。

完整 validation 检查 target day 不可由 patch 选择、beat key 唯一、dependency 只引用更早的 beat，以及当前 `PlanningSubmissionV2` 定义的文本和集合限制。`maxEvents` 只遵守规范 submission 当前的“安全整数且至少为 1”语义；Patch Profile 不额外规定 `beats.length <= maxEvents`。若领域规则要收紧，必须先统一修改规范 submission、builder、测试和文档。

冻结闭环为：

```text
patch/plan.yaml
    → freezePlanningPatch()
    → PlanningSubmissionV2
    → buildPlanningMutationV1()
    → publishMutation()
```

## 6. Play Patch Profile

Play 的候选是 pinned day 内产生的事件，长 scene/dialogue 与结构化结果天然适合分离：

```text
patch/
└── events/
    └── <local-event-key>/
        ├── event.yaml        # 必需
        ├── scene.md          # 可选；缺省映射为空字符串
        └── dialogue.md       # 可选；缺省映射为空字符串
```

只有存在且可能较长的 scene 和 dialogue 独立使用 Markdown；没有相应正文时不必创建空文件。其余结构化内容集中在 `event.yaml`：

```yaml
order: 1
title: 进入图书馆
beatId: beat1
locationId: location2
participantIds:
  - character1
userAction: 检查封闭的档案室
result:
  summary: 发现档案被人为取走
  learnedFacts: []
  timeAdvanced: null
  completedBeatIds:
    - beat1
  skippedBeatIds: []
  endDay: false
proposedPatch:
  - op: move-character
    characterId: character1
    locationId: location2
```

目录名只提供 local event key，例如 `events/library-entry/`。`order` 是唯一安全整数；冻结时按 `order` 升序排序。它不要求从 1 开始或连续，因为正式 event ID 由 builder 按冻结后的数组顺序分配。调整事件顺序只需更新真正需要移动的 `event.yaml`，不需要重命名目录、重建连续序号或维护额外 index。

`scene.md` 与 `dialogue.md` 存在时，其完整 UTF-8 正文分别映射到 event 的 `scene` 与 `dialogue` 字段；缺省时 freezer 使用空字符串。它们不包含创作说明、待办、摘要或局部 diff。调整顺序后必须复核 `order` 唯一性；删除 event 只需删除其候选文件，不重新编号其他 event。

冻结目标是 `PlaySubmissionV2`。与 Init 不同，Play 只能引用 pinned Published World 的 beat、character、location 和 arc 持久 ID，不能创建或重命名这些 ID。

`proposedPatch` 使用面向 authoring 的操作，不要求 AI 复制当前值：

- `set-world-variable`：`key`、`value`；
- `set-character-status`：`characterId`、`value`；
- `move-character`：`characterId`、`locationId`；
- `set-location-status`：`locationId`、`value`；
- `set-arc-stage`：`arcId`、`value`。

`freezePlayPatch(pinnedWorld)` 从 pinned World 为每项注入 `expected` 或 `expectedLocationId`，形成规范 `DomainPatchV1`。同一事件及整次 Play 中不得重复写同一状态目标；引用和期望值都以 pinned World 为准。proposed patches 只作为候选事件结果发布，仍由后续 Settle 应用。

```text
patch/events/**
    → freezePlayPatch(pinnedWorld)
    → PlaySubmissionV2
    → buildPlayMutationV1()
    → publishMutation()
```

## 7. Revise Patch Profile

Revise 有 Published World 基线，并依赖 persistent ID 和 exact precondition。它使用：

```text
patch/
└── operations.yaml
```

`operations.yaml` 保存一个面向 AI authoring 的有序 operations 数组。它保留 target、persistent ID 和新值，但不要求 AI 复制当前值作为 exact precondition：

```yaml
operations:
  - op: replace-canon
    field: premise
    value: |-
      新的世界前提。
  - op: set-character-status
    characterId: character3
    value: missing
```

第一版 authoring operation 的完整集合是现有 `ReviseOperationV1` 的最小投影：

- `replace-canon { field, value }`；
- `replace-character-profile { characterId, value }`；
- `replace-location-profile { locationId, value }`；
- `replace-arc-profile { arcId, value }`；
- `create-character { profile, status, locationId, tags, relationships }`；
- `create-location { profile, status, tags, triggers }`；
- `create-arc { profile, status, stage }`；
- `set-world-variable { key, value }`；
- `set-character-status { characterId, value }`；
- `move-character { characterId, locationId }`；
- `set-location-status { locationId, value }`；
- `set-arc-stage { arcId, value }`；
- `add-story-seed { text }`；
- `remove-story-seed { seedId }`。

`expected`、`expectedLocationId` 和 `expectedText` 都不是 authoring 字段，由 freezer 从 pinned World 注入。除这些被省略的 precondition 外，字段类型、枚举和集合限制与规范 `ReviseSubmissionV2` 保持一致；Core 中的 authoring schema 必须作为 prompt 摘要和 validator 测试的同一来源。

Patch schema 不等同于 `ReviseSubmissionV2`。`freezeRevisePatch()` 根据 pinned World 读取每个目标的当前值，注入 `expected`、`expectedLocationId` 或 `expectedText`，再生成完整 `ReviseSubmissionV2`。

它不 checkout 完整 World，也不复用 Init local keys。长 replacement 正文使用 YAML block scalar，但当前正文不在 patch 中重复存储。

每个 replacement `value` 是目标字段发布后的完整最终值，不是修改说明或文本 diff。即使用户只要求修改一句话，AI 也必须以 pinned World 的权威当前正文为输入生成完整 replacement；Core 只执行 typed exact replacement，不解释自然语言编辑指令，也不执行模糊文本合并。

第一版的 `create-character`、`create-location` 和 `create-arc` 不接受 local key。任何 operation 的 target/reference 都只能使用 pinned World 已有持久 ID，不能指向同一 `operations.yaml` 中新建、尚未分配 ID 的实体；新 character 的 `locationId` 和 relationships 也遵守这一规则。需要“新建后再引用”时拆成下一次 Revise。这样避免 AI 预测 builder 将分配的持久 ID，也避免在 Patch Profile 中另建一套临时 ID 协议。未来若确有单次批量建图需求，应先为规范 submission 与 builder 设计显式 local reference/ID allocation，而不是依赖操作顺序猜 ID。

完整 validation 使用 pinned World 校验 persistent ID、目标存在性、引用、重复写目标和 control-plane 禁区。冻结后的 submission 和现有 builder 继续执行 exact precondition；`publishMutation(base: pinnedWorld)` 继续提供 World revision OCC。

```text
patch/operations.yaml
    → freezeRevisePatch(pinnedWorld)
    → ReviseSubmissionV2
    → buildReviseMutationV1()
    → publishMutation()
```

## 8. 四种目录结构复核

### 8.1 AI 生成与编辑

| Profile | 最小编辑单元 | 复核结论 |
| --- | --- | --- |
| Init | 一个全局文件、一个 canon 文件或一个实体文件 | 一个实体一个文件，适合渐进生成和局部替换 |
| Planning | `plan.yaml` | plan 是单一有序聚合，不拆 beat 文件最清晰 |
| Play | 一个 `event.yaml` 或一个可选长正文文件 | 结构信息集中，scene/dialogue 按需存在，重排不移动目录 |
| Revise | `operations.yaml` | 单一有序操作集，AI 不复制 pinned 当前值 |

四种目录都只需要 patch list/read/write/remove；Planning、Play、Revise 还可通过 archive list/read 获取精确正式事实和 ID。文件运行时不理解 Dayloom 领域对象。目录名和文件名本身提供足够导航信息，不维护冗余 index、AI 可见 receipt 或 control 文件。

### 8.2 目录清晰度

- Init 按 world、canon、entities、narrative 分区；
- Planning 明确只有一个目标日计划；
- Play 按候选 event 分区，每个 event 有一个必需结构文件和至多两个可选长正文；
- Revise 明确只有 typed authoring operations，不伪装成完整 World checkout。

任何无法归入这些固定位置的文件都不是该 Patch Profile 的合法业务内容，submit validator 必须拒绝。

### 8.3 现有存档合并闭环

Patch 目录不直接 merge 或复制到 Archive。四种模式都先转换为现有 submission，再由现有 builder 生成正式文件：

| Patch source | Freeze target | Existing Archive builder |
| --- | --- | --- |
| Init `patch/**` | `InitSubmissionV2` | `buildInitMutationV1()` |
| Planning `patch/plan.yaml` | `PlanningSubmissionV2` | `buildPlanningMutationV1()` |
| Play `patch/events/**` | `PlaySubmissionV2` | `buildPlayMutationV1()` |
| Revise `patch/operations.yaml` | `ReviseSubmissionV2` | `buildReviseMutationV1()` |

因此 Patch Profile 只优化 AI authoring，不复制 Profile V1 编码规则，不分配 Archive ID，也不形成第二套 publication path。

### 8.4 复核结论

当前四种结构满足：

- AI 可以用通用文件工具直接生成和修改；
- 修改已有候选前先读取当前文件；成功写入回执足以确认普通原子替换，高风险多文件引用修改、重命名、删除或状态不确定时再读回复核；
- 每个业务事实只有一个候选来源；
- 长正文与结构化字段按需要分离，不做机械拆分；
- 非结构化正文只作为路径或 operation 已确定字段的完整最终字符串，不承担修改协议；
- 顺序分别由数组或显式 `order` 表达；
- pinned authority 和正式 ID 不由目录结构重新定义；
- Core 能确定性 freeze 并复用现有 builder；
- 不需要通用 merge、checkout、index 或领域 CRUD 工具。

## 9. Settle 与 abandon

Settle 和 abandon 是 Core 确定性操作，不是 AI 对话候选流程，不创建 Patch Profile、不启动 Session File Runtime，也不向 AI 提供文件工具。

## 10. 简化的编辑一致性策略

第一版基于 Session 私有、Core-owned writer lane 和可丢弃 runtime 状态：

- MCP 服务与 Core adapter 在写入前校验 root confinement、路径、编码、大小和普通文件身份；
- 单文件使用临时文件 + rename；
- 多个文件之间不承诺事务原子性，候选可以暂时不完整；
- AI 不操作 `expectedRevision` 或专用 OCC 协议；
- 第一版只有 AI 文件工具可通过 Core-owned patch writer lane 写入；Core 串行执行同一 Session 的 send/submit；
- submit 不运行 React；Core 依赖现有 operation gate 与 ReAct/after-hook 完成契约，只在 ready 且无 in-flight React/after-hook/executor 时扫描；
- submit 对整个目录重新扫描和验证；
- validation failure 保留 patch，同一 Session workspace 继续使用；不重建或 rebind root；
- writer 或进程在无法确认单文件替换状态时终止 Session并清理 patch；
- 不承诺崩溃后恢复未发布 patch。

只有在未来明确要求跨进程恢复时，才升级为目录 snapshot/pointer 协议。

## 11. 共同安全规则

所有 Patch Profile 都必须拒绝：

- 绝对路径、盘符、UNC、空路径和 traversal；
- symlink、junction、hard-link 输入和特殊文件；
- submit 时发现的未知路径、未知字段和不支持的文件类型；
- 非 UTF-8 文本和不支持的 YAML 值；
- 超过单文件、单调用、实体数量或 patch 总大小上限的输入；
- 任何试图越过 archive business snapshot 或 patch 当前候选 root，访问原始 Archive 控制面、Conversation、runtime control 或 provider 配置的路径。

AI 只能看到 archive 中当前 SessionMode snapshot manifest 列出的稳定业务相对路径，以及 patch 中当前 Patch Profile 的相对路径；不能看到两者对应的宿主路径。

## 12. Definition of Done

1. Init、Planning、Play、Revise 分别拥有独立且最小的 Patch Profile；
2. 四种对话流程都通过 patch 唯一冻结为各自现有 submission 类型；
3. Init 中一个实体只需维护一个文件，且不存在冗余 index；
4. Planning 的有序计划只需维护一个文件；
5. Play 中一个 event 只需维护一个必需结构文件和至多两个可选长正文文件，重排不需要移动目录；
6. Revise patch 不重复保存 pinned World 当前值，exact preconditions 由 Core 注入；
7. Patch 不包含或修改 Archive 控制面；
8. invalid/incomplete patch 不能触发 publication；
9. 同一候选内容产生确定的冻结顺序和业务文档；
10. 四种目录都能由同一种 Session File Runtime 暴露的 patch 工具直接生成和编辑，并可按需读取当前 SessionMode 的 pinned snapshot manifest；
11. AI 不需要理解 revision、OCC 或 Dayloom 专用文件 CRUD；
12. Patch 文件不建立独立版本协议，不保留旧格式兼容层，submit 不建立机器 Final；
13. Play proposed patches 和 Revise exact preconditions 都由 Core 从 pinned World 注入；
14. Revise 第一版不允许引用同一次提交中新建实体；
15. 所有已有候选修改都遵守 inspect-before-write、完整写回和引用闭环；普通原子写入以稳定回执确认，高风险或状态不确定的修改执行 read-back；
16. 实现不引入通用 checkout、三方 merge 或第二套 Archive runtime。
17. 第一版运行中 patch 只由 AI 文件工具经 Core-owned writer lane 编辑；若日后引入外部 writer，必须先定义 Core patch editor API。
