# Dayloom Core → Archive Protocol 单写者适配修复冻结

> 状态：**Architecture Correction Freeze / 当前实现需按本文收敛**  
> 日期：2026-08-13  
> 实施顺序：**Phase 1B / 3**  
> 前置：`ARCHIVE_PROTOCOL_PACKAGE_DRAFT.md`  
> 后续：`PERSISTENT_CONVERSATION_COMPRESSION_DRAFT.md`、`PROMPTPILE_AGENT_RUNTIME_DRAFT.md`  
> 边界：`@dayloom/core` 直接依赖 `@dayloom/archive-protocol`；本阶段不创建 `@dayloom/archive` runtime package。

> **纠偏说明**：上一版 Phase 1B 把 Archive 格式正确、Dayloom gameplay runtime、任意多进程 writer 并发、在线 GC、Session 自动恢复、filesystem power-loss durability 同时纳入 Freeze surface，导致当前实现演化出 `publish.lock + session-claim.lock + operation.lock`、多套 recovery/reconciliation 与大量交叉状态机。该方向技术上可以继续补强，但已经偏离 Dayloom 当前真正需要的 local-first World runtime。本文重新冻结目标：**用更小的状态空间获得更强、更容易证明的闭环。**

---

## 1. 一句话结论

Phase 1B 最终目标不是一个通用并发事务数据库，而是：

```text
Dayloom Core Phase 1B
= Archive Protocol V2 的 single-writer local World runtime adapter
```

它必须做到：

```text
one World
→ at most one mutation owner

Published World
= current
→ immutable commit
→ immutable tree
→ immutable blobs

Session
→ one ArchiveOperation
→ one staging authority

process crash
→ Published truth remains uniquely readable
→ unfinished Session/workspace is preserved as interrupted

mutating maintenance
→ exclusive / offline with gameplay writer
```

核心设计原则：

> **不要为不需要存在的并发状态写补丁；通过 ownership contract 让这些状态根本无法产生。**

---

## 2. Phase 1B 真正需要保证什么

### 2.1 强保证

Phase 1B 必须保证：

```text
Protocol-valid Archive facts
single writer ownership
pinned-base staging
immutable candidate graph
current sole publication authority
process-crash consistency
Session workspace durability/preservation
safe physical path boundary
explicit maintenance ownership
```

### 2.2 本阶段明确不保证

以下全部退出 Phase 1B Formal Freeze：

```text
multiple concurrent World writers
online GC delete concurrent with gameplay mutation
rollback/branch tool concurrent with running Dayloom Runtime
automatic Session continuation after process crash
distributed coordination
network filesystem locking theorem
general-purpose transaction engine
power-loss-proof database durability across every filesystem
arbitrary syscall interleaving recovery
```

它们不是“以后永远不能做”，而是**不能继续扩大当前 Core adapter 的 correctness surface**。

---

## 3. Package / ownership 边界保持不变

最终依赖仍然是：

```text
@dayloom/archive-protocol
          ↑
      @dayloom/core
          ↑
      @dayloom/tui
```

### `@dayloom/archive-protocol` owns

```text
ArchiveManifestV2
CurrentPointerV2
ArchiveCommitV2
PublishedWorldPhase
RootTreeV1
StagingManifestV1
ArchiveOperationV2
ArchiveOperationErrorV1
path/media/blob rules
canonical tree encoding/hash
cross-object relation validators
recovery classification
archive-relative layout vocabulary
```

### `@dayloom/core` owns

```text
filesystem I/O
single World mutation ownership
operation/session workspace
staging physical files
immutable object materialization
atomic mutable metadata replacement
Dayloom World Profile
Dayloom mutation policy
Session/gameplay lifecycle
inspect / GC execution
```

保持：

```text
Protocol = what Archive facts mean
Core     = how Dayloom safely realizes those facts locally
```

不新增 `@dayloom/archive`。

---

## 4. Truth domains

Phase 1B 只保留三个 truth domain。

### 4.1 Published World

唯一 authority：

```text
current.json
  → ArchiveCommitV2
  → RootTreeV1
  → Blob(s)
```

必须成立：

```text
current did not advance
⇒ Published World did not change
```

以及：

```text
current references target
⇒ target graph must be Protocol-valid and complete
```

### 4.2 Working Session

```text
CoreSessionRecordV1
+ exactly one ArchiveOperationV2
+ its StagingManifestV1
+ Session workspace
```

它是工作状态，不是 Published World。

### 4.3 AI Conversation

```text
Phase 2/3 owned
```

Phase 1B 只保存当前 Session workspace/checkpoint/transcript 所需数据，不声称可以恢复完整模型上下文。

