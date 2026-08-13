# Dayloom 文档原生 World 数据模型重构草案

> 状态：Implementation Freeze / 待实施  
> 日期：2026-08-13  
> 目标：把 Dayloom 的 AI 语义内容从过度强类型结构迁移为文档原生 World，同时保留最小、严格、可恢复的控制平面。  
> 实施顺序：**Phase 1 / 3**  
> 后续依赖：`PERSISTENT_CONVERSATION_COMPRESSION_DRAFT.md`、`PROMPTPILE_AGENT_RUNTIME_DRAFT.md`

## 1. 一句话结论

Dayloom V2 第一阶段只解决一个问题：

> **如何安全、确定性地版本化一个主要由 AI / 人理解和维护的文档世界。**

冻结后的总原则：

```text
AI / 人主要理解的世界语义
→ 文档原生内容

程序必须确定性理解的生命周期、一致性与发布
→ 少量强结构化控制数据
```

Phase 1 不引入 Agent、MCP、Conversation compression，也不依赖它们才能证明正确性。

本阶段保留 Archive V1 已经成立的事务思想：

```text
prepare immutable state
→ validate
→ re-check expected base
→ FINAL ATOMIC current replacement
```

但替换 Archive V1 过度领域化的内容模型：

```text
旧：canon revision / day revision / submission-specific schema

新：logical document tree
   → immutable blob
   → canonical root tree
   → commit
```

核心目标不是“把 JSON 换成 Markdown”，而是：

```text
Archive owns transaction semantics
Archive does NOT own narrative ontology
```

---

## 2. 从现有实现继承什么、删除什么

Phase 1 不是从零重写 Archive。

从当前 `dev` Archive V1 保留：

- `manifest` 稳定 World 身份；
- `current` 作为唯一已发布入口；
- immutable object first / current last；
- operation workspace；
- publish lock；
- optimistic base conflict；
- crash 后允许 orphan immutable objects；
- inspect / GC 基于引用图；
- 失败不能污染当前有效 World。

从 Archive V1 删除：

- `canonRevision`；
- `dayHeads`；
- `CanonDocuments`；
- `PlanDocument`；
- `PlayDocument`；
- `PlayEventDocument`；
- `SettlementDocument`；
- `AbandonedDocument`；
- init/planning/play/revise submission 作为 Archive canonical write schema；
- Session lifecycle 通过 Published World commit 表达的设计。

因此 V2 的演化定义是：

```text
Archive V1 transaction theorem
+
generic document graph
-
domain-specific archive schema
=
Archive V2
```

---

## 3. Truth domains

Phase 1 冻结三个不可混淆的 truth domain：

```text
1. Published World
   = current 指向的 immutable commit/tree/blob 图

2. Session Staging
   = 针对某个 pinned base commit 的未发布 overlay

3. AI Conversation
   = 对话、工具、历史与未来压缩上下文
```

Phase 1 只实现前两个的 World 侧语义；第三个由 Phase 2 / Phase 3 消费。

必须成立：

```text
AI 说过某件事
≠ World fact

AI 建议修改某个文档
≠ World fact

staging 中存在修改
≠ World fact

只有 current 成功原子推进到新 commit
= 新 Published World 生效
```

因此：

```text
current pointer
= sole publication authority
```

不得存在第二条可以让未提交内容变成正式 World 的写入旁路。

---

## 4. Semantic plane 与 control plane

### 4.1 Semantic plane

主要由 AI / 人理解的内容采用文档原生模型，例如：

```text
canon/**
characters/**
scenes/**
arcs/**
memory/**
days/**
custom/**
```

这些是 **Dayloom World Profile** 的产品约定，不是 Archive core 的领域 schema。

新增：

```text
characters/faction-a/leader.md
custom/economy/trade-routes.md
```

不应要求新增：

- Archive revision type；
- Archive domain interface；
- Archive-specific validator；
- Archive-specific projector。

### 4.2 Control plane

程序必须确定性理解的内容保持严格结构化：

- archive format/schema version；
- world identity；
- current revision / commit identity；
- commit parent relation；
- root tree identity；
- blob hash / size / media type；
- Published World 的最小业务控制状态；
- operation identity / state；
- pinned base identity；
- staging manifest；
- publish lock / conflict state；
- integrity / recovery metadata。

原则：

```text
程序必须确定性理解它
→ structured

主要由 AI / 人理解它
→ document
```

“文档原生”不意味着 control plane 变松；相反，语义越自由，控制平面越必须严格。

---

## 5. Archive V2 总体模型

Published World 精确定义为：

```text
Published World
= CurrentPointer
→ Commit
→ Canonical RootTree
→ immutable Blob(s)
```

工作态定义为：

```text
Operation
→ pinned base
→ Staging Manifest
→ PUT / DELETE overlay
```

有效工作视图：

```text
Effective World
= overlay(Published RootTree, Staging Manifest)
```

这里不存在：

