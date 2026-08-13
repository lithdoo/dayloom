# Dayloom Core → Archive Protocol 适配实施冻结草案

> 状态：Implementation Freeze / 待实施  
> 日期：2026-08-13  
> 实施顺序：**Phase 1B / 3**  
> 前置：`ARCHIVE_PROTOCOL_PACKAGE_DRAFT.md`  
> 后续：`PERSISTENT_CONVERSATION_COMPRESSION_DRAFT.md`、`PROMPTPILE_AGENT_RUNTIME_DRAFT.md`  
> 原则：`@dayloom/core` 直接依赖 `@dayloom/archive-protocol`；本阶段不创建 `@dayloom/archive` runtime package。

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
```

这些必须来自 `@dayloom/archive-protocol`。

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

这些能力即使未来存在，也不能扩大 Phase 1B 当前 correctness surface。

特别是：

```text
Core direct-depends Protocol
```

是本阶段有意的中间/长期边界，不要求为了“理论纯度”再多拆一层 Archive runtime package。

---

## 3. 从当前实现保留什么

当前 `dev` Archive V1 已经拥有一套值得保留的 transaction theorem：

```text
isolated operation workspace
→ validate
→ publish lock
→ expected-base re-check
→ immutable objects first
→ FINAL current replacement
```

Phase 1B 保留：

- `current` 是唯一 publication authority；
- operation workspace 隔离；
- publish lock；
- optimistic conflict/base check；
- immutable object first/current last；
- crash 可留下 orphan，不可留下 visible partial state；
- operation metadata 只做 durable diagnostics；
- logs 非权威；
- inspect/GC 基于引用图；
- Runtime mutation lock 与跨进程 Archive publish lock 分层。

不重新发明 transaction primitive。

---

## 4. 从当前实现删除什么

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
```

Phase 1B 完成后，这些不得继续作为 Archive canonical write/read schema。

Archive 内容模型统一成：

```text
CurrentPointer
→ Commit
→ RootTree
→ Blob
```

Core 的 Archive runtime 只理解：

```text
protocol objects
+ filesystem transaction
```

不再理解人物、场景、计划、事件等 narrative ontology。

---

## 5. Truth domains

Phase 1B 继续冻结三个 truth domain：

```text
1. Published World
   = current → commit → tree → blobs

2. Session Staging
   = pinned base + PUT/DELETE overlay

3. AI Conversation
   = Phase 2/3 owned
```

本阶段只实现前两个的 Core runtime。

必须成立：

```text
AI text
≠ World fact

Session message
≠ World fact

staged file
≠ World fact

current atomically advances
= Published World changed
```

---

## 6. Core 与 Protocol ownership

### 6.1 Protocol owns meaning

Core 必须 import：

```text
ArchiveManifestV2
CurrentPointerV2
ArchiveCommitV2
PublishedWorldPhase
RootTreeV1
DocumentTreeEntryV1
StagingManifestV1
ArchiveOperationV2
```

以及：

```text
protocol parsers
path normalization
portable collision
canonical tree encoder/hash
overlay/diff
recovery classification
archive-relative layout helpers
```

### 6.2 Core owns side effects

Core Archive runtime 执行：

```text
resolve worldRoot
read/write files
validate physical object existence
symlink/path escape prevention
operation workspace lifecycle
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
Protocol tells Core what is valid.
Core proves that filesystem mutation realizes it safely.
```

---

## 7. Core 内部推荐目录

不要求精确文件名，但依赖方向应接近：

```text
packages/core/src/
├── archive/
│   ├── repository.ts
│   ├── transaction.ts
│   ├── filesystem.ts
│   ├── publication.ts
│   ├── publish-lock.ts
│   ├── recovery.ts
│   ├── inspect.ts
│   └── gc.ts
│
├── world/
│   ├── profile.ts
│   ├── mutation-policy.ts
│   └── read-model.ts
│
├── domain/
├── sessions/
└── runtime/
```

Core 内不得继续出现一份平行：

```text
schemas/archive-v2.ts
```

去复制 protocol public types。

允许 Core 有 runtime-specific wrapper/result type，但不能重新定义磁盘 contract。

---

## 8. Archive V2 物理布局