---

## 5. 最重要的纠偏：One World → One Mutation Owner

当前实现已经出现：

```text
publish.lock
session-claim.lock
operation.lock
RuntimeMutationLock
```

这说明系统正在形成 lock graph。

Phase 1B 不继续扩展该模型。

冻结：

```text
one World
→ at most one cross-process mutation owner
```

只读能力不需要 ownership：

```text
read current
read documents
inspect
dry-run GC
export
verify
```

所有 mutation 必须属于同一个 owner：

```text
gameplay Session
stable command
prepare
publish
abort
GC delete
future offline migration/repair through Core
```

因此第一版不存在：

```text
prepare × concurrent GC delete
publish × concurrent abort
Session A × Session B in another writer process
operation lock × publish lock order
session lock × operation lock order
```

这些不是靠更多 lock 解决，而是由 ownership precondition 消除。

---

## 6. Core capability boundary：Reader / Writer

不创建新 package，但 Core 内部必须把能力分成只读和单写者两类。

概念接口：

```ts
interface ArchiveV2Reader {
  readCurrent(): Promise<ArchiveV2ReadResult>;
  readPublishedSnapshot(): Promise<PublishedArchiveSnapshot | null>;
  inspect(): Promise<ArchiveV2Inspection>;
  collectGarbageDryRun(): Promise<ArchiveV2GarbageCollectionResult>;
}

interface ArchiveV2Writer extends ArchiveV2Reader {
  beginWorldOperation(...): Promise<ArchiveOperationV2>;
  stageManifest(...): Promise<void>;
  putDocument(...): Promise<StagingManifestV1>;
  deleteDocument(...): Promise<StagingManifestV1>;
  prepare(...): Promise<ArchiveOperationV2>;
  publish(...): Promise<ArchiveV2ReadResult>;
  abort(...): Promise<ArchiveOperationV2>;
  createSession(...): Promise<CoreSessionRecordV1>;
  updateSessionStatus(...): Promise<CoreSessionRecordV1>;
  collectGarbageDelete(): Promise<ArchiveV2GarbageCollectionResult>;
  close(): Promise<void>;
}
```

`ArchiveV2Writer` 只能通过：

```text
acquireWorldMutationOwnership(worldRoot)
```

获得。

Runtime 生命周期：

```text
createDayloomRuntime
↓
acquire WorldMutationOwnership
↓
create ArchiveV2Writer
↓
run gameplay
↓
dispose Runtime
↓
release ownership
```

这样 mutation serialization 是能力边界，不是每个方法自己猜应该拿哪把锁。

---

## 7. WorldMutationOwnership：唯一跨进程协调 primitive

该 ownership 是 Core runtime contract，不进入 Archive Protocol。

推荐物理结构：

```text
<world-root>/.locks/
├── world-write.lock/
│   └── owner.json
└── .world-write-<token>.tmp/
```

owner 最小信息：

```ts
interface WorldMutationOwnerRecordV1 {
  schemaVersion: 1;
  token: string;
  pid: number;
  createdAt: string;
}
```

### 7.1 Claim

禁止直接创建最终 lock file 再慢慢写 JSON。

采用：

```text
create unique temp lock directory
↓
write + flush owner.json
↓
atomic rename temp directory
→ .locks/world-write.lock
```

rename 成功即 ownership acquired。

若 final lock 已存在：

```text
owner process alive
→ WORLD_BUSY
```

若 owner 已死亡或 lock 内容损坏：

```text
atomically rename existing final lock
→ unique stale quarantine path
↓
retry normal claim
```

关键点：

```text
never: read stale → remove final path
```

否则 stale reclaimer 可能删除另一个进程刚创建的新 lock。

### 7.2 Release

```text
read owner token
→ require token == this writer token
→ remove/rename own lock directory
```

release failure只产生 maintenance diagnostic；不得改变 Published truth。

### 7.3 删除现有多 lock 模型

Phase 1B 修复后不再需要：

```text
session-claim.lock
per-operation operation.lock
publish.lock as an independent gameplay lock domain
```

如果 legacy V1 仍临时使用 `publish.lock`，它只能留在 legacy compatibility path，不得继续进入 modern V2 architecture。

---

## 8. 进程内 mutation serialization

获得 cross-process writer 后，Writer 内再有一个简单 async mutex：

```text
WorldMutationGate
```

所有 mutation API 串行执行。

因此：

```text
put/delete/prepare/publish/abort/GC delete
```

不会在同一 Writer 中互相交叉。

Runtime 原有 `RuntimeMutationLock` 可以继续负责 command-level reentry/busy semantics；Archive Writer gate负责 filesystem mutation serialization。