```text
latest file wins
scan directory to infer current state
replay log to rebuild current state
```

---

## 6. 物理布局

第一版冻结为：

```text
<world-root>/
├── manifest.json
├── current.json
├── commits/
│   └── <commit-id>.json
├── objects/
│   ├── trees/
│   │   └── sha256/<prefix>/<tree-hash>.json
│   └── blobs/
│       └── sha256/<prefix>/<blob-hash>
├── operations/
│   └── <operation-id>/
│       ├── operation.json
│       └── workspace/
│           └── staging/
│               ├── index.json
│               └── files/
│                   └── <opaque-file-id>
├── .locks/
│   └── publish.lock
└── logs/
    └── operations.jsonl
```

第一版不实现递归 Git-style Merkle tree。

逻辑 World path 不直接决定物理 object-store path。

因此：

```text
logical filesystem
= product/domain interface

physical object store
= archive implementation detail
```

这用于隔离：

- Windows / POSIX path 差异；
- case folding；
- path traversal；
- device path；
- user-controlled path 直接进入内部存储布局。

---

## 7. “文件原生”的精确定义

Dayloom 的“文件原生”冻结为：

```text
World semantic identity
= logical path + bytes + media type
```

不是：

```text
用户可直接修改 object store 内某个物理文件
= 修改 Published World
```

Published World 只能通过 repository / staging / publication transaction 修改。

Phase 1 不把一个可编辑的物理 checkout 作为第二 authority。

如果以后需要：

```text
materialize / export / checkout
```

它只能是可重建 projection：

```text
current → commit → tree → blobs
→ materialized view
```

并必须满足：

```text
materialized view
≠ publication authority
```

用户/工具对 projection 的编辑若要进入 World，必须重新经过 staging transaction。

这既保留原项目“文件层级对人/AI 友好”的价值，也不牺牲事务一致性。

---

## 8. Archive Manifest V2

`manifest.json` 只保存稳定 Archive 身份和展示标签，不保存 World semantic state。

```ts
interface ArchiveManifestV2 {
  schemaVersion: 2;
  worldId: string;
  title: string;
  createdAt: string;
}
```

其中：

- `worldId`：稳定机器身份；
- `title`：Hub / CLI 可直接读取的稳定展示标签；
- 故事标题、世界简介等可变化语义仍属于 World documents；
- `createdAt`：Archive 创建时间。

`current.json` 不存在时，Archive 仍视为 `uninitialized`。

因此 init crash 可以留下 provisional manifest / immutable objects，但不能形成 Published World。

一旦 `current.json` 存在，manifest 默认不可由普通 World mutation 修改；后续如需要 rename / schema upgrade，应通过独立显式 metadata operation 处理，而不是普通 document staging。

---

## 9. Current Pointer V2

```ts
interface CurrentPointerV2 {
  schemaVersion: 2;
  revision: number;
  commitId: string;
  updatedAt: string;
}
```

规则：

- 首次发布 `revision = 1`；
- 后续成功发布严格 `+1`；
- `commitId` 指向完整、已校验、immutable commit；
- pointer 不重复保存 phase/day/tree hash；
- 更新使用同目录 temp + flush/sync + atomic replace；
- pointer 或 target commit 损坏时 fail-closed，不猜测其它 commit。

`current.json` 是唯一需要原子替换的 mutable publication object。

---

## 10. WorldDocumentPath v1

文档路径本身是 V2 的稳定 vocabulary。

### 10.1 Canonicalization

所有外部输入先执行：

```text
Unicode NFC normalization
→ validate
→ canonical path
```

RootTree 内保存的 path 必须已经是 NFC canonical form。

逻辑 path：

```text
UTF-8
relative
`/` 为唯一 separator
case-sensitive identity
host-independent
```

### 10.2 Portable collision rule

虽然 logical identity case-sensitive，但 Dayloom World v1 要求可跨 Windows/Linux 安全 materialize。

因此同一个 tree 中不得存在 portable-collision path。

第一版定义：

```text
portableCollisionKey(path)
= NFC(path).toLowerCase()
```

同一 tree 内：

```text
path unique
AND
portableCollisionKey unique
```

因此：

```text
characters/Alice.md
characters/alice.md
```

不能同时存在。

该限制牺牲极少量理论 case-sensitive namespace，换取稳定的跨平台文件语义。

### 10.3 必须拒绝

至少拒绝：

```text
empty path
absolute path
leading `/`
trailing `/`
`.` segment
`..` segment
empty segment (`a//b`)
backslash `\`
NUL
ASCII control characters
Windows drive / UNC forms
Windows reserved device names
segments ending with dot or space
characters invalid for portable Windows materialization
reserved Dayloom internal namespace
non-canonical stored Unicode path
```

### 10.4 Reserved namespace

至少保留：

```text
.dayloom/**
```

普通 World document 不得使用该 namespace。

Archive control files、object store、operation metadata 都不属于 RootTree。