Core 按 protocol layout vocabulary 实现：

```text
<world-root>/
├── manifest.json
├── current.json
├── commits/
├── objects/
│   ├── trees/sha256/
│   └── blobs/sha256/
├── operations/
├── .locks/
└── logs/
```

逻辑 World path 永远不直接拼成 object-store path。

Core 使用 protocol format helpers 构造 archive-relative object path，再由 filesystem layer 安全解析到 worldRoot 内。

必须验证：

```text
resolved physical target
∈ worldRoot
```

禁止 symlink/path traversal 逃逸。

---

## 9. “文件原生”在 Core 中的含义

Dayloom World semantic identity：

```text
logical path + bytes + media type
```

Physical object store 是实现细节。

因此 Core 提供：

```text
readPublishedDocument(path)
listPublishedDocuments()
readEffectiveDocument(path)
listEffectiveDocuments()
```

而不是要求调用方直接扫描：

```text
objects/blobs/**
```

如果未来需要 checkout/materialize：

```text
current → tree → blobs
→ materialized projection
```

该 projection 不是 authority；编辑必须重新进入 staging transaction。

---

## 10. Dayloom World Profile v1

Archive Protocol 是通用的 Dayloom Archive data contract，但 Dayloom 产品必须有稳定 semantic namespace。

Core 拥有 **World Profile v1**：

```text
canon/**
characters/**
scenes/**
arcs/**
memory/**
days/**
custom/**
```

这些 namespace 是：

- AI/read-model 约定；
- TUI/inspector 展示约定；
- Phase 3 MCP tools 的业务路径约定；
- migration/export 的产品组织方式。

它们**不进入 `@dayloom/archive-protocol` narrative schema**。

新增：

```text
characters/factions/**
custom/economy/**
```

不应要求修改 protocol object model。

---

## 11. Dayloom mutation policy

Generic protocol staging 允许 PUT/DELETE；Core 必须在调用 Archive transaction 前执行产品 policy。

至少区分：

```text
replaceable semantic document
immutable-once-published source document
append-by-new-path history document
reserved/internal path
```

原则：

```text
Protocol validates structural legality.
Core validates Dayloom business permission.
```

未来 MCP 只能调用 Core/domain capability，不能直接绕过 policy 修改 operation staging。

独立 Archive rollback/migration tool可以不依赖 Core policy，因为它的语义是 Archive infrastructure operation；但它必须自行证明 protocol/publication conformance，并且产品层应明确这是管理工具而不是普通 gameplay mutation。

---

## 12. Manifest / World identity 适配

Core 初始化 V2 使用：

```ts
ArchiveManifestV2 {
  schemaVersion: 2,
  worldId,
  title,
  createdAt
}
```

`title` 是稳定 display label。

可修改 story title/world description 进入 semantic documents，不与 manifest label 形成双 truth。

初始化失败时：

```text
current absent
⇒ Runtime sees uninitialized
```

即使 provisional manifest/orphan objects 已存在也不能算 Published World。

---

## 13. PublishedWorldPhase → Runtime phase projection

这是 Core 适配最重要的 domain change 之一。

Protocol Commit 只允许：

```text
idle
planned
awaiting-settle
```

当前 Runtime 的：

```text
initializing
planning
playing
revising
```

不能再通过 Archive commit/activeSession 持久化。

Core Runtime phase 应变成投影：

```text
archive read status
+ PublishedWorldPhase
+ active Session kind/status
→ Runtime presentation phase
```

例如：

```text
Published = idle
Session kind = planning
→ Runtime phase = planning
```

```text
current absent
+ init Session active
→ Runtime phase = initializing
```

```text
archive invalid
→ Runtime phase = invalid
```

这样：

```text
Session lifecycle
≠ World history
```

---

## 14. Session start/cancel 适配

Archive V1 会为 start-session/cancel-session 产生边界 commit；V2 必须删除这个行为。

新语义：

```text
start Session
→ create/activate Session workspace
→ pin current base
→ Published World unchanged
```

```text
cancel Session
→ discard/close staging workspace
→ Published World unchanged
```

不再：

```text
start-session commit
cancel-session rollback commit
activeSession in ArchiveCommit
```