两者职责不同，但**不形成跨进程 lock graph**。

---

## 9. Failure model：只冻结真正需要的级别

### 9.1 Formal guarantee

Phase 1B 保证：

```text
process-crash consistency
```

也就是进程在任意业务步骤退出后，restart 能通过 canonical durable facts 得到唯一 Published truth，并把未完成工作分类为 interrupted/garbage/prepared candidate。

### 9.2 Best-effort guarantee

以下降级为 filesystem best effort：

```text
power loss exactly between rename and directory fsync
filesystem-specific metadata persistence
portable Windows directory fsync equivalence
```

普通 file flush failure仍传播；Core 可以调用 parent sync，但不把所有 filesystem 的 power-loss 行为变成 Phase 1B database theorem。

### 9.3 Visibility switch 返回错误后的规则

如果 I/O 在 atomic rename 之后报错，调用方不能只根据 exception 猜结果。

必须：

```text
re-read canonical authority
↓
canonical state == expected
→ treat transition as committed

canonical state != expected
→ transition not proven
→ fail
```

尤其 publication：

```text
publish error
↓
read current
↓
current == target
→ publication succeeded

current == pinned base
→ publication did not happen
```

这已经足够关闭 process-crash/ambiguous-return 语义，不需要继续扩展到通用 WAL/replay engine。

---

## 10. Mutable authorities 只保留三个 visibility switch

继续保留：

```text
staging/index.json
= staged truth changed

operation.json open → prepared
= prepared candidate became authoritative

current.json
= Published World changed
```

这些 mutable metadata 使用：

```text
write temp
→ flush file
→ atomic replace
→ best-effort parent sync
→ re-read on ambiguous failure
```

`CoreSessionRecordV1` 同样原子更新，但它不是 Archive Protocol truth。

不再为这些 switch 各自创建独立跨进程锁；它们都在同一个 `ArchiveV2Writer` mutation ownership 中发生。

---

## 11. Manifest theorem 保持简单

`manifest.json` 是 Archive identity：

```text
create-once
```

规则：

```text
absent
→ create expected manifest without overwrite

exists
→ parse
→ require same world identity
→ never rewrite a different identity
```

因为 initialization 已处于 single writer ownership，不再需要证明两个并发 init writer 的所有 interleaving。

仍必须保证 final manifest 不以 partial file 可见；使用 temp + atomic create/promote。

```text
manifest exists + current absent
= provisional / interrupted initialization
```

restart 时不自动继续 init Session；只保留 workspace，并将 Session 标记 interrupted。

---

## 12. Session：durable preservation，不做 Phase 2 的 continuation

这是本轮第二个重要纠偏。

Phase 1B Session theorem：

```text
one active Runtime Session
→ one CoreSessionRecordV1
→ one ArchiveOperationV2
```

### 12.1 Session ID 只有一个来源

当前实现 durable Session 与 RuntimeSession 分别生成 sessionId，必须修复。

冻结：

```text
Runtime creates sessionId exactly once
↓
passes SAME sessionId to CoreSessionRecord creation
↓
passes SAME sessionId to SessionManager / RuntimeSession
```

必须有：

```text
RuntimeSession.id
== CoreSessionRecord.sessionId
```

### 12.2 正常生命周期

```text
start
→ ArchiveOperation(open)
→ CoreSessionRecord(active)
→ RuntimeSession active
→ Published World unchanged

submit
→ SAME operation staging
→ prepare
→ publish
→ CoreSessionRecord(completed)
→ RuntimeSession completed

cancel
→ SAME operation aborted
→ CoreSessionRecord(cancelled)
→ Published World unchanged
```

### 12.3 Restart 生命周期

Phase 1B **不重新构建并继续运行旧 RuntimeSession**。

Writer startup 后执行一次 deterministic reconciliation：

```text
CoreSessionRecord active/submitting
↓
if its target commit is already in Published commit ancestry
   → completed
else
   → interrupted
```

然后：

```text
no active RuntimeSession is reconstructed
Runtime phase = Published stable phase
workspace/staging/operation preserved
```

例如：

```text
crash during planning before publish
→ restart
→ Published = idle
→ old Session = interrupted
→ staging/workspace preserved
```

```text
crash after current switched before Session finalization
→ restart
→ target commit reachable from Published ancestry
→ Session = completed
→ Published World remains target/newer descendant
```

这就是 Phase 1B recovery 的完整语义：

> **preservation, not continuation**。

Conversation-level resume 留给 Phase 2。

### 12.4 Interrupted Session

`interrupted`：

