# Dayloom Core World Profile V1 完整存档闭环实施冻结

> 状态：**Implemented / 全链路验收完成**
> 冻结日期：2026-08-22；落地验收：2026-08-23
> 目标包：`@dayloom/core`
> 数据基础：`@dayloom/archive-protocol` V2
> 迁移来源：早期 filesystem World、现有 Core World Profile V0
> 目标：在不修改 Archive V2 control plane 的前提下，无损承载早期 World 信息，并让 Init → Planning → Play → Settle → 下一日形成长期语义闭环。

本文冻结 World Profile V1 的路径、权威关系、Submission、生命周期 mutation、迁移、失败语义、兼容策略、代码落点和验收标准。实现若需要改变本文中的 persisted shape、权威顺序或 publication theorem，必须先修改本文；不得在代码中静默形成第二套约定。

## 实施结果

Phase A–G 已全部落地，并通过 Core build、architecture guard、单元/集成测试。最终 fixture 已验证：

```text
legacy filesystem
→ 显式 migration（逐文件 hash inventory + report）
→ Archive V2 / World Profile V1 revision 1
→ Planning V2
→ structured Play events
→ atomic Settle
→ dispose / restart
→ next Planning (day2)
```

迁移入口：

```text
dayloom-core archive migrate-world-profile-v1 \
  --source <legacy-world> \
  --target <new-archive-v2-world>
```

迁移不会由 TUI 或 `createDayloomCore()` 自动触发，也不会修改 source。旧人物/地点/arc/state/memory 会投影为 V1 权威文档；无法安全结构化的早期 day 内容进入 `memory/legacy-days/**`，因此仍进入后续 Session 的 verified World context；日志、导出和未知 portable UTF-8 文件原样进入 `legacy/**`。二进制文件因 Archive V2 media contract 仅接受 UTF-8 文档而显式拒绝，不会静默遗漏。

---

## 0. 结论

不创建 Archive V3，不把 Character、Location、Arc、Memory 等业务 DTO 放入 `@dayloom/archive-protocol`。

冻结后的闭环：

```text
用户可见 Conversation
        ↓
严格领域 Submission
        ↓
Core semantic validator + deterministic document builder
        ↓
WorldChange[]
        ↓
Archive V2 staging → candidate tree → commit
        ↓
同一 World Profile V1 validator read-back
        ↓
current.json visibility switch
        ↓
下一 Session 从 Published World 重新读取人物、地点、状态、记忆和历史
```

Archive V2 已经拥有路径、media type、blob、tree、commit、operation、OCC 和恢复分类。当前缺口位于 Core World Profile V0、Submission 数据容量和 Settle 语义。

---

## 1. 规范来源与非目标

规范优先级：

```text
1. @dayloom/archive-protocol
   → Archive control plane、hash、path、tree、commit、operation correctness

2. 本文 Core World Profile V1
   → World document shape、authority、生命周期 mutation

3. CORE_FUNCTIONAL_COMPLETION_DRAFT.md 中未被本文替换的 runtime 定理
   → public API、Session、publication、cleanup、error semantics

4. CORE_PROMPTPILE_REACT_BETA4_UPGRADE_PLAN.md
   → Conversation / React work / Observe / Final 隔离

5. @dayloom/core / @dayloom/core-old
   → legacy migration evidence，不是新运行时规范
```

非目标：

- 不改变 `manifest.json`、`current.json`、commit、tree、blob、operation schema。
- 不让模型直接提供 path、hash、bytes、mediaType、stable ID 或 Archive control 字段。
- 不把 raw Thought、Observe、Check、tool scratch、provider payload 或 private receipt 写入 World。
- 不在 `createDayloomCore()` 中自动迁移 legacy 存档。
- 不原地删除或覆盖 legacy filesystem World。
- 不要求一次恢复旧实现中所有重复缓存的权威地位；重复内容必须保留，但只能有一个新权威来源。

---

## 2. 冻结不变量

### 2.1 Protocol invariant

Archive Protocol 只理解通用文档与对象关系，不理解人物、地点、剧情线或记忆。

### 2.2 Builder ownership invariant