---

## 11. Media/content contract

第一版受控媒体类型：

```text
text/markdown
text/plain
application/json
application/yaml
```

规则：

- 文本类必须是有效 UTF-8；
- JSON 必须语法合法；
- YAML 必须通过基础语法解析，但 Archive core 不验证业务字段；
- bytes 长度必须与记录一致；
- 单文件 / 单 World quota 由 policy 控制；
- media type 显式保存在 tree entry，不只由扩展名推断。

必须坚持：

```text
syntax validation
≠ semantic validation
```

例如：

```text
characters/alice.json
```

Archive 可以证明它是合法 JSON，但不拥有：

```text
name
age
relationships
```

等叙事 schema。

---

## 12. Blob identity

Blob 是 immutable raw bytes。

```text
blobHash
= lowercase hex SHA-256(raw bytes)
```

必须满足：

```text
object path hash
== SHA-256(actual bytes)
```

同一 bytes：

```text
⇒ same blob identity
⇒ natural dedup
```

已存在同 hash object 时不得覆盖不同 bytes。

检测到 hash/path 与实际 bytes 不一致时 fail-closed。

---

## 13. Canonical RootTree v1

第一版 RootTree 是扁平排序表：

```ts
interface DocumentTreeEntryV1 {
  path: string;
  blobHash: string;
  mediaType: string;
  bytes: number;
}

interface RootTreeV1 {
  schemaVersion: 1;
  entries: DocumentTreeEntryV1[];
}
```

### 13.1 Canonical order

`entries` 按 canonical path 的 unsigned UTF-8 byte order 升序排列。

必须满足：

```text
canonical NFC path
unique path
unique portableCollisionKey
canonical sort
valid media type
valid blob hash
bytes >= 0
```

### 13.2 Canonical encoding

Tree hash 由专用 deterministic encoder 产生。

第一版固定：

- UTF-8 JSON；
- 无 BOM；
- 固定字段顺序；
- 无无意义 whitespace；
- entries 已 canonical sort；
- newline policy 固定。

```text
treeHash
= lowercase hex SHA-256(canonicalTreeBytes)
```

不得依赖任意 object insertion order 的偶然行为。

### 13.3 Integrity

有效 tree 必须满足：

```text
for every entry:
  referenced blob exists
  blob hash matches
  byte count matches
```

Tree 不保存 AI semantic type。

---

## 14. PublishedWorldPhase

V2 必须把 **Published business state** 与 **Session / Runtime state** 分开。

当前 V1 的 `WorldPhase` 混合了：

```text
published stable state
+
active Session state
+
read failure state
+
uninitialized state
```

V2 Commit 禁止继续复用该混合类型。

冻结：

```ts
type PublishedWorldPhase =
  | 'idle'
  | 'planned'
  | 'awaiting-settle';
```

以下状态不得写入 Commit：

```text
uninitialized
initializing
planning
playing
revising
invalid
```

它们分别由：

```text
uninitialized
= current absent

initializing / planning / playing / revising
= Session/Runtime projection

invalid
= read/validation result
```

表达。

因此：

```text
Published World control
≠ Runtime presentation state
```

Runtime 后续可以通过：

```text
PublishedWorldPhase
+ active Session kind/status
+ archive read status
→ Runtime phase projection
```

得到 UI/command 所需状态，而不污染 immutable World history。

---

## 15. Commit V2

Commit 只拥有 publication history 与最小 Published control。

```ts
interface ArchiveCommitV2 {
  schemaVersion: 2;
  id: string;
  revision: number;
  parentCommitId: string | null;
  operationId: string;
  createdAt: string;
  rootTreeHash: string;
  control: {
    phase: PublishedWorldPhase;
    day: string | null;
    lastSettledDay: string | null;
  };
}
```

### 15.1 Control invariants

至少冻结：

```text
phase == planned
⇒ day != null

phase == awaiting-settle
⇒ day != null

phase == idle
⇒ day may be null or non-null
```

`day` 是 Runtime command/state-machine 必须确定性理解的当前业务 Day。

`lastSettledDay` 继续保留，因为它是独立业务事实；删除它将迫使 Runtime 扫描并理解 `days/**` semantic documents，反而重新引入 archive-domain coupling。

### 15.2 Commit 不拥有 Session

以下不进入 Commit：

```text
sessionId
session kind/status
activeSession
staging state
conversation location
recovery cursor
```

“打开一个 Session”本身不产生 World revision。

Session start/cancel 默认只改变 Session/workspace truth。

只有 `/submit`、settle、abandon 等真正改变 Published World 的操作才推进 `current`。

### 15.3 Commit 不拥有 semantic refs

禁止重新引入：

```text
canonRevision
dayHeads
PlanDocument
PlayDocument
semantic content refs by domain type
```

World semantic content 只通过 `rootTreeHash` 进入 Commit。

---

## 16. Dayloom World Profile v1