```text
不是 active Session
不投影 planning/playing/revising phase
不能直接 submit/cancel
不会自动删除 operation/staging/workspace
```

允许后续：

```text
inspect
discard
future Phase 2 resume/migration
```

第一版可以允许新的 gameplay Session 在同一 writer 下开始；旧 interrupted operation 只是 retained working artifact，不是第二个 writer。

---

## 13. Runtime phase 重新收敛

Published Commit 只保存：

```text
idle
planned
awaiting-settle
```

运行中 active Session 才投影：

```text
init     → initializing
planning → planning
play     → playing
revise   → revising
```

restart 后 Session 被标记 `interrupted`，因此不再投影运行中 phase。

冻结：

```text
Runtime phase
= Published phase
+ current-process active RuntimeSession only
```

而不是：

```text
durable unfinished Session record
→ pretend old RuntimeSession is still active
```

这消除当前 `SessionManager empty` 与 `world.phase=planning` 之类的半恢复状态。

---

## 14. Staging / Effective World

继续保留正确设计：

```text
StagingManifestV1
= sole staged truth
```

PUT：

```text
validate path/media/content
→ write durable opaque staged file
→ build next staging manifest
→ atomic index.json switch
```

DELETE：

```text
build next staging manifest
→ atomic index.json switch
```

Session effective view：

```text
effective World
= overlay(pinned base tree, staging manifest)
```

禁止回退到 live `current`。

因为 one Writer mutation gate 串行 staging 与 prepare，不再需要 per-operation lock + prepare-final-staging-reread 来对抗同一个 Core 内部的并发修改。

---

## 15. Pinned snapshot reader：彻底消除 live-current TOCTOU

当前 `session-world-read-model.ts` 先检查 current，然后多个 `readPublishedDocument()` 又重新读取 current；这是不必要的 split-view surface。

Core 增加一个 anchored read capability：

```ts
interface PublishedArchiveSnapshot {
  pointer: CurrentPointerV2;
  commit: ArchiveCommitV2;
  tree: RootTreeV1;
  read(path: string): Promise<Uint8Array | null>;
  list(): readonly DocumentTreeEntryV1[];
}
```

`read()` 只根据该 snapshot 的 immutable tree/blob 读取，不重新查询 live current。

Session 使用：

```text
published view
→ pinned PublishedArchiveSnapshot

working view
→ operation pinned base + staging overlay
```

任何一次 domain read 都来自一个固定 view。

---

## 16. Prepare：只证明 prepared candidate 完整

Prepare 在 single Writer gate 内执行。

流程：

```text
require operation=open
↓
read/parse operation + staging
↓
validateOperationStagingRelationV2
↓
verify staged PUT files
↓
load pinned base
↓
buildCandidateTreeV1
↓
materialize/deduplicate immutable blobs
↓
materialize canonical tree
↓
construct target commit
↓
validatePreparedTargetRelationV2
↓
verify complete target graph
↓
atomic operation.json → prepared
```

唯一 theorem：

```text
operation.status == prepared
⇒ exactly one complete Protocol-valid target graph exists
```

### 16.1 不再要求自动 prepare continuation

若 crash 在 prepared switch 之前：

```text
operation remains open
partial immutable objects = garbage/dedup artifacts
Session becomes interrupted on restart
```

Core 不自动重新执行 semantic prepare。

显式 maintenance/retry 若未来需要，可由 durable staging 重新构造；它不是 Phase 1B gameplay restart theorem。

因此不需要为了“任意 retry 参数也必须生成同一 candidate”增加新的 prepare intent state machine。

### 16.2 Immutable temp 不进入 canonical object namespace

当前实现会在 canonical blob/tree/commit 目录旁留下 `.tmp-*`。

修复：

```text
operations/<operation-id>/workspace/tmp/
```

作为 immutable materialization temp 区。

然后：

```text
write temp in workspace
→ flush
→ promote/link/rename to canonical immutable path
```

canonical object 目录只允许合法 Protocol object 名，不让 crash temp 参与 GC/object parser。

---

## 17. Publication：single writer 下仍保留强 Published theorem

Publication 不再获取独立 `publish.lock`；Writer 本身已经拥有 World mutation ownership。

流程：

```text
require operation=prepared
↓
read target commit/tree/blobs
↓
validatePreparedTargetRelationV2
↓
verify every blob
↓
read current
↓
if current == target
   → already published / success reconciliation
↓
require current == pinned base
↓
construct CurrentPointerV2
↓
validateCurrentCommitRelationV2
↓
atomic current.json replacement
↓
re-read current if write result is ambiguous
↓
current == target
→ publication success
↓
best-effort operation/session diagnostic finalization
```