模型只提交领域数据；所有路径、稳定 ID、序号、格式化 bytes 和 `WorldChange[]` 均由 Core 确定性生成。

### 2.3 Single validator invariant

发布前 candidate tree 与启动后 Published World 必须调用同一套 Profile validator。Core 能发布的 World 必须能在 dispose/restart 后读取。

### 2.4 Fact/state/derivation invariant

```text
settled day event/result facts
        ↓
settlement record
        ↓
current state projection
        ↓
memory/timeline/summary derivation
```

发生矛盾时以上层级由上至下决定权威；派生文档不得反向覆盖事实。

### 2.5 Settlement atomicity invariant

某日全部 state/entity/arc/memory/timeline/summary/settlement 更新必须位于同一 candidate tree 和同一 commit 中。不得出现“summary 已发布但人物状态未更新”的半结算 World。

### 2.6 Historical immutability invariant

普通 Planning、Play、Settle 不能重写已 settled day 的事实文档。显式 Revise 也只能通过专用历史修订操作完成；V1 首期不提供历史事实修订。

### 2.7 Conversation isolation invariant

只允许用户真正看到的 user/assistant turns 进入 audit transcript。Promptpile React 内部工作继续位于 Session-owned `react-work`，terminal cleanup 后删除。

### 2.8 Migration losslessness invariant

每个 legacy regular file 必须满足以下之一：

```text
映射到 V1 权威路径
原样保存到 legacy/**
因明确、可报告错误使整个迁移失败
```

不得静默忽略。

---

## 3. Profile 版本发现

不修改通用 Archive manifest。Profile 版本由 Published Root Tree 中的业务文档声明：

```text
profile/dayloom.json
```

固定 schema：

```ts
interface DayloomProfileDescriptorV1 {
  schemaVersion: 1;
  profile: 'dayloom';
  profileVersion: 1;
}
```

canonical bytes：`JSON.stringify(value, null, 2) + "\n"`。

读取规则：

```text
profile/dayloom.json absent
→ 按现有 Profile V0 读取

profileVersion === 1
→ 按本文 V1 读取

其它版本或 malformed descriptor
→ WORLD_INVALID
```

V1 Init 必须创建 descriptor；V0 更新在完成迁移前继续使用 V0 builder，不得隐式升级。

---

## 4. Published Root Tree 布局

### 4.1 Control-adjacent business metadata

```text
profile/dayloom.json
```

### 4.2 Canon

```text
canon/premise.md
canon/rules.md
canon/style.md
canon/user-role.md
```

四者是当前 canon 完整快照，允许空 UTF-8 Markdown。

### 4.3 Current world state

```text
state/world.yaml
state/calendar.yaml
state/progress.yaml
state/variables.yaml
```

最低 schema：

```ts
interface WorldStateV1 {
  schemaVersion: 1;
  title: string;
  status: string;
}

interface CalendarStateV1 {
  schemaVersion: 1;
  currentDay: string | null;
  elapsed: string | null;
}

interface ProgressStateV1 {
  schemaVersion: 1;
  activeArcIds: string[];
}

interface VariablesStateV1 {
  schemaVersion: 1;
  variables: Record<string, string | number | boolean | null>;
}
```

YAML object 必须拒绝 duplicate keys 和 unknown top-level fields。Core 增加对 `yaml` 的直接依赖，不得依赖 `archive-protocol` 的传递依赖。

### 4.4 Characters

```text
characters/index.yaml
characters/<character-id>/profile.md
characters/<character-id>/relationships.yaml
characters/<character-id>/state.yaml
characters/<character-id>/memory.md
characters/<character-id>/timeline.md
```

索引与结构化文档：

```ts
interface EntityIndexV1 {
  schemaVersion: 1;
  ids: string[];
}

interface CharacterStateV1 {
  schemaVersion: 1;
  status: string;
  locationId: string | null;
  tags: string[];
}

interface CharacterRelationshipsV1 {
  schemaVersion: 1;
  relationships: Array<{
    characterId: string;
    relation: string;
    status: string;
  }>;
}
```

