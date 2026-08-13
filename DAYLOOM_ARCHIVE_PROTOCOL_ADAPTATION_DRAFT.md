# Dayloom Core → Archive Protocol 适配实施冻结草案

> 状态：Implemented / Freeze candidate（待 CI 跨平台证据）
> 日期：2026-08-13  
> 实施顺序：**Phase 1B / 3**  
> 前置：`ARCHIVE_PROTOCOL_PACKAGE_DRAFT.md`  
> 后续：`PERSISTENT_CONVERSATION_COMPRESSION_DRAFT.md`、`PROMPTPILE_AGENT_RUNTIME_DRAFT.md`  
> 原则：`@dayloom/core` 直接依赖 `@dayloom/archive-protocol`；本阶段不创建 `@dayloom/archive` runtime package。

> 实施证据：默认 Runtime 已切换 Archive V2；Session/WorldOperation 一一绑定；prepare/publish/GC/restart/fault/concurrency 测试位于 `packages/core/test/archive-v2/`；Linux/Windows、Node 18/22 的 Protocol/Core/TUI 门禁位于 `.github/workflows/archive-protocol.yml`。旧 V1 仅保留为显式注入的 deprecated compatibility path，不参与默认运行时。

## 1. 一句话结论

Phase 1B 只解决一个问题：

> **Dayloom Core 如何从当前强类型 Archive V1 迁移到 Archive Protocol V2，同时继续安全拥有 filesystem transaction/runtime，并把 World semantic data 改造成文档原生模型。**

最终依赖：

```text
@dayloom/archive-protocol
          ↑
      @dayloom/core
          ↑
      @dayloom/tui
```

Core 继续拥有：

```text
filesystem Archive repository
operation workspace
staging physical files
publish lock / OCC
immutable object publication
atomic current replacement
inspect / GC execution
Dayloom World Profile
mutation policy
state machine / Session / gameplay
```

Core 不再拥有：

```text
Archive V2 data shapes
path identity
canonical tree encoding
hash semantics
protocol parsers
staging data contract
operation data contract
cross-object protocol relations
recovery classification rules
```

这些必须来自 `@dayloom/archive-protocol` public exports。

---

## 2. 本阶段明确不做什么

不实现：

```text
@dayloom/archive runtime package
Promptpile persistent Conversation
promptpile-compress
promptpile-react
promptpile-mcp
branch manager
rollback CLI
V1/V2 long-term dual runtime
```

这些能力即使未来存在，也不能扩大 Phase 1B correctness surface。

特别是：

```text
Core direct-depends Protocol
```

是本阶段有意边界，不要求为了理论纯度再拆一层 Archive runtime package。

---

## 3. 本阶段的三个核心状态机

Phase 1B 不再把 correctness 分散成多个模糊流程。

真正需要实现并证明的只有三个 durable state machine：

```text
A. Session / ArchiveOperation
B. Staging / Prepare
C. Publication
```

它们分别拥有唯一 visibility switch：

```text
staging/index.json
= staged state visibility switch

operation.json status=open→prepared
= prepared candidate visibility switch

current.json
= Published World visibility switch
```

总原则：

> **每一个 durable state 都有唯一 authority；每一个 state transition 都有唯一 visibility switch；每一个 crash point 都能从 durable facts 唯一分类。**

---

## 4. 从当前实现保留什么

当前 Archive V1 已经验证了一套值得继承的 publication theorem：

```text
isolated workspace
→ validate
→ publish lock
→ expected-base re-check
→ immutable objects first
→ FINAL current replacement
```

Phase 1B 保留：

- `current` 是唯一 Published World authority；
- operation workspace 隔离；
- publish lock；
- optimistic conflict/base check；
- immutable object first/current last；
- crash 可以留下 garbage，不可留下 visible partial state；
- operation metadata 只做 durable workflow/diagnostic authority，不替代 `current`；
- logs 非权威；
- inspect/GC 基于引用图；
- Runtime mutation lock 与跨进程 Archive publish lock 分层。

不重新发明 publication primitive。

---

## 5. 从当前实现删除什么

Archive V1 当前把 narrative/domain schema 固化到 Archive：

```text
CanonDocuments
canonRevision
DayRevision
DayHead
PlanDocument
PlayDocument
PlayEventDocument
SettlementDocument
AbandonedDocument
InitSubmission
PlanningSubmission
PlaySubmission
ReviseSubmission
activeSession in ArchiveCommit
start-session commit
cancel-session commit
```

Phase 1B 完成后，这些不得继续作为 Archive canonical read/write schema。

Archive 内容模型统一成：