这会显著减少 immutable history 中的 runtime lifecycle noise。

---

## 15. Staging operation runtime

Core 创建 operation 时读取 current 并 pin：

```text
baseRevision
baseCommitId
baseRootTreeHash
```

Operation workspace：

```text
operations/<id>/
├── operation.json
└── workspace/staging/
    ├── index.json
    └── files/<opaque-id>
```

Core 使用 protocol parser/encoder 写：

```text
ArchiveOperationV2
StagingManifestV1
```

PUT bytes：

- path 先过 protocol canonicalization；
- 再过 Core World mutation policy；
- bytes/media 过 protocol validation；
- staging file 用 opaque physical id；
- manifest 保存 hash/bytes/media/path。

DELETE：

- canonical path；
- policy check；
- final-state manifest 更新。

同一路径只保存最终 staged mutation。

---

## 16. Effective read model

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

Core 对上层暴露稳定 capability：

```text
readPublishedDocument(path)
listPublishedDocuments()
readEffectiveDocument(operation, path)
listEffectiveDocuments(operation)
inspectStaging(operation)
```

未来 Session/MCP/TUI 只能包装这些 capability，不直接扫描 object store/staging internals。

---

## 17. Prepare semantics

当 operation 从 `open` 进入 `prepared`：

```text
staging manifest freezes
↓
load pinned base tree
↓
protocol overlay
↓
candidate RootTree
↓
write/deduplicate immutable blobs
↓
write canonical tree
↓
build immutable target commit
↓
persist target ids in ArchiveOperationV2
```

必须成立：

```text
prepared
⇒ exactly one base
⇒ exactly one staging final state
⇒ exactly one target tree
⇒ exactly one target commit
```

prepared 后不能再 PUT/DELETE。

需要继续修改时：

```text
abort old operation
→ start new operation
```

避免 retry 时 candidate 漂移。

---

## 18. Publication state machine

Core 保留并收紧 Archive V1 transaction theorem：

```text
operation prepared
↓
acquire publish lock
↓
re-read current
↓
require current == pinned base
↓
re-read / validate target commit/tree/blobs
↓
write current temp
↓
flush/sync
↓
FINAL ATOMIC current replacement
↓
SUCCESS
↓
best-effort operation/log finalization
↓
release lock
```

锁只覆盖 publication critical section，不覆盖长期 staging/AI conversation。

---

## 19. Publication theorem

Core 必须 executable 地证明 protocol normative theorem。

成功：

```text
publish success
⇒ current references target commit
⇒ target commit is complete/immutable
⇒ root tree is valid/canonical
⇒ every referenced blob exists and hash matches
⇒ target tree == overlay(pinned base, frozen staging)
⇒ control satisfies protocol invariants
```

失败：

```text
failure before current replacement
⇒ previous Published World remains current
```

允许：

```text
unreachable immutable blobs/tree/commit
```

禁止：

```text
partially visible Published World
```

核心原则仍是：

> **garbage is allowed; corrupt visible state is not.**

---

## 20. OCC / conflict

Core 继续拥有 publish lock + optimistic base check。

必须同时成立：

```text
exclusive publication ownership
AND
current == pinned base
```

若：

```text
current != base
```

则：

```text
ARCHIVE_CONFLICT
no current mutation
staging/prepared candidate preserved
```

第一版不自动 merge/rebase。

冲突是上层可见结果，不是让 Core 猜测如何合并 semantic documents 的邀请。

---

## 21. Operation failure / retry

Core 遵守 protocol operation status：

```text
open
prepared
published
aborted
```

没有 terminal `failed`。

规则：

```text
staging/validation failure before prepare
→ status remains open
→ lastError updated
```

```text
publication attempt failure after prepare
→ status remains prepared
→ lastError updated
```

```text
current == target after crash
→ classify already-published
→ diagnostics may repair to published
```

显式 retry 只能针对相同 prepared candidate。

---

## 22. Crash / recovery

Core 启动/inspect 时读取 durable facts，再调用 protocol pure classifier。

Prepared operation：

```text
current == target
→ publication succeeded
```

```text
current == base
→ target not published
→ explicit retry/discard allowed
```