关系目标必须存在于 `characters/index.yaml`。`locationId` 必须为 null 或存在于 locations index。

### 4.5 Locations

旧 `scenes/**` 在 V1 新运行时中统一为：

```text
locations/index.yaml
locations/<location-id>/profile.md
locations/<location-id>/state.yaml
locations/<location-id>/memory.md
locations/<location-id>/triggers.yaml
locations/<location-id>/timeline.md
```

```ts
interface LocationStateV1 {
  schemaVersion: 1;
  status: string;
  tags: string[];
}

interface LocationTriggersV1 {
  schemaVersion: 1;
  triggers: Array<{ id: string; condition: string; effect: string }>;
}
```

### 4.6 Arcs

```text
arcs/index.yaml
arcs/<arc-id>/profile.md
arcs/<arc-id>/state.yaml
arcs/<arc-id>/timeline.md
```

```ts
interface ArcStateV1 {
  schemaVersion: 1;
  status: 'inactive' | 'active' | 'resolved' | 'abandoned';
  stage: string;
  progress: number | null;
}
```

`progress` 为 null 或有限数值 `[0, 1]`。

### 4.7 Memory and seeds

```text
memory/short-term.md
memory/long-term.md
memory/facts.yaml
memory/unresolved-threads.yaml
memory/important-events.yaml
story-seeds/active.yaml
```

每个结构化条目必须拥有 Core-generated stable ID 和 `sourceEventIds`。无法追溯来源的 Init 初始事实使用空数组，并明确 `origin: init`。

### 4.8 Days and events

```text
days/dayN/plan.json
days/dayN/timeline.md
days/dayN/dialogue/planning.md
days/dayN/events/index.yaml
days/dayN/events/eventN/event.yaml
days/dayN/events/eventN/scene.md
days/dayN/events/eventN/dialogue.md
days/dayN/events/eventN/user-action.md
days/dayN/events/eventN/result.yaml
days/dayN/events/eventN/state-patch.yaml
days/dayN/summary.md
days/dayN/diary.md
days/dayN/settlement.yaml
days/dayN/next-day-seed.yaml
```

V1 event ID 固定为同日 `event1`、`event2`……；ID 由 Core 按提交顺序生成。

### 4.9 User-visible audit

成功 submit 时保存：

```text
audit/sessions/<session-id>/meta.json
audit/sessions/<session-id>/transcript.json
audit/sessions/<session-id>/submission.json
```

只保存 writable Conversation 中的 user 和 visible assistant turns。`submission.json` 保存 Core 接受的领域 Submission，不保存模型未校验的原始 Final bytes。

### 4.10 Legacy preservation

迁移时无法成为新权威文档但必须保留的文件进入：

```text
legacy/files/<portable-source-path>
legacy/migration-report.json
```

`legacy/**` 只读，不进入运行时 authority，也不允许普通 lifecycle 修改。

---

## 5. Namespace 与 mutation policy

新增三层验证：

```text
Archive Protocol path/media correctness
        ↓
Dayloom Profile namespace policy
        ↓
operation-specific mutation policy
```

业务 namespace：

```text
profile/**
canon/**
state/**
characters/**
locations/**
arcs/**
memory/**
story-seeds/**
days/**
audit/**
custom/**
legacy/**
```

业务代码永远不得访问：

```text
manifest.json
current.json
commits/**
objects/**
operations/**
.locks/**
logs/**
```

operation 权限：

```text
init
→ create profile/canon/state/characters/locations/arcs/memory/story-seeds/audit

planning
→ create current days/dayN plan/timeline/planning dialogue/events index/audit

play
→ append current days/dayN events; create/update current-day timeline; create audit
→ 不修改全局 current state

settle
→ create current-day summary/diary/settlement/next-day-seed
→ update state/entities/arcs/memory/story-seeds/timelines

revise
→ replace canon and explicitly selected current semantic documents
→ 不修改 settled days/** facts、audit/**、legacy/**

abandon-day
→ delete current un-settled day subtree only
```

---

## 6. Public API 与兼容边界

V1 首期不改变 `DayloomCore` public 方法：