必须成立：

```text
successful publication
⇒ target graph Protocol-valid
⇒ current references target
```

以及：

```text
failure proven before current switch
⇒ previous Published World unchanged
```

`operation.json → published` 与 Session completion 都是 post-publication workflow metadata；失败不能把一个 valid Published World 变成 invalid。

---

## 18. OCC 保留，但降回 integrity guard

Protocol 有 pinned base；Core 继续校验：

```text
current == operation.base
```

这仍然是有价值的 integrity invariant。

但在 Phase 1B Core single-writer 模式下，它不是用来支持多个 gameplay writer 的 merge/concurrency model。

如果 OCC 失败：

```text
fail closed
preserve prepared candidate/staging
no auto rebase
```

这足够支持 future offline tools 与 corrupted/foreign mutation detection。

---

## 19. Maintenance / GC：退出在线并发状态机

### 19.1 Inspect

```text
read-only
no Writer required
```

检查：

```text
manifest/current graph
commit ancestry
tree/blob integrity
operations
prepared target graphs
SessionRecord ↔ operation relation
orphans
```

### 19.2 GC dry-run

```text
read-only
no Writer required
```

### 19.3 GC delete

```text
requires ArchiveV2Writer / WorldMutationOwnership
serialized by WorldMutationGate
```

因此：

```text
GC delete cannot run concurrently with prepare/publish/staging
```

不再需要构造：

```text
prepare × GC delete race theorem
```

roots 仍然是：

```text
Published ancestry
∪ prepared-operation target graphs
```

真正 orphan 才能删除。

如果 gameplay Runtime 长期持有 Writer，外部 GC delete 必须等 Runtime 关闭；这正是第一版 intentional maintenance contract。

---

## 20. Standalone Archive tools 的边界

`@dayloom/archive-protocol` 仍允许独立：

```text
verify
inspect
migration reader
history viewer
future rollback/branch implementation
```

只读工具可以和 Dayloom Runtime 同时运行。

本阶段对**直接依赖 Protocol 的 mutating standalone tools**冻结为：

```text
offline mutation only
→ Dayloom gameplay writer must be closed
```

Phase 1B 不为了尚未实现的 rollback/branch tool 建立共享 multi-writer transaction runtime。

如果未来多个 mutating consumer 真实出现，再单独评估是否提取共享 Archive runtime/ownership primitive；不是当前 Core 的前置条件。

---

## 21. World Profile v1：与真实媒体类型对齐

第一版 canonical convention 统一为：

```text
canon/premise.md        text/markdown
canon/rules.md          text/markdown
canon/style.md          text/markdown
canon/user-role.md      text/markdown

days/<day>/plan.json       application/json
days/<day>/play.json       application/json
days/<day>/summary.md      text/markdown
days/<day>/settlement.md   text/markdown
days/<day>/abandoned.md    text/markdown

characters/**
scenes/**
arcs/**
memory/**
custom/**
```

Archive Protocol 不理解 narrative schema。

Core policy：

```text
canon/**
→ replaceable semantic docs

plan.json
→ current day planning document

play.json / summary.md
→ historical gameplay docs；ordinary gameplay 不静默覆盖

settlement.md / abandoned.md
→ history fact；append/history-oriented
```

未来增加 JSON/YAML/Markdown 普通语义文件，只扩 World Profile，不改 Commit/Tree/Blob schema。

---

## 22. Domain transition 不能由 Archive adapter 决定

当前 `runtime-operations-v2.ts` 自己计算 `nextDay()`、`lastSettledDay` 等，会把 gameplay semantics 泄漏进 persistence adapter。

修复：

```text
Domain state machine
→ owns complete target World control

Archive adapter
→ stages semantic documents
→ persists EXACT request.target control
```

因此：

```text
settle day progression
abandon-day control behavior
```

全部在 `domain/transitions.ts` + domain tests 冻结。

Archive V2 runtime 不再拥有：

```text
previousDay()
nextDay()
phase/business transition correction
```

这样 storage migration 不会偷偷改变 gameplay rules。

---

## 23. Legacy DTO / V1 read projection：只允许真正的 domain projection

当前 V2 read adapter 仍会构造：

```text
DayRevisionMeta
PlanDocument
PlayDocument
...
```

并填入类似：

```text
dayrev_document_profile
op_document_profile
```

的假 Archive identity。

这是必须删除的 architecture debt。

冻结：

```text
V2 documents
→ MAY project to Dayloom domain DTO
→ MUST NOT fabricate V1 Archive identity
```

允许：

```text
Canon semantic DTO
parsed plan/play domain DTO
```

前提是它们只是 domain view，不带假的：