Archive core 是 generic document archive，但 Dayloom 产品不能变成“完全无约定的文件袋”。

因此在 Archive core 之上冻结一个独立 **Dayloom World Profile v1**。

第一版稳定顶层语义 namespace：

```text
canon/**
characters/**
scenes/**
arcs/**
memory/**
days/**
custom/**
```

这些 namespace 用于：

- AI prompt / read-model 约定；
- TUI / inspector 展示；
- Phase 3 Dayloom MCP tools 的默认语义边界；
- migration / export 的稳定组织方式。

但 Archive core 不验证：

```text
character 必须有什么字段
scene 必须有什么字段
arc 必须有什么字段
```

所以 ownership 是：

```text
Archive core
= document identity + transaction

Dayloom World Profile
= product path conventions + mutation policy
```

未来增加：

```text
custom/economy/**
characters/factions/**
```

可以只扩展 profile/content，不修改 Archive object model。

---

## 17. Dayloom mutation policy

Generic Archive 允许 PUT/DELETE，但 Dayloom 产品必须保留原设计中的来源保护语义。

Profile 可以把 logical paths 分类为：

```text
replaceable semantic document
immutable-once-published source document
append-by-new-path history document
```

例如用户原始输入、已发生历史事实等可以被 profile 标记为 immutable-once-published；AI 记忆、人物描述、世界说明等可以是 replaceable semantic documents。

重要原则：

```text
Archive core validates whether mutation is structurally safe
Dayloom policy validates whether mutation is semantically permitted
```

Phase 3 MCP 的 `staging.put/delete` 只能调用该 policy 后的 domain capability，不能绕过 policy 直接写 Archive。

`index.yaml`、derived summary、export 等可以存在，但如果它们可从 tree/path 推导，就不得成为第二个 existence authority。

---

## 18. Staging overlay v1

Staging 是针对固定 base commit 的 overlay，不是另一份完整 World copy。

第一版 mutation algebra 只有：

```text
PUT(path, bytes, mediaType)
DELETE(path)
```

不实现：

```text
PATCH
DIFF
MOVE
RENAME
APPEND
```

这些行为都归约为 PUT/DELETE。

例如 rename：

```text
DELETE old/path.md
PUT new/path.md
```

### 18.1 Final-state manifest

Staging manifest 保存每个 logical path 的**最终 staged mutation**，不是完整 edit log。

```text
PUT A
PUT B
→ keep PUT B
```

```text
PUT A
DELETE A
→ keep DELETE A
```

概念类型：

```ts
type StagedChangeV1 =
  | {
      op: 'put';
      path: string;
      mediaType: string;
      bytes: number;
      sha256: string;
      fileId: string;
    }
  | {
      op: 'delete';
      path: string;
    };

interface StagingManifestV1 {
  schemaVersion: 1;
  baseRevision: number;
  baseCommitId: string | null;
  baseRootTreeHash: string | null;
  changes: StagedChangeV1[];
}
```

初始化 operation：

```text
baseRevision = 0
baseCommitId = null
baseRootTreeHash = null
```

`changes` 必须 canonical sort 且 path unique。

### 18.2 Staging physical files

PUT raw bytes 保存于：

```text
workspace/staging/files/<opaque-file-id>
```

禁止使用 logical World path 直接构造 staging physical path。

manifest 的：

```text
sha256
bytes
```

必须与实际 staging file 一致。

---

## 19. Staging lifecycle

Operation `open` 时允许修改 staging。

一旦进入 `prepared`：

```text
staging manifest becomes immutable for this operation
```

`prepared` 后不得继续 PUT/DELETE。

如果用户/上层需要修改 candidate：

```text
abort old operation
→ begin new operation from current/base as appropriate
```

这样可以保证：

```text
prepared operation
→ exactly one candidate tree
→ exactly one target commit
```

避免 retry 时 candidate identity 漂移。

---

## 20. Candidate tree

Candidate tree 是纯函数：

```text
candidateTree
= overlay(baseTree, stagingManifest)
```

规则：

- PUT：新增或替换 path；
- DELETE existing：移除 path；
- DELETE missing：第一版定义为 idempotent no-op；
- 未提及 path：继承 base；
- 输出重新 canonical sort；
- 输出必须通过 path/media/tree validation。

必须成立：

```text
same base tree
+ same final staging manifest
⇒ same candidate tree bytes
⇒ same tree hash
```

Candidate tree 构建不调用 AI，不依赖 Conversation，不依赖 wall-clock time。

---

## 21. Effective read model

### 21.1 Published read

```text
readPublished(path)
listPublishedPaths()
```

只从：

```text
current → commit → tree → blob
```

读取。

### 21.2 Effective read

```text
readEffective(path)
= staged PUT if present
  absent if staged DELETE
  otherwise published value
```

```text
listEffectivePaths()
= overlay(published tree, staging manifest)
```