```ts
startSession(kind)
send(text)
submit()
cancel()
settle()
abandonDay()
```

`CoreState` 可保持当前摘要 shape。丰富 World 是 persisted authority，不应把整棵 World 暴露为 UI state。

若 consumer 后续需要读取实体，另行增加只读 query API，不在 mutation 实施阶段混入。

V0 与 V1：

- V0 可继续读取和运行现有逻辑。
- V1 Init 只用于真正空 World。
- 已发布 V0 World 必须通过显式 `migrate-profile-v1` 升级。
- V1 代码不得在一次普通 Planning/Play 中隐式补写 descriptor 或默认实体文件。

---

## 7. Init V2

### 7.1 Submission

模型提交领域结构，不提交路径：

```ts
interface InitSubmissionV2 {
  version: 2;
  title: string;
  canon: { premise: string; rules: string; style: string; userRole: string };
  worldState: { status: string; elapsed: string | null; variables: ScalarMap };
  characters: Array<{
    key: string;
    profile: string;
    relationships: Array<{ characterKey: string; relation: string; status: string }>;
    status: string;
    locationKey: string | null;
    tags: string[];
  }>;
  locations: Array<{
    key: string;
    profile: string;
    status: string;
    tags: string[];
    triggers: Array<{ condition: string; effect: string }>;
  }>;
  arcs: Array<{
    key: string;
    profile: string;
    status: 'inactive' | 'active';
    stage: string;
  }>;
  initialFacts: Array<{ text: string }>;
  unresolvedThreads: Array<{ text: string }>;
  storySeeds: Array<{ text: string }>;
}
```

`key` 只在 Submission 内建立引用；Core 将其按 canonical array order 映射为 `character1`、`location1`、`arc1`、`trigger1`、`fact1` 等 stable ID。重复 key、悬空引用和 unknown fields 一律拒绝。

### 7.2 Builder

新增 `buildInitMutationV1()`：

```text
parse submission
→ allocate deterministic IDs
→ render JSON/YAML/Markdown canonical bytes
→ build complete required document set
→ add visible transcript audit
→ validate mutation policy
→ publishMutation
```

Init 成功后的 V1 World 必须在同一 commit 中包含 descriptor、canon、四个 state 文档、三个 entity indexes、全部 entity documents、memory documents、story seeds 和 audit。

---

## 8. Planning V1

```ts
interface PlanningSubmissionV2 {
  version: 2;
  intent: string;
  knownContext: string[];
  constraints: string[];
  openQuestions: string[];
  maxEvents: number;
  beats: Array<{
    key: string;
    intent: string;
    priority: 'required' | 'optional';
    dependsOn: string[];
  }>;
}
```

Core 生成 day 和 `beatN`，并将 submission-local beat key 引用转换为 ID。`dependsOn` 必须引用更早的 beat，避免 cycle 和 forward ambiguity。

Planning context 必须读取：

```text
canon
state
characters/locations/arcs current state + profiles
memory facts/unresolved threads/important events
story seeds
last settled day summary + next-day seed
```

输出 `days/dayN/plan.json`、planning transcript、空 events index 和初始 timeline。

---

## 9. Play Event V1

一个 Play Session 可以通过多次 `send()` 协作，但成功 `submit()` 一次性发布本 Session 产生的一个或多个 event bundle。

```ts
interface PlaySubmissionV2 {
  version: 2;
  events: Array<{
    beatId: string | null;
    title: string;
    locationId: string | null;
    participantIds: string[];
    scene: string;
    dialogue: string;
    userAction: string;
    result: {
      summary: string;
      learnedFacts: string[];
      timeAdvanced: string | null;
      completedBeatIds: string[];
      skippedBeatIds: string[];
      endDay: boolean;
    };
    proposedPatch: DomainPatchV1[];
  }>;
}
```

`DomainPatchV1` 只允许 Core 理解的领域目标，不允许文件路径：