```text
revision
parentRevision
operationId
V1 day-head identity
```

`packages/core/src/sessions/world-read-model.ts` 应改成 document-native/domain-native read model，不再 import `schemas/archive` 的 V1 revision types。

Phase 1B 仍可短期保留：

```text
legacy SessionSubmission
→ one-way deterministic document mutations
```

作为写入 adapter。

禁止：

```text
V2 documents
→ reconstruct V1 Archive model
```

---

## 24. 当前实现偏离清单与明确修复

### 24.1 `packages/core/src/archive-v2/repository.ts`

当前偏离：

```text
withOperationLock()
sessionLock()
publish lock domain
reconcileSessions() auto-interrupt model
GC/publish/prepare 各自协调
immutable temp 放 canonical object dir
```

修复：

```text
引入 ArchiveV2Writer capability
所有 mutation 经过一个 WorldMutationGate
删除 per-operation lock
删除 session claim lock
V2 publish 不再单独拿 publish lock
GC delete 只允许 Writer 调用
immutable temp 搬到 operation workspace/tmp
Session reconciliation 改为 startup-only interrupted/completed classification
```

### 24.2 `packages/core/src/archive-v2/paths.ts`

删除 modern V2：

```text
sessionLock()
operationLock()
```

新增/保留：

```text
worldMutationLockDir()
worldMutationTempLock(token)
operationTemp(id)
```

### 24.3 `packages/core/src/archive/publish-lock.ts`

不再把这个旧 primitive 泛化给 V2。

处理：

```text
legacy V1 若仍需要 → 留在 legacy path
modern V2 → 新建单一 WorldMutationOwnership primitive
```

完成 V1 exit 后可删除旧 publish-lock implementation。

### 24.4 `packages/core/src/runtime/create-runtime.ts`

当前偏离：

```text
startup 直接 reconcileSessions()
但不真正恢复 RuntimeSession
```

修复：

```text
acquire ArchiveV2Writer first
↓
read Published World
↓
reconcile durable unfinished Sessions:
  target reachable → completed
  otherwise → interrupted
↓
construct Runtime with NO restored active RuntimeSession
↓
world phase from Published stable state
```

### 24.5 `packages/core/src/operations/runtime-operations-v2.ts`

修复：

```text
Session id 由 Runtime 生成一次并传给 createSession
remove adapter-owned nextDay()/business control rewriting
persist request.target control exactly
continue one Session → one WorldOperation
continue submission → document mutation adapter
```

### 24.6 `packages/core/src/archive-v2/session-world-read-model.ts`

当前偏离：

```text
check live current
→ later repeatedly read live current
→ possible split-view
→ fabricate V1 day revision identities
```

修复：

```text
use PublishedArchiveSnapshot or operation EffectiveView
all reads anchored to one immutable tree/base
remove fake DayRevisionMeta / operation ids
return document-native/domain projection
```

### 24.7 `packages/core/src/sessions/world-read-model.ts`

删除对 V1 Archive revision schema 的依赖。

新的 read model 只表达 Session 真正需要的 semantic context，不表达不存在的 Archive V1 revision identity。

### 24.8 `packages/core/src/domain/transitions.ts`

确保完整拥有：

```text
settle day progression
lastSettledDay
abandon-day business control
```

Archive adapter 不再补 domain transition。

### 24.9 `packages/core/test/archive-v2/**`

删除/降级那些仅用于证明 multi-writer online interleaving 的 tests。

保留并加强 single-writer theorem tests，见本文 Evidence。

### 24.10 `.github/workflows/archive-protocol.yml` / Core scripts

当前 CI 已经正确把 Protocol/Core/TUI 放入矩阵，但 Node 18 会因为 `import.meta.dirname` 在 Core build script 先失败。

修复：

```text
build/guard scripts 使用 package 声明 Node floor 支持的 API
```

如果 Dayloom 仍声明 Node 18，则使用：

```text
fileURLToPath(import.meta.url)
```

等兼容写法。

CI matrix 建议：

```text
fail-fast: false
```

确保每个平台都产生证据。

---

## 25. 应删除什么 / 应保留什么

### 删除或退出 modern V2 path

```text
session-claim.lock
per-operation lock
independent V2 publish lock domain
multi-writer stale-lock theorem
online concurrent GC delete theorem
restart reconstruct active RuntimeSession theorem
fake V1 DayRevision/operation identities
Archive adapter-owned day transition logic
canonical object directory中的 temp files
```

### 保留