```text
CurrentPointerV2
→ ArchiveCommitV2
→ RootTreeV1
→ Blob(s)
```

Core Archive runtime 只理解：

```text
protocol objects
+ filesystem transaction
```

不再让 archive schema 理解人物、场景、计划、事件等 narrative ontology。

---

## 6. Truth domains

Phase 1B 冻结三个 truth domain：

```text
1. Published World
   = current → commit → tree → blobs

2. Session Workspace
   = CoreSessionRecord
   + one ArchiveOperationV2
   + its staging overlay

3. AI Conversation
   = Phase 2/3 owned
```

必须成立：

```text
AI text
≠ World fact

Session message
≠ World fact

staged file alone
≠ staged fact

prepared target graph alone
≠ Published World

current atomically advances
= Published World changed
```

---

## 7. Core 与 Protocol ownership

### 7.1 Protocol owns meaning

Core 必须直接 import public exports：

```text
ArchiveManifestV2
CurrentPointerV2
ArchiveCommitV2
PublishedWorldPhase
RootTreeV1
DocumentTreeEntryV1
StagingManifestV1
ArchiveOperationV2
ArchiveOperationErrorV1
```

以及至少：

```text
protocol parsers
path normalization / validation
portable collision
content/blob validation
canonical tree encoder/hash
applyStagedChangesV1
buildCandidateTreeV1
validateCurrentCommitRelationV2
validateCommitParentRelationV2
validateOperationStagingRelationV2
validatePreparedTargetRelationV2
recovery classification
archive-relative layout helpers
```

Core 不得重新手写这些不变量。

### 7.2 Core owns side effects

Core Archive runtime 执行：

```text
resolve worldRoot
read/write files
validate physical object existence
symlink/path escape prevention
operation workspace lifecycle
Session workspace lifecycle
publish lock lifecycle
PID/token stale-lock handling
OCC
write temp
flush/fsync
atomic rename/replace
repair diagnostic metadata
GC deletion
```

关键边界：

```text
Protocol tells Core what Archive facts mean.
Core proves that filesystem mutation realizes those facts safely.
```

---

## 8. ID ownership：Command Operation 与 World Operation 必须分离

当前 Runtime 的一次 command 会拥有 correlation id；长期 Session 也需要一个 durable ArchiveOperation id。

这两个概念不得继续混用。

定义：

```text
RuntimeCommandOperationId
= 一次 Runtime command/event correlation id

WorldOperationId
= ArchiveOperationV2.id
= 一次 durable World mutation lifecycle identity
```

对于 Session：

```text
one Session
→ exactly one WorldOperationId
```

因此：

```text
start Session
→ create ArchiveOperation(open)

sendInput
→ mutate SAME ArchiveOperation staging

sendInput
→ mutate SAME ArchiveOperation staging

/submit
→ prepare SAME ArchiveOperation
→ publish SAME ArchiveOperation

/cancel
→ abort SAME ArchiveOperation
```

禁止：

```text
start Session → op_A
submit Session → op_B
```

否则 pinned base/staging/candidate 会失去统一 authority。

对于一次性稳定命令：

```text
settle
abandon-day
```

可以由一次 command 创建一次 WorldOperation，但仍应在类型/字段上保持两个 ID 的概念区分。

---

## 9. Core-owned durable Session authority

删除 `ArchiveCommit.activeSession` 后，Session lifecycle 不能退化为纯内存状态。

Phase 1B 必须拥有一个 **Core-owned durable Session record**，它不属于 Archive Protocol。

概念上至少包含：

```ts
interface CoreSessionRecordV1 {
  schemaVersion: 1;
  sessionId: string;
  kind: 'init' | 'planning' | 'play' | 'revise';
  archiveOperationId: string;
  status: 'active' | 'submitting' | 'completed' | 'cancelled' | 'interrupted';
  createdAt: string;
  updatedAt: string;
}
```

具体文件名可以由 Core 实现决定，但 authority 必须唯一、durable、可重新发现。

第一版冻结：

```text
one World
→ at most one active gameplay Session
```

该约束由 Core Session authority 管理，不进入 ArchiveCommit。

因此 restart 时：

```text
read Published World
+
read durable CoreSessionRecord
+
read referenced ArchiveOperation/staging
→ reconstruct Runtime presentation phase
```

必须能区分：

```text
no active Session
active recoverable Session
completed Session requiring diagnostic reconciliation
invalid/corrupt Session workspace
```

Session lifecycle 不修改 Published World，但 Session 自己仍必须 durable。

---

## 10. Runtime phase projection

Protocol Commit 只保存稳定 Published state：

