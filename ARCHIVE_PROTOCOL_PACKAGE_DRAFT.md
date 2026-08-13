# Dayloom Archive Protocol 独立包实施冻结草案

> 状态：Implementation Freeze / 待实施  
> 日期：2026-08-13  
> 包名：`@dayloom/archive-protocol`  
> 实施顺序：**Phase 1A / 3**  
> 配套实施：`DAYLOOM_ARCHIVE_PROTOCOL_ADAPTATION_DRAFT.md`  
> 原则：协议先 Freeze，`@dayloom/core` 直接消费；本阶段不创建 `@dayloom/archive` runtime package。

## 1. 一句话定义

`@dayloom/archive-protocol` 是 **Dayloom Archive V2 磁盘协议的稳定、纯函数、可执行投影**。

```text
@dayloom/archive-protocol
= public Archive data contract
+ parser / validator
+ canonical encoder
+ hash / path / ordering rules
+ pure graph semantics

≠ filesystem repository
≠ transaction runtime
≠ publish lock / OCC
≠ atomic write
≠ recovery side effect
≠ Dayloom game runtime
≠ Session / Promptpile / MCP
```

它只回答：

> **“这些 Archive bytes、JSON、hash、path 和引用图是什么意思，是否合法，是否具有唯一规范解释？”**

它不回答：

> “从哪里读文件、如何加锁、如何原子发布、如何回退、当前 Dayloom 能执行什么命令。”

Phase 1A 直接创建该 package；`@dayloom/core` 是第一个 runtime consumer。

未来独立工具可以直接依赖它：

```text
archive verify
archive migration
archive rollback
history inspector
future branch manager
```

这些工具可以自行拥有 I/O，但凡执行 mutation，必须独立满足本协议定义的 publication theorem；不能因为“用了 protocol parser”就直接改 `current.json`。

---

## 2. 为什么现在必须独立成包

Archive V2 已经不是 `@dayloom/core` 的私有 persistence detail。

目标 consumer 已经明确：

```text
@dayloom/core
→ Dayloom gameplay/runtime consumer

verify / inspect
→ 可以完全不启动 Dayloom core

migration
→ 只关心 Archive versions / objects

rollback / history
→ 只关心 Archive history/publication

future branch manager
→ 不应该依赖 daily/play/session
```

因此 package separation 是 ownership，而不是“为了复用而抽象”。

本阶段依赖方向冻结为：

```text
@dayloom/archive-protocol
          ↑
      @dayloom/core
          ↑
      @dayloom/tui
```

独立工具：

```text
archive-tool
     ↓
@dayloom/archive-protocol
```

本阶段**不引入**：

```text
@dayloom/archive
```

原因不是否定未来可能存在 Archive runtime package，而是当前改动面过大；先把稳定协议与现有 Core runtime 解耦，就已经能获得最主要的 architecture value。

---

## 3. Admission rule

只有同时满足以下条件的能力可以进入 `@dayloom/archive-protocol`：

```text
public Archive contract
+ pure data or deterministic function
+ no filesystem/runtime lifecycle effect
+ versioned normative semantics
+ conformance fixtures
+ real reuse outside one private core module
```

禁止因为“看起来通用”就搬进协议包。

### 3.1 允许进入

- public TypeScript types；
- strict parser；
- canonical formatter / encoder；
- path normalization / comparator；
- hash identity；
- pure tree overlay / diff；
- pure graph validation；
- pure recovery classification；
- pure archive-relative layout helpers；
- machine-readable schema / fixtures。

### 3.2 永久排除

```text
fs read/write
mkdir/rm/rename
realpath/cwd
symlink traversal
lock acquisition
PID liveness
fsync
atomic file replacement execution
workspace mutation
GC deletion
process lifecycle
Dayloom Session
Promptpile
MCP
TUI
```

协议可以定义这些动作必须满足的**语义合同**，但不能执行它们。

---

## 4. Package surface

推荐目录：

```text
packages/archive-protocol/
├── package.json
├── README.md
├── src/
│   ├── index.ts
│   ├── manifest.ts
│   ├── current.ts
│   ├── commit.ts
│   ├── path.ts
│   ├── media.ts
│   ├── blob.ts
│   ├── tree.ts
│   ├── staging.ts
│   ├── operation.ts
│   ├── layout.ts
│   ├── recovery.ts
│   └── errors.ts
├── schema/
└── test/
    └── fixtures/
```