未来 Session/MCP/TUI 只能包装这些稳定能力，不应绕过 repository 直接扫描 object store。

Content search 不属于 Archive core Phase 1 contract；它可以建立在 list/read 之上。

---

## 22. ArchiveOperationV2

Operation metadata 是 crash/recovery 所需的 durable diagnostic state，但不是 publication authority。

冻结状态机：

```text
open
  ↓ prepare
prepared
  ↓ successful current replacement
published

open/prepared
  ↓ explicit discard
aborted
```

第一版**不使用含义模糊的 terminal `failed` status**。

Publication attempt 失败但 current 未变化时：

```text
operation remains open or prepared
+ lastError records latest failure
```

- 尚未 prepare 的 validation/staging error：保持 `open`；
- target graph 已 prepare、publication attempt 失败：保持 `prepared`；
- `published` / `aborted` 为终态。

概念类型：

```ts
interface ArchiveOperationV2 {
  schemaVersion: 2;
  id: string;
  type: string;
  status: 'open' | 'prepared' | 'published' | 'aborted';

  baseRevision: number;
  baseCommitId: string | null;
  baseRootTreeHash: string | null;

  targetCommitId: string | null;
  targetRootTreeHash: string | null;

  createdAt: string;
  updatedAt: string;
  lastError: RuntimeError | null;
}
```

### 22.1 Prepared invariants

```text
status == prepared
⇒ targetCommitId != null
⇒ targetRootTreeHash != null
⇒ staging immutable
⇒ target tree == overlay(pinned base, staging)
```

### 22.2 Retry semantics

`prepared` operation 可以显式 retry publication，但必须：

```text
same operation
same pinned base
same staging
same targetRootTreeHash
same targetCommitId
```

retry 不重新执行 AI，也不重新解释 semantic intent。

如果 current 已漂移：

```text
ARCHIVE_CONFLICT
→ remain prepared
→ staging preserved
→ automatic rebase forbidden
```

调用方可选择 abort，再在新 base 上创建新 operation。

### 22.3 Publication fact

即使 `operation.json` 因 crash 仍是 `prepared`：

```text
current.commitId == targetCommitId
```

也证明 publication 已发生。

因此：

```text
operation.status
= diagnostic

current pointer
= publication truth
```

---

## 23. Pinned base / optimistic conflict

Operation 创建时 pin：

```text
baseRevision
baseCommitId
baseRootTreeHash
```

Publication critical section 内必须重新读取 current。

已初始化 World：

```text
current.revision == baseRevision
AND
current.commitId == baseCommitId
```

初始化：

```text
current must still be absent
```

不满足时：

```text
→ ARCHIVE_CONFLICT
→ no current change
→ prepared staging preserved
```

第一版明确不实现：

```text
automatic merge
automatic rebase
semantic conflict resolution
```

---

## 24. Publication state machine

V2 继承 V1 “immutable objects first, current last”。

```text
resolve pinned base
↓
validate staging manifest/files
↓
materialize candidate tree
↓
materialize/deduplicate immutable blobs
↓
write immutable root tree
↓
write immutable target commit
↓
freeze operation as prepared
↓
acquire publish lock
↓
re-read current
↓
require current == pinned base
↓
re-validate complete target graph
↓
FINAL ATOMIC current.json REPLACE
↓
SUCCESS
↓
best-effort operation/log finalization
↓
release publish lock
```

具体实现可以调整“预写 object”与“拿锁”的位置，但 theorem 不得改变：

```text
current replacement
= only visibility boundary
```

锁尽可能只覆盖 publication critical section，不覆盖长时间 staging/editing。

---

## 25. Publication theorem

成功必须证明：

```text
publish success
⇒ current references target commit
⇒ target commit immutable and valid
⇒ target commit references complete valid root tree
⇒ root tree references only existing hash-valid blobs
⇒ target tree == overlay(pinned base tree, staged manifest)
⇒ Published control valid
```

失败必须证明：

```text
failure before final current replacement
⇒ previous Published World remains current
```

允许：

```text
unreachable immutable blob/tree/commit
```

禁止：

```text
incomplete World becomes current
```

核心原则：

> **garbage is allowed; corrupt visible state is not.**

---

## 26. Crash / recovery semantics

Recovery 不猜测、不自动 replay publication，而是分类 durable facts。

### 26.1 `current == base`

```text
prepared operation
+ current still pinned base
→ target not published
```

可以显式 retry 或 abort。

### 26.2 `current == target`

```text
current.commitId == targetCommitId
→ publication succeeded
```

即使 metadata 仍是 `prepared`，也应分类为 already-published，并可 best-effort 修复 operation diagnostics。

### 26.3 `current == other`

```text
current != base
AND
current != target
→ superseded/conflicted
```

不得自动 replay/rebase。

### 26.4 Recovery theorem

```text
recovery classification
= function(durable artifacts)
```

而不是：

```text
guess
+ replay side effects
```

---

## 27. Session 与 Published World