```text
idle
planned
awaiting-settle
```

Runtime-only phase：

```text
initializing
planning
playing
revising
invalid
```

Runtime phase 必须由：

```text
archive read status
+ PublishedWorldPhase
+ CoreSessionRecord kind/status
→ Runtime presentation phase
```

例如：

```text
Published = idle
Session kind = planning + active
→ Runtime = planning
```

```text
current absent
Session kind = init + active
→ Runtime = initializing
```

```text
archive/session invalid
→ Runtime = invalid
```

必须成立：

```text
Session lifecycle
≠ Published World lifecycle
```

---

## 11. Session start/cancel state machine

### 11.1 Start

```text
validate command availability
↓
create ArchiveOperationV2(open) with pinned base
↓
create CoreSessionRecord(active) referencing operation
↓
create Session workspace
↓
activate RuntimeSession
↓
Published World unchanged
```

如果 start 在 authority 创建过程中 crash，restart 必须通过 durable artifacts 分类：

```text
operation exists + Session record exists
→ recoverable Session candidate

operation exists + Session record absent
→ incomplete start / administrative cleanup candidate
```

不得通过发布一个 World commit 来表达 Session 活跃状态。

### 11.2 Cancel

```text
stop/await background Session task
↓
ArchiveOperation open → aborted
↓
CoreSessionRecord → cancelled
↓
cleanup workspace according retention policy
↓
Published World unchanged
```

cancel 不产生 World revision。

---

## 12. Archive V2 physical layout

Core 按 protocol layout vocabulary 实现 Archive objects；Core-owned Session metadata 与 Archive Protocol metadata 分离。

```text
<world-root>/
├── manifest.json
├── current.json
├── commits/
├── objects/
│   ├── trees/sha256/
│   └── blobs/sha256/
├── operations/
│   └── <world-operation-id>/
│       ├── operation.json
│       └── workspace/
│           ├── session.json        # Core-owned Session record/workspace metadata
│           └── staging/
│               ├── index.json
│               └── files/<opaque-id>
├── .locks/
└── logs/
```

`session.json` 不是 Archive Protocol object；它属于 Core runtime contract。

逻辑 World path 永远不直接拼成 object-store path。

Core 使用 protocol relative-layout helpers，再由 filesystem layer 安全解析到 `worldRoot` 内。

必须验证：

```text
resolved physical target ∈ worldRoot
```

并防止 symlink/path traversal escape。

---

## 13. Mutable metadata atomicity theorem

Phase 1B 有三个 mutable authority：

```text
staging/index.json
operation.json
current.json
```

它们都必须通过：

```text
write temporary
→ flush file
→ atomic replace/rename
→ sync parent directory
```

更新。

禁止直接 truncate-and-overwrite canonical metadata。

三个 visibility switch：

```text
staging/index.json replacement
= staged fact changed

operation.json open→prepared replacement
= prepared candidate became durable authority

current.json replacement
= Published World changed
```

允许相应阶段留下 unreachable garbage；不允许 canonical mutable metadata 指向 incomplete data。

CoreSessionRecord 若作为独立 mutable authority，也必须使用同等级 atomic update theorem。

---

## 14. Manifest create-once theorem

`manifest.json` 是稳定 Archive identity，不在 `current` 引用图里，因此必须有独立的一次性语义。

冻结：

```text
manifest is create-once
```

规则：

```text
manifest absent
→ initialization may create expected manifest atomically

manifest exists
→ parse and validate
→ require same world identity expected by this initialization
→ never overwrite with a different identity
```

因此：

```text
manifest exists + current absent
= provisional initialization
```

同一初始化 retry 可以复用一致 manifest；不同 identity 初始化必须 conflict/fail-closed。

必须成立：

```text
current exists
⇒ manifest exists and valid
```

禁止：

```text
Init A writes manifest A
Init B overwrites manifest B
Init A publishes current
```

`manifest.json` 不得用普通 overwrite 写法实现初始化竞争。

---

## 15. Dayloom World Profile v1

Archive Protocol 不拥有 narrative schema，但 Core 必须冻结一个最小 product vocabulary，避免 Session/MCP/TUI 各自猜路径。

第一版 canonical path family：

```text
canon/premise.md
canon/rules.md
canon/style.md
canon/user-role.md

days/<day>/plan.md
days/<day>/play.md
days/<day>/summary.md

characters/**
scenes/**
arcs/**
memory/**
custom/**
```

其中：

```text
canon/*.md
= canonical semantic documents

days/<day>/*.md
= canonical per-day workflow/history documents

characters/** / scenes/** / arcs/** / memory/** / custom/**
= extensible semantic namespace
```