```text
current != base && current != target
→ superseded/conflicted
→ no automatic replay
```

Recovery 不能：

```text
guess semantic intent
automatically rebuild different target
automatically overwrite newer current
```

---

## 23. Inspect

Core `inspectArchive()` 执行 I/O，Protocol 提供 parser/graph rules。

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
orphan immutable objects
```

Inspection 只读。

Protocol invalid 与 filesystem/reference invalid 应在诊断中可区分。

---

## 24. GC

Core 继续执行 GC。

Reachability：

```text
current
→ retained commit parent chain
→ root trees
→ blobs
```

Operation workspace：

- open/prepared 不猜测删除；
- published/aborted 可按 retention 清理；
- orphan immutable objects 可删除；
- current-reachable graph 永远不能删。

默认 dry-run/report-first；真实删除必须显式启用并与 publication mutually exclusive。

GC 不是正常读写正确性的前置条件。

---

## 25. Dayloom business operations 迁移

当前 operation 层仍然围绕：

```text
stageCanon()
stageDay()
submission builders
```

Phase 1B 要迁移为：

```text
stagePut()
stageDelete()
validateStaging()
publish()
```

### init

AI/legacy adapter 的结果转换为 World Profile documents + initial control，再一次 publish。

### planning

写 `days/<day>/...` 等 profile documents，publish control：

```text
phase = planned
day = current day
```

### play

更新/追加 day/history documents，publish：

```text
phase = awaiting-settle
```

### settle

更新 settlement/history documents，并确定性推进：

```text
phase = idle
day = next day
lastSettledDay = settled day
```

### abandon-day

通过 document mutation 表达 abandoned/history fact，并更新 Published control。

### revise

直接针对 semantic document staging；不再生成完整 CanonDocuments object。

这里的具体 path/content convention 属于 World Profile，不进入 Archive Protocol schema。

---

## 26. 旧强类型 submit 的过渡边界

Phase 1B 允许短期保留当前 NaturalLanguageSession 生成旧 `SessionSubmission`，但只作为**单向 migration adapter input**：

```text
legacy SessionSubmission
→ Dayloom World Profile document mutations
→ V2 staging
```

禁止：

```text
V2 documents
→ rebuild legacy CanonDocuments/DayRevision
→ write V1 and V2 together
```

也禁止长期 dual-write：

```text
V1 Archive
+
V2 Archive
```

Phase 1B Freeze 前必须删除 canonical write path 上的 V1 submission/archive builders。

Phase 3 最终会让 AI 直接通过 tools 修改 staging，但 Phase 1 不依赖它。

---

## 27. V1 → V2 cutover

当前处于 breaking development 阶段，第一选择是明确 cutover：

```text
V2 reader accepts V2 only
V1 reader/code removed from modern core path
```

若必须迁移旧 demo/world：

```text
explicit one-shot migration
```

可以直接依赖 `@dayloom/archive-protocol` + legacy reader。

禁止 modern Core：

```text
open world
→ silently guess V1/V2
→ keep both forever
```

Schema version mismatch fail-closed。

---

## 28. Core public capability boundary

Phase 1B 后 Core 至少概念上拥有：

```text
readCurrentWorld()
readPublishedDocument(path)
listPublishedDocuments()

beginWorldOperation(...)
stagePut(...)
stageDelete(...)
inspectStaging(...)
readEffectiveDocument(...)
listEffectiveDocuments(...)
prepare(...)
publish(...)
discard(...)