Public exports 可以按稳定领域拆分，例如：

```text
@dayloom/archive-protocol
@dayloom/archive-protocol/path
@dayloom/archive-protocol/tree
@dayloom/archive-protocol/staging
```

第一版避免形成无边界 toolbox；只公开真实跨 consumer 使用的 surface。

禁止：

```text
@dayloom/archive-protocol/dist/*
workspace source-relative imports
```

---

## 5. Protocol 总体数据图

Published World：

```text
ArchiveManifestV2

CurrentPointerV2
      │
      ▼
ArchiveCommitV2
      │ rootTreeHash
      ▼
RootTreeV1
      │
      ├─ path → blobHash
      ├─ path → blobHash
      └─ path → blobHash
```

Working state：

```text
ArchiveOperationV2
        │
        ├─ pinned base
        ├─ prepared target
        └─ StagingManifestV1
```

必须始终成立：

```text
Published truth
= current referenced immutable graph
```

operation / staging / log 均不能成为 Published truth。

---

## 6. ArchiveManifestV2

```ts
export interface ArchiveManifestV2 {
  schemaVersion: 2;
  worldId: string;
  title: string;
  createdAt: string;
}
```

语义：

- `worldId`：稳定机器身份；
- `title`：Hub / CLI 可直接读取的稳定展示标签；
- `createdAt`：Archive identity metadata；
- 可变化的故事标题、世界简介等 semantic content 不进入 manifest。

规则：

```text
current absent
⇒ Archive has no Published World
```

provisional manifest/orphan objects 不能替代 `current`。

---

## 7. CurrentPointerV2

```ts
export interface CurrentPointerV2 {
  schemaVersion: 2;
  revision: number;
  commitId: string;
  updatedAt: string;
}
```

不变量：

```text
first published revision = 1
next successful publication revision = previous + 1
commitId valid
updatedAt valid timestamp
```

Pointer 不重复保存：

```text
rootTreeHash
phase
day
```

这些必须从 Commit 读取，避免第二 truth。

Protocol 只定义 pointer 意义，不执行 atomic replacement。

---

## 8. PublishedWorldPhase

Archive V2 只保存稳定 Published business state：

```ts
export type PublishedWorldPhase =
  | 'idle'
  | 'planned'
  | 'awaiting-settle';
```

以下不是 Commit phase：

```text
uninitialized
initializing
planning
playing
revising
invalid
```

其来源分别是：

```text
uninitialized → current absent
active phases → Session/Runtime projection
invalid → parser/validation result
```

协议知道 `PublishedWorldPhase`，因为它是 Dayloom Archive disk contract 的最小稳定业务控制；协议仍然不理解 character/scene/plan/event 等 narrative schema。

---

## 9. ArchiveCommitV2

```ts
export interface ArchiveCommitV2 {
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

最低不变量：

```text
revision >= 1

phase == planned
⇒ day != null