新增普通文档路径不应要求修改 Archive Protocol object model。

如后续需要 JSON/YAML 文件，只扩展 World Profile convention，不修改 Blob/Tree/Commit schema。

### 15.1 Required-by-operation policy

Archive core 不定义全局 required documents；Core business operation 定义提交前置。

概念上：

```text
init submit
→ requires canon/premise.md
          canon/rules.md
          canon/style.md
          canon/user-role.md

planning submit
→ requires days/<current-day>/plan.md

play submit
→ requires days/<current-day>/play.md
        + days/<current-day>/summary.md
```

具体内容由 AI/human 解释，Core 只验证 required path/media/policy 是否满足。

---

## 16. Dayloom mutation policy

Protocol staging 只拥有 PUT/DELETE；Core 在写 staging 之前执行产品 policy。

第一版 path-family policy：

```text
canon/**
→ replaceable semantic documents

characters/**
scenes/**
arcs/**
memory/**
custom/**
→ replaceable semantic documents unless a higher business rule narrows it

days/<day>/plan.md
→ replaceable before publication for that operation

days/<day>/play.md
days/<day>/summary.md
→ append/history-oriented; once published for historical day, ordinary gameplay must not silently rewrite

reserved/internal physical paths
→ inaccessible through World document mutation API
```

如果需要保存用户原始 source/input，必须给它独立的 append-only/immutable path convention；不能依赖 AI semantic summary 作为原文 authority。

原则：

```text
Protocol validates structural legality.
Core validates Dayloom business permission.
```

未来普通 MCP gameplay tools 只能调用 Core/domain capabilities，不能直接编辑 operation files。

---

## 17. Staging write state machine

### 17.1 Staging authority

```text
StagingManifestV1 (index.json)
= sole staged truth
```

`workspace/staging/files/*` 里的文件只有被 `index.json` 引用时才是 staged fact。

### 17.2 PUT

```text
normalize/validate path via Protocol
↓
Core mutation policy
↓
validate bytes/media via Protocol
↓
write opaque staging temp file
↓
flush
↓
atomic promote opaque staging file
↓
verify bytes/hash
↓
construct next StagingManifestV1
↓
Protocol parse/validate
↓
ATOMIC index.json replacement
```

Crash before final index switch：

```text
old staging remains authoritative
new unreferenced file = garbage
```

Crash after index switch：

```text
new staged mutation must be complete/readable
```

### 17.3 DELETE

DELETE 只修改 next manifest；同样通过 atomic `index.json` replacement 生效。

### 17.4 Final-state algebra

同一路径只保存最终 mutation：

```text
PUT
DELETE
or no entry
```

它不是 edit log。

---

## 18. Effective read model

Published read：

```text
current
→ commit
→ root tree
→ blob
```

Session effective read：

```text
staged PUT
  > staged DELETE
  > published entry
```

Core 对上层暴露能力：

```text
readPublishedDocument(path)
listPublishedDocuments()
readEffectiveDocument(worldOperationId, path)
listEffectiveDocuments(worldOperationId)
inspectStaging(worldOperationId)
```

未来 Session/MCP/TUI 只能包装这些 capability，不直接扫描 object store/staging internals。

---

## 19. Prepare state machine

Prepare 只允许：

```text
ArchiveOperation.status == open
```

流程：

```text
read + protocol-parse operation
↓
read + protocol-parse staging
↓
validateOperationStagingRelationV2
↓
freeze staging authority for this operation
↓
verify every staged PUT physical file hash/bytes/media
↓
load pinned base tree
↓
buildCandidateTreeV1({ baseTree, staging })
↓
construct/deduplicate immutable blobs
↓
write canonical RootTree bytes via Protocol encoder/hash
↓
construct immutable ArchiveCommitV2
↓
validatePreparedTargetRelationV2
↓
persist immutable target graph completely
↓
construct ArchiveOperationV2(status=prepared, target ids)
↓
ATOMIC operation.json replacement
```

必须成立：

```text
prepared
⇒ exactly one pinned base
⇒ exactly one frozen staging final state
⇒ exactly one target tree
⇒ exactly one target commit
⇒ complete target graph already durable
```

因此：

```text
operation.json prepared
```

是 prepared candidate 的唯一 visibility switch。

prepared 后普通 PUT/DELETE 必须拒绝。

需要继续编辑：

```text
abort old operation
→ create new operation pinned to an explicit base
```

---

## 20. Immutable object retry/idempotency

Prepare crash 后允许部分 immutable objects 已存在。