```ts
type DomainPatchV1 =
  | { op: 'set-world-variable'; key: string; expected: JsonScalar; value: JsonScalar }
  | { op: 'set-character-status'; characterId: string; expected: string; value: string }
  | { op: 'move-character'; characterId: string; expectedLocationId: string | null; locationId: string | null }
  | { op: 'set-location-status'; locationId: string; expected: string; value: string }
  | { op: 'set-arc-stage'; arcId: string; expected: string; value: string };
```

Play 只把 patch 作为事件事实保存到 `state-patch.yaml`，不在 Play commit 中应用全局现态。

Play 完成后 control 仍为 `awaiting-settle(dayN)`。

---

## 10. Settle V1

现有 `settle()` 不再执行 empty-staging publication。它调用 deterministic `buildSettlementMutationV1()`：

```text
read pinned plan + all current-day events
→ verify event IDs/order/relations
→ collect proposed patches
→ verify every expected precondition against pinned current state
→ reject conflicting writes to the same domain field
→ apply patches in event order in memory
→ derive new facts, important events, unresolved threads and story seeds
→ render entity/location/arc timelines
→ render summary/diary/settlement/next-day-seed
→ validate complete candidate Profile
→ publish one commit
```

若语义摘要需要模型生成，`settle()` 在 publication 前运行一个私有 settlement completion；其 Final 必须返回严格 `SettlementSubmissionV1`。模型失败、schema 失败或 patch conflict 时 World 保持 `awaiting-settle`，允许重试。

Settlement record 必须列出：

```ts
interface SettlementRecordV1 {
  schemaVersion: 1;
  day: string;
  eventIds: string[];
  appliedPatches: DomainPatchV1[];
  addedFactIds: string[];
  addedImportantEventIds: string[];
  resolvedThreadIds: string[];
  createdThreadIds: string[];
  createdStorySeedIds: string[];
}
```

Settle commit control：

```text
phase = idle
day = null
lastSettledDay = settled day
```

---

## 11. Revise 与 Abandon

Revise V1 使用 typed operations，而不是任意 document patch。首期允许：

- replace canon snapshot；
- replace entity/location/arc profile；
- create new entity/location/arc；
- update非历史 current state；
- add/remove story seed。

首期禁止：

- 修改 `days/<settled-day>/**`；
- 修改 audit/legacy；
- 删除被事实历史引用的实体；
- 修改 Archive identity/control plane。

Abandon 删除当前 day 的完整 subtree：

```text
days/<current-day>/**
```

因为 Play 尚未 settle，全局 state 未被 Play 修改，所以无需回滚实体状态。这是“Play 记录 proposed patch、Settle 才应用”的直接收益。

---

## 12. Visible transcript audit

新增 Conversation exporter，从 Promptpile writable Conversation 严格读取：

```ts
interface VisibleTranscriptV1 {
  schemaVersion: 1;
  turns: Array<{
    index: number;
    role: 'user' | 'assistant';
    content: string;
  }>;
}
```

只接受规范的交替可见 turns；任何 Thought/Observe/Check 标记、React work path 或非 user/assistant role 使 audit export 失败。audit export 是 submit publication 的一部分；普通 send 不产生 World commit。

Cancel 或 terminal failure 保持 World 不变，因此不归档失败 Session。若未来需要失败审计，应引入独立 runtime diagnostic store，不得借 cancel 发布 World commit。

---

## 13. Legacy migration

新增显式入口，建议放在独立 CLI 命令：

```text
dayloom-core archive migrate-world-profile-v1 \
  --source <legacy-world> \
  --target <new-archive-v2-world>
```

### 13.1 Preconditions

- source 是存在的 regular directory；
- target 经 `classifyWorld()` 必须为 uninitialized；
- source 与 target resolve 后不得相同或互为父子；
- 不跟随 source 内 symlink；发现 symlink 迁移失败；
- migration lock 只位于 target；
- source 全程只读。

### 13.2 Canonical mappings

```text
manifest.yaml                       → Archive manifest + state/world.yaml
current.yaml                        → initial commit control + state/calendar.yaml
canon/user_role.md                  → canon/user-role.md
canon/*                             → canon/*
state/*                             → state/*
characters/*                        → characters/*
scenes/*                            → locations/*
arcs/*                              → arcs/*
memory/*                            → memory/*
days/day_0001/*                     → days/day1/*
.loom/init-transcript/*             → audit/legacy-init/*
logs/*                              → legacy/files/logs/*
exports/*                           → legacy/files/exports/*
其它 portable regular file         → legacy/files/<source-path>
```