Phase 1 明确改变当前 V1 的 Session boundary 设计。

默认：

```text
start Session
→ Session/workspace state only
→ no World commit

cancel Session
→ discard/close Session staging
→ no World commit

submit Session
→ validate staged World state
→ publish World commit
```

因此 immutable World history 不再记录：

```text
planning started
play Session opened
revise Session cancelled
```

这类 runtime lifecycle noise。

后续 Runtime 的 `planning/playing/revising` 等状态由 Published control + Session state 投影得到。

---

## 28. Validation stack

### Layer 1 — Path

```text
NFC canonicalization
relative/path grammar
reserved namespace
portable collision
platform-safe identity
```

### Layer 2 — Content/media

```text
allowed media type
UTF-8
JSON/YAML syntax
quota
hash
```

### Layer 3 — Tree/object graph

```text
unique/sorted path
portable collision uniqueness
blob exists
hash matches
size matches
tree canonical hash matches
```

### Layer 4 — Published control / transaction

```text
PublishedWorldPhase invariants
commit parent/revision relation
expected base
operation state
current conflict
```

明确不属于 Archive core：

```text
character semantic fields
story semantics
plan semantic correctness
event ontology
AI-generated domain schema
```

---

## 29. Security constraints

World path/content 必须按 untrusted input 处理，尤其未来来自 AI/MCP 时。

至少覆盖：

```text
path traversal
absolute path
Windows drive / UNC / device paths
reserved internal namespace
Unicode non-canonical forms
case-fold collision
NUL/control chars
symlink escape
oversized file
oversized World
duplicate path
hash mismatch
malformed tree
malformed control JSON
```

AI-provided path 永远不能直接：

```text
path.join(worldRoot, aiPath)
```

必须经过：

```text
logical path parser
→ Dayloom mutation policy
→ repository staging
```

物理 object store 不允许通过 World document API 直接访问。

---

## 30. Inspect

`inspectArchive()` 至少验证：

```text
manifest valid
current valid
current commit exists
commit revision/parent/control valid
commit root tree exists
tree canonical encoding/hash valid
tree paths NFC/unique/sorted/portable
every blob exists
every blob hash matches
every byte count matches
prepared operation base/target sane
```

并报告：

```text
reachable commits
a reachable tree/blob set
unreachable immutable objects
open/prepared operations
invalid/corrupt references
```

Inspect 必须只读。

---

## 31. Garbage collection

Reachability 从：

```text
current
→ parent commit chain
→ root trees
→ blobs
```

计算。

GC 可以清理：

- unreachable immutable blobs/trees/commits；
- terminal operation 超过 retention 的 workspace；
- stale temp files。

不得删除：

- current 可达 graph；
- `open/prepared` operation staging；
- 无法确定 ownership 的 object。

GC 默认 dry-run/report-first。

`delete: true` 时才执行物理删除，并必须与 publication 协调，避免竞态。

GC 不是 correctness 前置条件：

```text
never run GC
⇒ Archive still correct
```

---

## 32. V1 → V2 breaking cutover

冻结：

```text
Archive V1
≠ Archive V2
```

V2 runtime 不做：

```text
implicit dual-read
implicit V1→V2 projection
V1/V2 dual-write
```

如果没有必须保留的外部 V1 World：

```text
direct breaking cutover
```

如果后续确认需要迁移存量：

```text
V1 archive
→ explicit offline one-shot migrator
→ V2 archive
```

Migrator 不得成为 V2 runtime 长期 compatibility layer。

---

## 33. 旧模型退出条件

Phase 1 完成必须意味着 V2 canonical World write path 不再依赖：

```text
CanonDraft
DayDraft
canonRevision
dayRevision
dayHeads
strongly typed SessionSubmission publication
stageCanon()
stageDay()
```

允许实施期单向 adapter：

```text
legacy AI/session output
→ Dayloom World Profile mutation
→ V2 staging PUT/DELETE
```

禁止：

```text
old model ↔ V2 documents
```

双向同步。

### 33.1 明确不迁移成第二 truth 的旧文件

以下旧概念如果可从 V2 truth 推导，不应继续作为 canonical authority：

- `state/calendar.yaml.current_day`：由 Commit `control.day` 取代；
- `state_patch.yaml`：未提交 diff 由 staging manifest 表达，已提交 diff 可由 parent/child tree 派生；
- 仅用于列举目录成员的 `index.yaml`：可作为 curated semantic document，但不得成为 existence truth；
- `logs/**`：只用于诊断；
- `exports/**`：只作为 derived output。

---

## 34. Phase 1 public capability boundary

概念上至少提供：

```text
readCurrentWorld()
readPublishedDocument(path)
listPublishedDocuments()

beginDocumentOperation(...)
inspectStaging()
stagePut(path, bytes, mediaType)
stageDelete(path)
readEffectiveDocument(path)
listEffectiveDocuments()
prepare()
publish()
abort()

inspectArchive()
collectGarbage()
classifyRecovery()
```