因此 immutable object publication 必须是 idempotent-by-identity：

```text
blob/tree target absent
→ create without overwrite

blob/tree target exists
→ verify expected hash/bytes
→ identical = success/dedup
→ mismatch = integrity failure
```

Commit object：

```text
commit target absent
→ create without overwrite

commit target exists
→ parse and require exact expected commit
→ identical = retry success
→ different content = ID collision/integrity failure
```

禁止：

```text
immutable target exists
→ blindly overwrite
```

也不应把“identical object already exists”一律当 conflict，否则 crash retry 无法闭环。

---

## 21. Publication state machine

Publication 只允许：

```text
ArchiveOperation.status == prepared
```

流程：

```text
read + parse prepared operation
↓
read target commit/tree/blobs
↓
validate prepared target graph
↓
acquire publish lock
↓
re-read current
↓
require current == pinned base
↓
validate parent/current relation as applicable
↓
re-verify target immutable graph
↓
construct next CurrentPointerV2
↓
validateCurrentCommitRelationV2({ current: nextPointer, commit: targetCommit })
↓
write current temp
↓
flush
↓
FINAL ATOMIC current replacement
↓
sync parent directory
↓
Published World changed
↓
best-effort reconcile operation.json → published
↓
best-effort Session completion diagnostics
↓
release lock
```

锁只覆盖 publication critical section，不覆盖长期 Session/staging。

---

## 22. Publication theorem

成功：

```text
publish success
⇒ current references target commit
⇒ target commit is complete/immutable
⇒ target tree is canonical/hash-valid
⇒ every referenced blob exists and hash matches
⇒ target tree == buildCandidateTreeV1(pinned base, frozen staging)
⇒ target commit satisfies Protocol relation validators
⇒ pinned base was still current at visibility switch
```

失败：

```text
failure before current replacement
⇒ previous Published World remains current
```

允许：

```text
unreachable immutable blobs/tree/commit
unreferenced staging files
```

禁止：

```text
partially visible Published World
canonical staging index referencing incomplete staged file
prepared operation referencing incomplete target graph
```

核心原则：

> **garbage is allowed; corrupt visible state is not.**

---

## 23. OCC / conflict

Core publication 必须同时满足：

```text
exclusive publication ownership
AND
current == pinned base
```

若 current 已变化：

```text
ARCHIVE_CONFLICT
no current mutation
prepared operation preserved
staging preserved
candidate preserved
```

第一版不自动 merge/rebase。

冲突后的下一步由上层显式决定：

```text
retry same prepared candidate only if base condition again valid
or abort
or create new operation against newer base
```

不得自动重新解释 semantic intent。

---

## 24. Operation failure / retry semantics

Protocol statuses：

```text
open
prepared
published
aborted
```

没有 terminal `failed`。

错误通过：

```text
ArchiveOperationErrorV1
```

持久化。

规则：

```text
staging/validation failure before prepare
→ status remains open
→ lastError source=protocol|runtime|tool
```

```text
prepare I/O failure before prepared visibility switch
→ status remains open
→ partial immutable garbage allowed
→ explicit prepare retry recomputes SAME candidate from unchanged staging authority
```

```text
publication failure after prepare, before current switch
→ status remains prepared
→ lastError updated
→ explicit retry uses SAME target ids
```

```text
current == target after crash
→ Protocol recovery classifier returns already-published
→ Core may repair diagnostics to published
```

---

## 25. Crash / recovery theorem

Recovery：

```text
= classify durable facts
≠ guess semantic intent
≠ automatically build a different target
≠ silently overwrite newer current
```

Core 收集 facts；Protocol 做纯关系验证/分类。

Prepared operation：

```text
current == target
→ publication happened

current == pinned base
→ target not published
→ explicit retry/discard allowed

current != base && current != target
→ superseded/conflicted
→ no automatic replay
```

Open operation：

```text
staging/index.json
= current staged authority

unreferenced staging files
= garbage

immutable target-like objects without prepared operation reference
= garbage unless another root retains them
```

Session recovery：

```text
CoreSessionRecord active/submitting
+ referenced operation open/prepared
→ reconstruct recoverable Session boundary
```

如果 AI Conversation 尚未进入 Phase 2 持久化，本阶段可以恢复 Session workspace/control state，但不声称能恢复尚未持久化的模型上下文；该限制必须显式暴露，不得伪装完整 conversational recovery。

---

## 26. Inspect

`inspectArchive()` 执行 I/O；Protocol 提供 parsers/hash/graph relations。

至少检查：