```text
@dayloom/archive-protocol package boundary
CurrentPointer → Commit → Tree → Blob
Protocol validators/hash/path rules
StagingManifest final-state overlay
one Session → one ArchiveOperation
CoreSessionRecord durability
atomic staging index
atomic prepared switch
atomic current publication
manifest create-once
pinned effective read
immutable object identity/dedup
OCC base validation
inspect / prepared roots
World Profile + mutation policy
```

目标是删掉并发协调层，而不是删掉 Archive 的数据完整性。

---

## 26. 修复实施顺序

### R0 — 先冻结目标

```text
本文成为 Phase 1B implementation authority
旧“multi-lock/multi-writer”推导不再作为 acceptance
```

### R1 — Single Writer capability

```text
实现 WorldMutationOwnership
拆 Reader / Writer capability
Writer 增加 process-local WorldMutationGate
Runtime lifecycle 持有 Writer
```

完成后先删除：

```text
session claim lock
operation locks
modern V2 independent publish lock
```

### R2 — Repository 简化

```text
put/delete/prepare/publish/abort/GC delete
全部只在 Writer gate 内运行

immutable temp → operation workspace/tmp
publish 增加 current==target reconciliation
```

### R3 — Session 简化

```text
single sessionId
startup active/submitting → completed | interrupted
no RuntimeSession continuation
interrupted workspace retained
Runtime phase only reflects current-process active Session
```

### R4 — Read model 清理

```text
PublishedArchiveSnapshot
EffectiveView pinned to operation
remove live-current TOCTOU
remove fake V1 revision identities
```

### R5 — Domain / Archive boundary

```text
state machine owns all control transitions
Archive adapter only persists target control + document mutations
align plan/play JSON and history Markdown profile
```

### R6 — Maintenance

```text
inspect read-only
GC dry-run read-only
GC delete Writer-only/offline with other writer
```

### R7 — V1 exit

```text
modern V2 path no longer reads/writes V1 Archive canonical schema
legacy explicit injection remains deprecated only if still required
no silent dual runtime
```

### R8 — Evidence + docs

```text
Core/TUI cross-platform green
update doc/reference/ARCHIVE_FORMAT.md to single-writer model
mark this draft completed
move stable facts to canonical doc
```

---

## 27. Executable evidence：只证明目标，不证明数据库

Formal Freeze 必须有以下 evidence。

### Ownership

```text
Writer A owns World
→ Writer B mutation open fails WORLD_BUSY

Reader while Writer active
→ succeeds

writer crash leaves stale ownership
→ next writer safely reclaims without two simultaneous owners
```

### Published graph

```text
publish
→ current references valid commit/tree/blobs
→ restart reads same World
```

### Staging

```text
failure before index switch
→ old staging

index switched
→ referenced staged file complete
```

### Prepare

```text
prepared
→ complete target graph

crash before prepared switch
→ operation remains open
→ partial objects are garbage/dedup only
```

### Publication ambiguity

```text
failure before current switch
→ old current

current switch succeeded but later step failed
→ re-read current == target
→ classify publication successful
```

### Session

```text
RuntimeSession.id == CoreSessionRecord.sessionId

start → one WorldOperation
submit → same WorldOperation
cancel → same WorldOperation aborted + current unchanged
```

### Restart

```text
crash active Session before publication
→ restart
→ Session interrupted
→ Published stable phase restored
→ staging/workspace preserved
→ no fake active RuntimeSession
```

```text
crash after current publication before Session finalization
→ restart
→ target reachable
→ Session completed
→ new Published World retained
```

### Pinned read

```text
one PublishedArchiveSnapshot
→ every document comes from same immutable tree
```

```text
operation EffectiveView
= pinned base + staging
```

### Maintenance

```text
GC delete cannot acquire writer while gameplay writer active
```

```text
prepared target graph survives GC
true orphan can be deleted under maintenance writer
```

### Legacy exit

```text
modern V2 read path
→ no schemas/archive DayRevision reconstruction
→ no fake V1 revision/operation identity
```

### Platform / package

```text
@dayloom/archive-protocol
@dayloom/core
@dayloom/tui
```

在仓库声明的 Node/platform matrix 全绿。

---

## 28. 不再作为 Phase 1B gate 的测试

以下可以留作 future hardening，但不能继续驱动 Core 架构膨胀：

```text
multiple independent writers prepare concurrently
online GC races a live prepare
abort races publish in another writer
three independent lock domains stale-reclaim interleavings
automatic continuation of model conversation after process crash
network filesystem ownership recovery
power failure at every directory metadata persistence boundary
```

若测试要求一个系统能力，而该能力已经明确是 non-goal，则应该删除/降级测试，不应为了让测试 green 再增加 runtime complexity。

---

## 29. Final acceptance checklist