具体 TypeScript 名称可在实现时优化，但 ownership 不得改变。

Archive domain API 不接受：

```text
MCP tool shape
Promptpile Conversation object
React event
```

这些只能是上层 adapter。

---

## 35. Phase 1 不做什么

Implementation Freeze 后停止扩大范围。

不做：

- persistent Promptpile Conversation；
- conversation compression / restore；
- promptpile-react；
- Agent Event Protocol；
- generic MCP executor；
- Dayloom MCP server；
- recursive Merkle tree；
- semantic patch/fuzzy merge；
- automatic merge/rebase；
- semantic schema registry；
- arbitrary binary media ecosystem；
- vector search；
- World search engine；
- editable authoritative physical checkout；
- Conversation archive 与 World archive 合并。

这些不能成为 Phase 1 Freeze blocker。

---

## 36. Executable evidence

Phase 1 Freeze 必须用 executable witness 证明 theorem。

### 36.1 Path conformance

覆盖：

- NFC normalization；
- valid POSIX logical paths；
- traversal/absolute/backslash/control chars；
- Windows reserved names；
- trailing dot/space；
- case-fold collisions；
- reserved namespace；
- Windows/Linux 得到相同 canonical path identity。

### 36.2 Media/content

覆盖：

- Markdown/text UTF-8；
- JSON syntax；
- YAML syntax；
- unsupported media；
- per-file / per-World quota。

### 36.3 Object identity

覆盖：

- blob hash deterministic；
- same bytes deduplicate；
- canonical tree order；
- same logical tree → same bytes/hash；
- corrupt blob/tree fail-closed。

### 36.4 Overlay

覆盖：

```text
PUT create
PUT replace
DELETE existing
DELETE missing idempotent no-op
multiple writes collapse to final state
readEffective
listEffective
```

### 36.5 Published control

覆盖：

- only `idle/planned/awaiting-settle` can be committed；
- `planning/playing/revising/invalid/uninitialized` rejected from Commit；
- planned/awaiting-settle require current day；
- Session start/cancel does not advance current revision。

### 36.6 Operation lifecycle

覆盖：

```text
open → prepared → published
open → aborted
prepared → aborted
prepared publication failure → prepared + lastError
prepared retry same target
prepared staging mutation rejected
```

### 36.7 Publication/OCC

覆盖：

- normal publish；
- initialization publish；
- stale base conflict；
- conflict preserves prepared operation/staging；
- no current change before final replace；
- current advances only to complete target graph。

### 36.8 Fault injection

至少在以下边界注入 failure/crash：

```text
after blob materialization
after tree materialization
after commit materialization
after operation prepared
after publish lock
before current replace
after current replace
before operation diagnostic finalization
```

每个 fault 后重新打开 Archive 并验证 Published World theorem。

### 36.9 Recovery

覆盖：

```text
prepared + current==base
prepared + current==target
prepared + current==other
```

证明不会自动 replay/rebase。

### 36.10 Inspect/GC

覆盖：

- reachable graph；
- orphan objects；
- dry-run GC；
- retention；
- reachable object never deleted；
- open/prepared staging never guessed away。

### 36.11 Restart witness

真实 filesystem：

```text
initialize V2 World
→ begin operation
→ stage create/replace/delete
→ read effective view
→ prepare
→ publish
→ destroy repository instance
→ reopen from disk
→ read identical Published World
→ inspect integrity green
```

---

## 37. Platform evidence

至少验证：

```text
Node 20 / Ubuntu
Node 22 / Ubuntu
Node 20 / Windows
Node 22 / Windows
```

重点 theorem：

```text
logical path identity
portable collision policy
canonical tree hash
atomic current publication
restart recovery
GC reachability
```

Windows/Linux 必须得到相同 logical tree identity 和 canonical hash。

---

## 38. Phase 1 Freeze theorem

### 38.1 World truth

```text
PublishedWorld
= tree referenced by current.commit
```

不存在其它 Published World authority。

### 38.2 Staging isolation

```text
staged mutation
⇒ no published reader observes it
```

### 38.3 Deterministic candidate

```text
same pinned base tree
+ same final staging manifest
⇒ same candidate tree hash
```

### 38.4 Published control separation

```text
Commit control
⇒ stable PublishedWorldPhase only

Session/runtime state
⇒ not stored as Published World phase
```

### 38.5 Publication

```text
publish success
⇒ staged state validated
⇒ expected base still matched
⇒ immutable target graph complete
⇒ current atomically references target commit
⇒ target tree == overlay(base, staging)
```

### 38.6 Failure

```text
failure before current replacement
⇒ previous Published World remains current
```

### 38.7 Conflict

```text
current != pinned base
⇒ no publication
⇒ prepared staging preserved
⇒ no automatic rebase
```

### 38.8 Recovery

```text
recovery classification
= function(durable artifacts)
```