```text
manifest
current
current commit
parent chain
root tree canonical hash
path identity/collision
blob existence/hash/bytes
published control
operations
operation ↔ staging relation
prepared target relations
CoreSessionRecord ↔ operation relation
orphan immutable objects
protected prepared target objects
```

Inspection 必须区分：

```text
Protocol invalid
filesystem/reference missing
Core Session metadata invalid
prepared-but-unpublished
true orphan garbage
```

Inspection 只读。

---

## 27. GC reachability theorem

GC roots 不能只有 `current`。

正式 roots：

```text
A. Published roots
   current
   → retained commit parent chain
   → root trees
   → blobs

B. Prepared-operation roots
   every valid ArchiveOperation(status=prepared)
   → target commit
   → target root tree
   → blobs
```

因此：

```text
prepared target graph
≠ orphan
```

必须保留。

Workspace retention：

```text
open
prepared
→ preserve operation/staging workspace

published
aborted
→ cleanup only under explicit retention policy
```

True orphan immutable objects 才可以删除。

真实删除：

```text
default dry-run/report first
explicit delete required
mutually exclusive with publication
re-evaluate roots under deletion lock/ownership
```

GC 永远不能删除 current-reachable 或 prepared-operation-reachable objects。

---

## 28. Initialization state machine

Init 同时涉及 Archive identity 与 first publication。

```text
create ArchiveOperation(open, baseRevision=0)
↓
create CoreSessionRecord(init, active)
↓
Session stages required World Profile documents
↓
submit
↓
create-or-verify manifest (create-once)
↓
prepare candidate root/commit revision=1
↓
publish current revision=1
↓
Session completed
```

必须处理：

```text
manifest exists + current absent
→ same identity retry allowed

manifest exists with different identity
→ conflict

current exists
→ second initialization forbidden
```

---

## 29. Dayloom business operation mapping

### init

输出 World Profile docs + initial published control：

```text
phase = idle
initial day according product rule
lastSettledDay = null
```

一次 publication。

### planning

对同一 Session operation staging：

```text
days/<day>/plan.md
```

submit 时 publish：

```text
phase = planned
day = current day
```

### play

对同一 Session operation staging 更新：

```text
days/<day>/play.md
days/<day>/summary.md
```

以及允许的其它 semantic docs。

submit publish：

```text
phase = awaiting-settle
```

### settle

一次性 WorldOperation：

```text
update settlement/history semantic documents if required
phase = idle
day = nextDay(day)
lastSettledDay = settled day
```

### abandon-day

一次性 WorldOperation：

```text
record abandoned/history fact as documents
update published control deterministically
```

### revise

同一 Session operation 直接 staging semantic documents；不再重建完整 `CanonDocuments` object。

具体 AI 文本格式不进入 Archive Protocol schema。

---

## 30. Legacy SessionSubmission 过渡边界

Phase 1B 可以短期保留当前强类型 `SessionSubmission` 作为**单向 adapter input**，以降低一次性迁移风险：

```text
legacy SessionSubmission
→ deterministic World Profile document mutations
→ V2 staging
```

禁止：

```text
V2 documents
→ rebuild V1 CanonDocuments/DayRevision
```

禁止长期 dual-write：

```text
V1 Archive
+
V2 Archive
```

Freeze 前必须删除 modern canonical write path 上的 V1 archive/submission builders。

Phase 3 最终让 AI 直接通过 Dayloom tools 操作 staging；Phase 1B 不依赖它。

---

## 31. V1 → V2 cutover

第一选择：明确 breaking cutover。

```text
modern Core V2 reader accepts Archive V2 only
V1 Archive code removed from modern runtime path
```

如果需要旧 demo/world：

```text
explicit one-shot migration tool
```

禁止：

```text
open world
→ silently guess V1/V2
→ keep both runtimes forever
```

Schema version mismatch fail-closed。

---

## 32. Core public capability boundary

Phase 1B 后 Core 至少概念上拥有：

```text
readCurrentWorld()
readPublishedDocument(path)
listPublishedDocuments()

startWorldSession(...)
readSessionRecord(...)

stagePut(worldOperationId, ...)
stageDelete(worldOperationId, ...)
inspectStaging(worldOperationId)
readEffectiveDocument(worldOperationId, path)
listEffectiveDocuments(worldOperationId)

prepare(worldOperationId)
publish(worldOperationId)
discard(worldOperationId)

inspectArchive()
collectGarbage()
```

是否全部公开给外部 package 由 Core API 设计决定；内部 ownership 必须围绕这些 capability，而不是 `stageCanon/stageDay`。

---

## 33. Architecture guard

必须增加 guard，证明：

### Core consumes Protocol publicly