inspectArchive()
collectGarbage()
```

是否直接公开全部给外部 package 由 Core API 设计决定；但内部 ownership 必须围绕这些 capability，而不是 `stageCanon/stageDay`。

---

## 29. Architecture guard

必须增加 guard，证明：

### Core consumes protocol publicly

禁止：

```text
@dayloom/archive-protocol/dist/*
relative imports into packages/archive-protocol/src
```

### Core does not duplicate protocol

不得另定义同名/等价：

```text
ArchiveManifestV2
CurrentPointerV2
ArchiveCommitV2
RootTreeV1
StagingManifestV1
ArchiveOperationV2
WorldDocumentPath canonical rules
```

### Protocol remains pure

Core test/guard 同时验证 protocol 没有反向 import Core。

---

## 30. Executable evidence

Phase 1B Formal Freeze 至少需要：

### Protocol-consumer conformance

```text
Core reads protocol golden Archive
→ same hashes/paths/control
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
```

### Crash boundaries

至少 fault-inject：

```text
before object write
after blob write
after tree write
after commit write
after prepared metadata
before current replace
after current replace before diagnostics
```

每个点 restart 后都必须可分类且 Published theorem 成立。

### Path portability

Windows/Linux 对：

```text
NFC
case collision
reserved names
portable chars
```

得到同一 protocol result。

### Legacy exit

测试确保 modern runtime 不再依赖 V1 canon/day schema。

---

## 31. CI gate

Phase 1B 最少运行：

```text
@dayloom/archive-protocol build/test
@dayloom/core build/test
Core ↔ protocol conformance
Archive V2 fault/recovery tests
TUI compatibility build/test
```

跨平台 matrix 至少覆盖 Dayloom 当前声明的平台；后续 Phase 3 如提高 Core Node floor，必须同步 package theorem/CI，不在 Phase 1 偷偷改变支持声明。

---

## 32. Final acceptance checklist

- [ ] Core 直接依赖 `@dayloom/archive-protocol` public exports。
- [ ] 本阶段没有 `@dayloom/archive` package。
- [ ] Archive V2 filesystem runtime 仍由 Core 拥有。
- [ ] V2 types/parser/hash/path/tree 不在 Core 重复实现。
- [ ] `PublishedWorldPhase` 与 Runtime/Session phase 分离。
- [ ] start/cancel Session 不发布 World commit。
- [ ] World Profile v1 明确且不污染 Protocol narrative schema。
- [ ] mutation policy 在 Core/domain 层。
- [ ] staging 只有 PUT/DELETE final overlay。
- [ ] prepared operation candidate immutable。
- [ ] current 是唯一 publication authority。
- [ ] publish lock + expected-base OCC 同时成立。
- [ ] conflict preserve staging/candidate。
- [ ] crash/recovery 只根据 durable facts 分类。
- [ ] inspect/GC 基于 Protocol graph semantics。
- [ ] V1 canon/day/submission 不再是 canonical Archive write schema。
- [ ] 无 V1/V2 长期 dual-write。
- [ ] restart/fault/concurrency tests green。
- [ ] Windows/Linux path evidence green。
- [ ] TUI 不需要理解 Archive object store。
- [ ] Phase 2 可以只依赖稳定 World/Session boundary，而不改 Archive V2。

---

## 33. Phase 1B Freeze theorem

最终 Core 必须证明：

```text
Dayloom Published World
= Protocol-valid current referenced immutable graph
```

以及：

```text
Core successful publication
⇒ protocol-valid target graph
⇒ pinned base still current at commit point
⇒ FINAL current replacement occurred once
⇒ no partial World was visible
```

Session：

```text
Session lifecycle
≠ Published World lifecycle
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
= Archive side effects + Dayloom game/runtime semantics
```

这就是本阶段的目标闭环。

---

## 34. Phase 2 / Phase 3 handoff

Phase 1B Freeze 后：

### Phase 2 可以假设

```text
Published World stable
Session workspace/staging stable
Core document read capabilities stable
```

然后只引入 persistent Promptpile Conversation + compression。

### Phase 3 可以假设

```text
MCP tools
→ call Core World/Profile mutation capabilities
→ Core stages documents
```

而不是：

```text
MCP
→ directly edit archive object store
```

即使未来存在独立 archive admin tools，普通 Agent gameplay path 仍必须经过 Core mutation policy。

---

## 35. Freeze 后文档治理

完成后：

1. Archive Protocol 当前事实进入 canonical protocol docs/package README；
2. Dayloom World/Profile/transaction ownership 进入 canonical Core architecture docs；
3. 删除 `ARCHIVE_PROTOCOL_PACKAGE_DRAFT.md` 与本适配草案；
4. tests/fixtures/CI 成为 executable evidence；
5. Git history 保存 V1 → V2 transformation history。

目标：

```text
protocol docs + package
= disk/data truth

core architecture docs
= runtime/game ownership truth

plans
= temporary only
```