phase == awaiting-settle
⇒ day != null
```

Commit 不拥有：

```text
activeSession
canonRevision
dayHeads
Session status
Conversation path
PlanDocument
PlayDocument
character schema
```

RootTree 是唯一 semantic content reference。

---

## 10. WorldDocumentPath v1

所有 producer / consumer 必须共享同一 path identity。

### 10.1 Canonicalization

```text
raw string
→ Unicode NFC normalize
→ strict validate
→ canonical WorldDocumentPathV1
```

规范 path：

```text
UTF-8
relative
`/` separator
NFC
case-sensitive logical identity
host-independent
```

### 10.2 Portable collision

Dayloom Archive V2 要求合法 tree 能跨 Windows/Linux 安全 materialize。

第一版：

```text
portableCollisionKey(path)
= NFC(path).toLowerCase()
```

同一 RootTree 中：

```text
canonical path unique
AND
portableCollisionKey unique
```

所以：

```text
characters/Alice.md
characters/alice.md
```

不能共存。

### 10.3 Rejection

至少拒绝：

```text
empty
absolute
leading/trailing /
. segment
.. segment
empty segment
backslash
NUL
ASCII controls
Windows drive / UNC
Windows reserved device names
segment ending dot/space
portable-invalid chars
.dayloom/**
non-NFC stored path
```

Public pure API：

```ts
normalizeWorldDocumentPathV1(raw)
parseWorldDocumentPathV1(raw)
compareWorldDocumentPathsV1(a, b)
portableCollisionKeyV1(path)
```

---

## 11. Media/content contract

第一版允许：

```text
text/markdown
text/plain
application/json
application/yaml
```

Protocol owns：

- media vocabulary；
- UTF-8 requirement；
- JSON/YAML syntax requirement；
- byte count contract；
- pure content validation helpers。

必须成立：

```text
syntax validation
≠ semantic validation
```

Protocol 不验证 character/story/plan 等业务字段。

---

## 12. Blob identity

```text
blobHashV1
= lowercase hex SHA-256(raw bytes)
```

Public pure API：

```ts
hashBlobV1(bytes)
isBlobHashV1(value)
verifyBlobV1(bytes, expectedHash, expectedBytes)
```

同一 bytes 必须产生同一 identity。

Protocol 定义 identity，不定义 blob 如何落盘。

---

## 13. Canonical RootTree v1

```ts
export interface DocumentTreeEntryV1 {
  path: string;
  blobHash: string;
  mediaType: string;
  bytes: number;
}

export interface RootTreeV1 {
  schemaVersion: 1;
  entries: DocumentTreeEntryV1[];
}
```

### 13.1 Ordering

`entries` 按 canonical path 的 unsigned UTF-8 bytes 升序。

必须满足：

```text
canonical NFC path
path unique
portableCollisionKey unique
canonical order
valid hash/media/bytes
```

### 13.2 Canonical bytes

Protocol package 拥有唯一 encoder：

```ts
encodeRootTreeCanonicalV1(tree): Uint8Array
```

冻结：

- UTF-8 JSON；
- no BOM；
- fixed field order；
- no insignificant whitespace；
- fixed newline policy；
- entries canonical sorted。

```text
treeHashV1
= SHA-256(canonical tree bytes)
```

Consumer 不得自行用任意 `JSON.stringify` 重新定义 identity。

### 13.3 Validation

Protocol 可以验证 tree 结构；需要实际 blob bytes 的完整 graph check 使用 caller-provided facts/resolver data，不能在包内读 filesystem。

---

## 14. StagingManifestV1

Mutation algebra 只有：

```text
PUT
DELETE
```

```ts
export type StagedChangeV1 =
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

export interface StagingManifestV1 {
  schemaVersion: 1;
  baseRevision: number;
  baseCommitId: string | null;
  baseRootTreeHash: string | null;
  changes: StagedChangeV1[];
}
```

`changes` 是 final-state manifest，不是 edit log。

Pure overlay：

```ts
overlayRootTreeV1(base, staging)
```

必须满足：

```text
same base
+ same staging manifest
⇒ same candidate tree bytes/hash
```

DELETE missing 第一版为 idempotent no-op。

`fileId` 只是协议记录字段；它如何映射 operation workspace 物理路径由 consumer runtime 定义。

---

## 15. ArchiveOperationV2

```ts
export interface ArchiveOperationV2 {
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
  lastError: ArchiveProtocolErrorData | null;
}
```

状态语义：

```text
open
→ staging mutable

prepared
→ staging immutable
→ exactly one target tree/commit

published
→ terminal diagnostic state

aborted
→ terminal diagnostic state
```

第一版没有 terminal `failed`。

失败但 current 未推进：

```text
open/prepared remains
+ lastError updated
```

retry 是否执行由 Core/tool 决定；同一个 prepared operation 不允许重新解释 candidate。

---

## 16. Pure tree/history algebra

协议层可以拥有不产生 side effect 的图算法：

```text
overlay(baseTree, staging)
diff(treeA, treeB)
validate parent graph over supplied facts
ancestor walk over supplied commits
reachability over supplied graph
```

这些能力让 verify/history/migration 工具可以直接依赖 protocol。

它们不拥有：

```text
scan filesystem
publish commit
move current
GC delete
```

---

## 17. Pure recovery classification

Protocol 可以提供：

```ts
classifyOperationRecoveryV2({ operation, current })
```

例如 prepared operation：

```text
current == target
→ already-published

current == base
→ not-published / retryable

current != base && current != target
→ superseded/conflict
```

必须满足：

```text
recovery classification
= function(durable facts)
```

但 Protocol 不负责：

```text
scan disk
repair operation.json
retry publication
delete orphan
```

---

## 18. Public physical layout vocabulary

独立 verify/migration/history 工具需要对同一个 Archive 定位同类对象，因此 V2 的稳定**archive-relative layout vocabulary**进入协议；Protocol 只构造/解析相对路径，不执行 I/O。

冻结顶层 namespace：

```text
manifest.json
current.json
commits/
objects/trees/sha256/
objects/blobs/sha256/
operations/
.locks/
logs/
```

Pure helpers：

```ts
formatCommitObjectPathV2(id)
formatTreeObjectPathV1(hash)
formatBlobObjectPathV1(hash)
formatOperationPathV2(id)
```

它们只返回 canonical archive-relative path。

`.locks` / `logs` 的内部 payload 若尚未需要跨工具稳定复用，不在第一版公开全部字段。

---

## 19. Parser / validator contract

所有 parser：

```text
unknown input
→ valid frozen value
OR
→ structured protocol error
```

禁止：

- wrong type silent coercion；
- unsupported schemaVersion warning-and-continue；
- 把磁盘中非 canonical path 静默修正为合法值；
- 猜测未来版本。

建议：

```ts
parseArchiveManifestV2(value)
parseCurrentPointerV2(value)
parseArchiveCommitV2(value)
parseRootTreeV1(value)
parseStagingManifestV1(value)
parseArchiveOperationV2(value)
```

Version mismatch fail-closed。

---

## 20. Error surface

Protocol error 必须稳定、纯、可序列化，不把 Node filesystem errors 伪装成 protocol error。

最低类别：

```text
ARCHIVE_PROTOCOL_VERSION_UNSUPPORTED
ARCHIVE_PROTOCOL_SHAPE_INVALID
ARCHIVE_PROTOCOL_PATH_INVALID
ARCHIVE_PROTOCOL_PATH_COLLISION
ARCHIVE_PROTOCOL_MEDIA_INVALID
ARCHIVE_PROTOCOL_HASH_INVALID
ARCHIVE_PROTOCOL_TREE_INVALID
ARCHIVE_PROTOCOL_COMMIT_INVALID
ARCHIVE_PROTOCOL_OPERATION_INVALID
ARCHIVE_PROTOCOL_REFERENCE_INVALID
```

Tests 断言稳定 code，不锁完整英文 message。

---

## 21. Publication protocol theorem

Protocol 不执行 publication，但所有 mutating consumer 必须共同遵守这套成功语义。

合法 publication：

```text
resolve pinned base
↓
validate staging
↓
materialize candidate immutable graph
↓
acquire exclusive publication ownership
↓
re-read current
↓
require current == pinned base
↓
verify target graph
↓
FINAL ATOMIC current replacement
↓
SUCCESS
```

成功：

```text
publish success
⇒ current references complete valid target commit
⇒ commit references complete valid root tree
⇒ tree references only hash-valid blobs
⇒ target tree == overlay(pinned base tree, staging)
```

失败：

```text
failure before current replacement
⇒ previous Published World remains current
```

允许：

```text
unreachable immutable garbage
```

禁止：

```text
partially visible World
```

因此：

> **garbage is allowed; corrupt visible state is not.**

任何直接依赖 Protocol 的 rollback/branch/migration mutator，都必须自己实现并证明这一 theorem；直接写 pointer 不构成 conforming implementation。

---

## 22. History / rollback / branch compatibility

### 22.1 History

`parentCommitId` 是 V2 历史链的正式语义。

Protocol 可提供 pure ancestor/diff/graph helpers。

### 22.2 Rollback

冻结语义：

```text
rollback to old commit C
≠ move current backward

rollback
= publish a NEW commit
  whose tree/control are selected from C
```

因此：

```text
current revision remains monotonic
history remains append-only
```

具体 I/O/lock/publication 由 rollback tool 自己负责。

### 22.3 Branch

Phase 1A 不增加 branch refs/DAG schema。

只要求当前 protocol 不把未来 branch 逻辑塞进 `@dayloom/core` 私有格式。

当 branch 成为真实功能时，通过明确的新/additive protocol contract 引入。

---

## 23. Conformance fixtures

独立 package Freeze 必须拥有 repo-level fixtures，不允许只有 TypeScript happy-path tests。

推荐：

```text
fixtures/archive-protocol/v2/
├── valid/
├── invalid/
├── canonical/
└── graphs/
```

覆盖：

- manifest/current/commit；
- PublishedWorldPhase；
- NFC path；
- traversal；
- Windows reserved names；
- case-fold collision；
- media validation；
- root tree canonical ordering；
- canonical bytes/hash golden files；
- blob hashes；
- PUT/DELETE overlay；
- prepared operation invariants；
- recovery classification；
- malformed references；
- unsupported version fail-closed。

Golden fixtures 必须让 Core 和独立工具对同一输入得到同一 hash/parse/result。

---

## 24. Package theorem

Freeze 后必须证明：

```text
same Archive Protocol version
+ same protocol facts
⇒ every conforming consumer obtains same meaning
```

具体包括：

```text
same canonical path
same canonical tree bytes
same blob hash\same tree hash
same recovery classification
```

这些不应依赖：

```text
consumer package
OS filesystem semantics
object insertion order
Dayloom Runtime state
```

---

## 25. Dependency / architecture guard

目标：

```text
@dayloom/archive-protocol
= no @dayloom/core dependency
= no Promptpile dependency
= no filesystem/process lifecycle
```

静态 guard 至少禁止：

```text
node:fs
node:fs/promises
child_process
@dayloom/core
@dayloom/tui
promptpile*
```

允许纯算法标准库，例如 hash 所需 crypto。

Core 后续也必须禁止复制以下协议定义：

```text
ArchiveManifestV2
CurrentPointerV2
ArchiveCommitV2
RootTreeV1
StagingManifestV1
ArchiveOperationV2
WorldDocumentPath rules
```

只能通过 package public exports 消费。

---

## 26. Implementation order

### A. Package skeleton

- 创建 `packages/archive-protocol`；
- exports；
- build/test；
- architecture guard。

### B. Data contracts / strict parsers

- manifest/current/commit；
- path/media/blob；
- tree；
- staging/operation。

### C. Deterministic algorithms

- NFC/path validation；
- comparator / portable collision；
- canonical tree encoder/hash；
- overlay/diff；
- recovery classification。

### D. Conformance fixtures

先锁死协议，再允许 Core V2 runtime 完整迁移。

### E. Packed package evidence

- npm pack；
- fresh install；
- public exports only；
- golden fixture parse/hash smoke。

---

## 27. CI Freeze evidence

至少：

```text
protocol build
protocol unit tests
conformance fixtures
architecture guard
npm pack
fresh-install public-surface smoke
```

Node floor 不因未来 Promptpile runtime 被迫抬高；纯协议包声明什么 runtime support，就必须用 package CI 证明什么 support。

---

## 28. Final acceptance checklist

- [ ] `@dayloom/archive-protocol` 是独立 workspace package。
- [ ] 无 `@dayloom/core` 依赖。
- [ ] 无 filesystem/process lifecycle effects。
- [ ] Manifest/Current/Commit V2 冻结。
- [ ] `PublishedWorldPhase` 冻结。
- [ ] WorldDocumentPath v1 NFC/portable rules 冻结。
- [ ] Media/content syntax contract 冻结。
- [ ] Blob SHA-256 identity 冻结。
- [ ] RootTree v1 canonical encoder/hash 冻结。
- [ ] Staging PUT/DELETE contract 冻结。
- [ ] ArchiveOperationV2/recovery classification 冻结。
- [ ] Archive-relative layout helpers 冻结。
- [ ] Publication theorem 有 normative contract。
- [ ] rollback = new publication 语义冻结。
- [ ] branch 没有被错误提前塞入 v1。
- [ ] conformance fixtures 覆盖正/负/golden。
- [ ] packed fresh-install public surface green。
- [ ] architecture guard green。
- [ ] Core 可以只通过 public exports 消费协议。

---

## 29. Freeze theorem

最终必须可以写成：

```text
@dayloom/archive-protocol
= one stable executable definition
  of Dayloom Archive V2 data meaning
```

以及：

```text
∀ conforming consumers
same Archive V2 facts
⇒ same path identity
⇒ same parse result
⇒ same canonical tree bytes/hash
⇒ same operation classification
```

同时：

```text
protocol conformance
≠ mutation correctness
```

任何 mutating consumer 仍需单独证明 publication theorem。

---

## 30. Freeze 后治理

实施完成后：

1. 稳定 Archive Protocol 迁入 canonical `doc/` contract/reference；
2. package README 面向 consumer，记录 public exports / exclusions；
3. conformance fixtures 成为 executable authority；
4. 删除本实施草案；
5. Git history 保留拆包过程。

目标：

```text
canonical docs
+ @dayloom/archive-protocol
+ fixtures/tests
= current truth

implementation draft
= temporary migration artifact
```