### 38.9 Extensibility

```text
new semantic World document path
⇒ no Archive core semantic schema change required
```

### 38.10 File-native semantics

```text
logical document tree
= product filesystem truth

physical object store/materialized projection
≠ second publication authority
```

### 38.11 Old-model exit

```text
V2 World publication
≠ canon/day/submission write path
```

---

## 39. Final acceptance checklist

只有以下全部满足，才允许进入 Phase 2：

- [ ] Archive V2 manifest/current/commit/tree/blob model implemented；
- [ ] `manifest.title` 明确定义为稳定 display identity；
- [ ] `PublishedWorldPhase` 与 Session/runtime phase 分离；
- [ ] Commit 不允许 transient/session/read-failure phase；
- [ ] Commit control 只保留 phase/day/lastSettledDay；
- [ ] `WorldDocumentPath` NFC canonicalization implemented；
- [ ] portable case-fold collision contract implemented；
- [ ] Windows reserved/path safety implemented；
- [ ] media/content validation implemented；
- [ ] SHA-256 blob identity + dedup implemented；
- [ ] canonical flat RootTree encoding/hash implemented；
- [ ] Dayloom World Profile v1 路径约定明确；
- [ ] Dayloom mutation policy 明确区分 replaceable / protected history；
- [ ] staging manifest 是唯一 staged truth；
- [ ] staging 只使用 PUT/DELETE algebra；
- [ ] prepared 后 staging immutable；
- [ ] candidate tree deterministic；
- [ ] effective read model implemented；
- [ ] `ArchiveOperationV2` durable base/target/status/lastError implemented；
- [ ] operation retry semantics implemented；
- [ ] pinned base conflict preserves staging；
- [ ] no auto merge/rebase；
- [ ] current atomic replace 是唯一 publication point；
- [ ] Session start/cancel 不再制造 Published World commit；
- [ ] orphan immutable objects 视为 garbage，不视为 partial publication；
- [ ] recovery 只按 durable facts 分类；
- [ ] inspect validates complete reachable graph；
- [ ] GC cannot delete reachable graph or open/prepared staging；
- [ ] V1 dual-read/dual-write absent；
- [ ] old canon/day/submission write path removed from V2 authority；
- [ ] physical object store 不被当作 logical World API；
- [ ] restart witness green；
- [ ] publication fault-injection suite green；
- [ ] Ubuntu/Windows × Node20/22 evidence green；
- [ ] Phase 1 tests do not require Promptpile/React/MCP/Compress；
- [ ] current documentation matches implemented V2 contract。

---

## 40. Phase 2 handoff

Phase 1 向 `PERSISTENT_CONVERSATION_COMPRESSION_DRAFT.md` 只提供：

```text
world identity
Published World identity
Session/operation workspace location
read published/effective documents
staging lifecycle
```

Phase 2 不得修改：

```text
Published World definition
PublishedWorldPhase separation
RootTree identity
staging algebra
publication theorem
```

Conversation compression 只能改变 AI history context，不能改变 World publication semantics。

---

## 41. Phase 3 handoff

Phase 3 的 Dayloom-scoped MCP tools 只能包装：

```text
world.read
world.list
staging.read
staging.list
staging.put
staging.delete
staging.inspect
```

但实际 mutation 必须先经过 Dayloom World Profile / mutation policy。

MCP 不拥有：

```text
World object identity
path canonicalization
staging algebra
publication transaction
current pointer
PublishedWorldPhase
conflict/recovery semantics
```

因此 MCP 是 adapter，不是 World domain model。

---

## 42. 最终边界

Phase 1 完成后的结构应保持为：

```text
Archive Identity
└─ manifest.json
   ├─ worldId
   ├─ title
   └─ createdAt

Publication Authority
└─ current.json
   └─ commitId
       ↓
     Commit
       ├─ parentCommitId
       ├─ rootTreeHash
       └─ Published control
          ├─ phase
          ├─ day
          └─ lastSettledDay
       ↓
     RootTree
       └─ logical path → Blob
```

工作态：

```text
Operation
├─ pinned base
├─ target identity
└─ Staging Manifest
   └─ PUT / DELETE
```

AI/runtime：

```text
Session / Conversation
≠ Published World
≠ Archive control plane
```

Publication：

```text
base tree
+ staging overlay
↓
candidate tree
↓
validate
↓
materialize immutable graph
↓
prepare/freeze operation
↓
re-check current == pinned base
↓
FINAL ATOMIC current replace
```

Phase 1 最终定义：

```text
Dayloom
= safely version a document-native World
+ keep semantic data flexible
+ keep control data minimal
+ isolate staging
+ publish atomically
+ recover from durable facts
```

当 checklist 与 executable evidence 全部完成后，本文件状态应改为：

```text
Implemented / Freeze complete
```

随后把稳定事实迁入 `doc/` canonical documentation，并删除本实施草案；历史演进由 Git history 保存。