- [ ] Core 直接依赖 `@dayloom/archive-protocol` public exports。
- [ ] 不创建 `@dayloom/archive` package。
- [ ] `current → commit → tree → blobs` 是唯一 Published World authority。
- [ ] 一个 World 同时最多一个 mutation owner。
- [ ] V2 modern path 不再有 session/operation/publish 三套跨进程 lock domain。
- [ ] 所有 mutation 通过一个 `ArchiveV2Writer` / `WorldMutationGate` 串行。
- [ ] 只读 reader 不需要 writer ownership。
- [ ] `staging/index.json` 是唯一 staged truth。
- [ ] `operation.json=prepared` 表示完整 candidate graph 已存在。
- [ ] `current.json` 是唯一 publication switch。
- [ ] process-crash 后 Published truth 可唯一读取。
- [ ] ambiguous current write 通过 re-read current 分类，而不是猜测。
- [ ] manifest create-once。
- [ ] one Session → one sessionId → one ArchiveOperation。
- [ ] restart 不伪装 Session continuation；unfinished Session → interrupted/preserved。
- [ ] post-publication unfinished Session → completed reconciliation。
- [ ] Runtime phase 只由 Published phase + current-process active Session 投影。
- [ ] Session/document read 使用 pinned snapshot/effective view，不重复读取 live current。
- [ ] V2 read model 不制造 V1 revision/operation identity。
- [ ] domain state machine 拥有 day/phase/lastSettledDay transition。
- [ ] Archive adapter 只持久化 domain target，不改写 gameplay control。
- [ ] plan/play 使用 `.json + application/json`；summary/settlement/abandoned 使用 Markdown convention。
- [ ] GC dry-run 可只读；GC delete 只能在 mutation ownership 下运行。
- [ ] canonical object namespace 不含 crash temp 文件。
- [ ] V1 不再是 modern canonical read/write path。
- [ ] CI 与声明 Node/platform floor 一致且全绿。
- [ ] Phase 2 可以增加 persistent Conversation，而无需修改 Archive V2 truth model。

---

## 30. Phase 1B Freeze theorem

最终只证明下面这组 theorem。

### Ownership

```text
one World
→ at most one mutation owner
```

### Published truth

```text
Dayloom Published World
= Protocol-valid current referenced immutable graph
```

### Working truth

```text
Session Working World
= pinned base tree
+ StagingManifest referenced staged files
```

### Prepare

```text
ArchiveOperation.status == prepared
⇒ one complete Protocol-valid target graph exists
```

### Publication

```text
current == target
⇒ target is Published World
```

### Session

```text
one current-process active RuntimeSession
⇒ same CoreSessionRecord.sessionId
⇒ same ArchiveOperation
```

### Restart

```text
unfinished Session after writer loss
→ interrupted + preserved
≠ automatically resumed
```

### Maintenance

```text
mutating maintenance
≠ concurrent gameplay writer
```

### Extensibility

```text
new ordinary World document
⇒ no Archive Protocol object-model change
⇒ no new Core transaction schema
```

这就是 Phase 1B 的“优雅闭环”：

> **通过缩小并发和恢复承诺，让 World truth、working truth、mutation ownership、process restart 和未来 Phase 2/3 handoff 各自只有一个清晰解释。**

---

## 31. Phase 2 / Phase 3 handoff

Phase 2 可以直接建立在：

```text
single World writer
stable Published World
interrupted Session preservation
one Session ↔ one ArchiveOperation
pinned effective World
```

之上增加：

```text
persistent Promptpile Conversation
compression/archive/restore
```

然后才把：

```text
interrupted
→ resumable
```

升级为正式能力。

Phase 3：

```text
React / MCP
→ current Runtime Session
→ SAME WorldOperation staging
→ Core mutation policy
```

Agent/MCP 不成为独立 Archive writer。

---

## 32. 文档治理

修复完成前：

```text
DAYLOOM_ARCHIVE_PROTOCOL_ADAPTATION_DRAFT.md
= Phase 1B 修复 authority
```

`doc/reference/ARCHIVE_FORMAT.md` 当前 `implemented` 描述必须视为实现快照，而不是高于本文的 normative runtime contract。

修复完成并 CI green 后：

1. 把本文稳定事实迁入 `doc/reference/ARCHIVE_FORMAT.md`；
2. canonical reference 明确写入 `single-writer local runtime`；
3. 删除旧 multi-lock / auto-resume / online-mutation concurrency 描述；
4. 将本文改成完成记录或删除；
5. Phase 2/3 只引用 canonical reference。

原则：

```text
one architecture
+ one implementation model
+ one executable evidence set
= one truth
```