禁止：

```text
@dayloom/archive-protocol/dist/*
relative imports into packages/archive-protocol/src
```

### Core does not duplicate Protocol

不得另定义等价：

```text
ArchiveManifestV2
CurrentPointerV2
ArchiveCommitV2
RootTreeV1
StagingManifestV1
ArchiveOperationV2
WorldDocumentPath canonical rules
canonical tree hash rules
cross-object protocol relations
```

### Protocol remains pure

Protocol 不反向 import Core。

### Session metadata stays Core-owned

`CoreSessionRecord` 不进入 archive-protocol package，除非未来有独立 admission 决策。

---

## 34. Executable evidence

Phase 1B Formal Freeze 至少需要以下证据。

### Protocol consumer conformance

```text
Core reads protocol golden Archive
→ same hashes/paths/control
```

### Session / operation identity

```text
start Session
→ one WorldOperation

multiple input turns
→ same WorldOperation

submit
→ same WorldOperation prepared/published

cancel
→ same WorldOperation aborted
→ current unchanged
```

### Session restart

```text
start Session
→ restart process
→ Session record + operation discoverable
→ Runtime phase reconstructed deterministically
```

### Staging crash boundaries

Fault inject：

```text
before staged file write
after staged file durable before index switch
after index switch
```

必须证明：

```text
before index switch → old staging

after index switch → complete new staging
```

### Prepare crash boundaries

Fault inject：

```text
after blob write
after tree write
after commit write
before operation prepared switch
after operation prepared switch
```

必须证明：

```text
before prepared switch
→ operation remains open
→ target garbage allowed
→ prepare retry deterministic

after prepared switch
→ complete target graph exists
```

### Publication

```text
stage PUT/DELETE
→ prepare
→ publish
→ restart
→ same Published World
```

### Conflict

```text
op A pins C1
op B publishes C2
op A publish
→ conflict
→ C2 remains current
→ A staging/candidate preserved
```

### Publication crash boundaries

至少：

```text
before current temp
before current replace
after current replace before operation reconciliation
after current replace before Session finalization
```

restart 后必须由 durable facts 唯一分类。

### Manifest initialization

```text
crash after manifest create before current
→ same init retry succeeds

different manifest identity
→ conflict
```

### Immutable idempotency

```text
expected immutable object already exists identically
→ retry succeeds

same path/id with mismatched bytes/object
→ fail closed
```

### GC prepared protection

```text
prepared operation exists
→ run GC delete mode
→ prepared target commit/tree/blobs survive
```

### Path portability

Windows/Linux 对 NFC、case collision、reserved names、portable chars 结果一致。

### Legacy exit

modern runtime 不再依赖 V1 canon/day/archive canonical schema。

---

## 35. CI gate

Phase 1B 至少运行：

```text
@dayloom/archive-protocol build/test
@dayloom/core build/test
Core ↔ protocol conformance
Archive V2 staging/prepare/publication fault tests
Session restart/recovery tests
GC prepared-root tests
TUI compatibility build/test
```

跨平台至少覆盖当前 Dayloom 声明的平台。

Phase 1B 不偷偷提升 Node floor；若后续 Promptpile integration 要求更高 Node 版本，应在相应阶段显式修改 package theorem/CI。

---

## 36. Final acceptance checklist

- [ ] Core 直接依赖 `@dayloom/archive-protocol` public exports。
- [ ] 本阶段没有 `@dayloom/archive` package。
- [ ] Archive filesystem runtime 仍由 Core 拥有。
- [ ] V2 types/parser/hash/path/tree/relations 不在 Core 重复实现。
- [ ] `RuntimeCommandOperationId` 与 durable `WorldOperationId` 概念分离。
- [ ] one Session → exactly one ArchiveOperationV2。
- [ ] CoreSessionRecord 是唯一 durable active Session authority。
- [ ] restart 可以从 Session record + operation + Archive 恢复 Runtime presentation phase。
- [ ] `PublishedWorldPhase` 与 Runtime/Session phase 分离。
- [ ] start/cancel Session 不发布 World commit。
- [ ] `staging/index.json` 是唯一 staged visibility switch。
- [ ] `operation.json` prepared switch 是唯一 candidate visibility switch。
- [ ] `current.json` 是唯一 Published World visibility switch。
- [ ] staging/index、operation、current 使用 atomic replace + parent sync。
- [ ] manifest create-once，不能被并发初始化覆盖。
- [ ] World Profile v1 的 canonical path family 与 required-by-operation convention 已冻结。
- [ ] mutation policy 已映射到 path families。
- [ ] staging 只有 PUT/DELETE final-state overlay。
- [ ] prepare 调用 `validateOperationStagingRelationV2` + `buildCandidateTreeV1`。
- [ ] prepared target 调用 `validatePreparedTargetRelationV2`。
- [ ] current/commit 使用 `validateCurrentCommitRelationV2`。
- [ ] prepared candidate immutable。
- [ ] immutable object retry idempotent-by-identity，不 blind overwrite。
- [ ] publish lock + expected-base OCC 同时成立。
- [ ] conflict preserve staging/candidate。
- [ ] crash/recovery 只根据 durable facts 分类。
- [ ] GC roots 包含 Published graph + every prepared target graph。
- [ ] inspect 能区分 prepared-retained 与 true orphan。
- [ ] V1 canon/day/submission 不再是 modern canonical Archive write schema。
- [ ] 无 V1/V2 长期 dual-write。
- [ ] restart/fault/concurrency tests green。
- [ ] Windows/Linux evidence green。
- [ ] TUI 不理解 object store/staging internals。
- [ ] Phase 2 可以只依赖稳定 World/Session boundary，不修改 Archive V2。