对 YAML key/name 和 day ID 的语义转换必须记录 source hash 与 target hash。无法解析但可作为普通文本保留的文件进入 `legacy/**`，不得伪装成 V1 权威文档。

### 13.3 Migration report

```ts
interface MigrationReportV1 {
  schemaVersion: 1;
  sourceFormat: string;
  sourceFileCount: number;
  entries: Array<{
    sourcePath: string;
    sourceSha256: string;
    targetPath: string;
    targetSha256: string;
    mode: 'identity' | 'semantic-transform' | 'legacy-preserve';
  }>;
  warnings: string[];
}
```

报告自身写入 `legacy/migration-report.json`。所有 source regular files 必须恰好出现一次。

### 13.4 Publication

迁移器必须先在内存中建立完整 V1 document set，然后使用一次 Init-style Archive V2 publication 生成 revision 1。read-back、profile validation、inventory equality 全部成功后才报告完成。

任何失败：

- target 不得存在 Published World；
- 尝试清理本次新建 target artifacts；
- source 保持不变；
- cleanup 不完整时 target 分类为 invalid，不得再次 Init 覆盖。

---

## 14. 代码落点

新增：

```text
packages/core/src/world/profile/
  descriptor.ts
  paths.ts
  media.ts
  yaml.ts
  policy.ts
  document-reader.ts
  canon.ts
  state.ts
  entities.ts
  memory.ts
  plan.ts
  event.ts
  settlement.ts
  validate.ts

packages/core/src/world/builders/
  ids.ts
  encode.ts
  init.ts
  planning.ts
  play.ts
  settle.ts
  revise.ts
  audit.ts

packages/core/src/session/
  submission-v2.ts
  settlement.ts

packages/core/src/migration/
  inventory.ts
  legacy-reader.ts
  mappings.ts
  report.ts
  migrate.ts
```

修改：

```text
packages/core/src/world/read.ts
→ 只保留 Archive graph read/classification；委托 profile/validate.ts

packages/core/src/world/publish.ts
→ WorldChange 使用 ArchiveMediaTypeV1；移除 coreOwned 正则；调用 policy

packages/core/src/core.ts
→ 按 descriptor 路由 V0/V1 builder；Settle 调用真正 settlement pipeline

packages/core/src/session/lifecycle.ts
packages/core/src/session/play.ts
→ V1 prompts/submission contracts/context composition

packages/core/package.json
→ 增加 yaml 直接依赖

packages/tui
→ 不改 runtime driver contract；只更新提示文本与必要的 settle pending UI
```

`@dayloom/archive-protocol` 预计无 schema 修改；只允许增加与现有 public contract 一致的测试或导出修正。

---

## 15. 分阶段实施与提交边界

### Phase A：Profile foundation

实现 descriptor、namespace/media policy、YAML helper、verified generic reader、V0/V1 dispatch。

验收：现有 V0 tests 全绿；带额外 V1 文档的 fixture 可 read-back；普通 mutation 保留不相关文档。

### Phase B：Rich Init

实现 InitSubmissionV2、ID allocation、完整 document builder、visible transcript audit。

验收：Init → dispose → restart → Planning context 能看到相同人物、关系、地点、arc、state、facts、seeds。

### Phase C：Rich Planning

实现 PlayPlanV1、依赖验证、planning transcript、完整 World context。

验收：所有 rich planning 字段 round-trip，悬空/cycle dependency 被拒绝。

### Phase D：Event Play

实现 event bundle、DomainPatch、current-day append policy、event read-back。

验收：多事件顺序与引用稳定；Play 不修改全局 state；Abandon 可删除整个未结算 day。

### Phase E：Real Settle

实现 patch precondition、冲突拒绝、state projection、memory/timeline/settlement 输出。

验收：Play → Settle → restart → next Planning/Play 读取上一日造成的变化。

### Phase F：Revise V1