---

## 37. Phase 1B Freeze theorem

最终 Core 必须证明：

```text
Dayloom Published World
= Protocol-valid current referenced immutable graph
```

Publication：

```text
Core successful publication
⇒ Protocol-valid target graph
⇒ pinned base still current at visibility switch
⇒ FINAL current replacement occurred once
⇒ no partial World was visible
```

Staging：

```text
Staged World
= StagingManifestV1 referenced durable files
```

Prepare：

```text
ArchiveOperation.status == prepared
⇒ exactly one complete immutable target graph exists
```

Session：

```text
one active Session
⇒ exactly one CoreSessionRecord
⇒ exactly one referenced ArchiveOperation
```

并且：

```text
Session lifecycle
≠ Published World lifecycle
```

Manifest：

```text
manifest identity is create-once
```

GC：

```text
GC may delete only objects unreachable from
Published roots ∪ prepared-operation roots
```

Semantic extensibility：

```text
new ordinary semantic document path
⇒ no Archive Protocol object-model change
⇒ no Core Archive transaction-schema change
```

Package boundary：

```text
@dayloom/archive-protocol
= Archive meaning

@dayloom/core
= Archive side effects
+ Core Session authority
+ Dayloom World Profile/policy
+ game/runtime semantics
```

这就是 Phase 1B 的实现闭环。

---

## 38. 实施顺序

不要一次性同时迁移 Archive、Session、全部 gameplay operations。

推荐顺序：

```text
1B-1
Protocol dependency
+ V2 read repository
+ manifest/current/commit/tree/blob validation

1B-2
CoreSessionRecord
+ Session ↔ WorldOperation identity
+ Runtime phase projection

1B-3
staging storage
+ atomic index
+ effective read

1B-4
prepare state machine
+ immutable object idempotency
+ atomic prepared switch

1B-5
publication/OCC
+ recovery classification

1B-6
inspect/GC
+ prepared target roots

1B-7
World Profile/mutation policy
+ legacy Submission → document adapter

1B-8
init/planning/play/settle/abandon/revise cutover
+ remove start/cancel World commits

1B-9
remove V1 canonical write/read path
+ adversarial evidence
+ CI

→ Phase 1B Freeze
```

每个子阶段必须保持仓库可 build/test，禁止长期维持两个 canonical World authorities。

---

## 39. Phase 2 / Phase 3 handoff

Phase 1B Freeze 后，Phase 2 可以假设：

```text
Published World stable
CoreSessionRecord stable
one Session ↔ one WorldOperation stable
staging/effective read stable
```

然后只引入 persistent Promptpile Conversation + compression。

Phase 3 可以假设：

```text
MCP tools
→ Core World/Profile mutation capabilities
→ SAME Session WorldOperation staging
```

而不是：

```text
MCP
→ directly edit archive object store
```

普通 Agent gameplay path 永远经过 Core mutation policy。

---

## 40. Freeze 后文档治理

完成后：

1. Archive Protocol 当前事实进入 canonical protocol docs/package README；
2. Core World/Profile/Session/transaction ownership 进入 canonical Core architecture docs；
3. 删除 `ARCHIVE_PROTOCOL_PACKAGE_DRAFT.md` 与本适配草案；
4. tests/fixtures/CI 成为 executable evidence；
5. Git history 保存 V1 → V2 transformation history。

目标：

```text
protocol docs + package
= Archive disk/data truth

core architecture docs
= runtime/session/game ownership truth

plans
= temporary implementation authority only
```