实现 typed revise operations 和历史保护。

验收：允许语义修订，拒绝 settled history/audit/legacy 修改和悬空引用。

### Phase G：Legacy migration

实现 inventory、mapping、legacy preservation、migration report 和 CLI。

验收：legacy fixture 中每个 regular file 恰好映射一次；迁移后 Core 可继续完整生命周期。

每个 Phase 必须独立 build/test/guard 通过，不允许把 A–G 合并为一次不可审查重写。

---

## 16. 测试矩阵

### Protocol/profile

- descriptor absent → V0；valid V1 → V1；unknown version → invalid。
- JSON/YAML duplicate/unknown keys、invalid UTF-8/media type 被拒绝。
- portable collision、duplicate entity ID、index/document mismatch 被拒绝。
- candidate validator 与 startup validator 对同一 fixture 结果一致。

### Init

- empty collections 合法。
- rich entities/relations/locations/arcs/facts/seeds 完整 round-trip。
- local key 转 stable ID 确定性测试。
- transcript 只含 visible user/assistant。
- publication failure 不产生 partial World。

### Planning

- context 包含当前 state/entities/memory/last settlement seed。
- dependency 只能向前引用且无 cycle。
- plan bytes canonical、restart 后相同。

### Play

- event IDs/order 确定性。
- participant/location/beat 引用合法。
- proposed patch 不提前修改 current state。
- 已发布 event 不可覆盖。

### Settle

- patch expected precondition mismatch → World 不变。
- 同一字段冲突写入 → World 不变。
-所有 state/entity/memory/day ending 文档在一个 revision 中出现。
- restart 后 Profile 完整通过。
- next Planning context 包含 settled changes。

### Revise/Abandon

- Revise 不能修改 settled day/audit/legacy。
- 删除被引用 entity 被拒绝。
- Abandon 删除完整 current-day subtree，不改变全局 state。

### Migration

- source symlink/reparse point 被拒绝。
- source/target 相同或嵌套被拒绝。
- 每个 legacy regular file 恰好一条 report entry。
- `user_role.md`、`day_0001`、`scenes/**` 映射正确。
- unknown files 原样进入 legacy。
- migration read-back、hash、relation、Profile 全部验证。
- source bytes 在成功/失败后均不变。

### Lifecycle/resource

- 继续满足现有 single-operation theorem。
- child/provider/summary drain happens-before Session cleanup。
- dispose 后无 Core-owned filesystem access。
- output.delta、state.changed、TUI driver contract 不回退。

---

## 17. 完成定义

只有同时满足以下条件才可把本计划标记为 Implemented：

1. Archive Protocol schema 未被业务 DTO 污染。
2. V0 存档仍可读取；V1 通过 descriptor 明确发现。
3. Rich Init 的人物、关系、地点、arc、state、memory 和 seeds 经 restart 保持一致。
4. Planning 能读取 Rich Init 和最近 settled World，而不是只读取 summary。
5. Play 产生结构化 event facts 和 proposed patches。
6. Settle 在一个 commit 中更新当前世界现态和全部结算派生物。
7. 下一日 Planning/Play 能读取上一日造成的变化。
8. visible transcript 已归档且不含 raw Thought/Observe/Check。
9. legacy migration inventory 无静默遗漏，未知内容得到原样保留。
10. 所有失败均保持 Published World truth，且 terminal cleanup 完成后 Promise 才 settle。
11. `npm run test -w @dayloom/archive-protocol`、`npm run test -w @dayloom/core`、`npm run test -w @dayloom/tui` 全部通过。
12. 至少一个真实 fixture 完成：legacy filesystem → V1 migration → Planning → Play → Settle → restart → next Planning。

最终产品闭环：

```text
Rich Init
→ 世界信息成为 Published World
→ Planning 读取完整现态
→ Play 记录事件事实与候选变化
→ Settle 原子更新现态、记忆和历史
→ restart
→ 下一日继续读取相同世界
```

达到以上条件后，Core 才可以声明：Archive V2 不仅保存不可变文件历史，也完整承载并延续早期 filesystem World 的世界语义。
