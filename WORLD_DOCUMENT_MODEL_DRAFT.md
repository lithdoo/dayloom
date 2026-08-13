# Dayloom 文档原生 World 数据模型重构草案

> 状态：Implementation Freeze / 待实施  
> 日期：2026-08-13  
> 目标：把 Dayloom 的 AI 语义内容从过度强类型结构迁移为文档原生 World，同时保留严格、最小、可验证的控制平面。  
> 实施顺序：**Phase 1 / 3**  
> 后续依赖：`PERSISTENT_CONVERSATION_COMPRESSION_DRAFT.md`、`PROMPTPILE_AGENT_RUNTIME_DRAFT.md`

## 1. 一句话结论

Dayloom V2 第一阶段只解决一个问题：**Dayloom 如何安全、确定性地版本化一个主要由 AI / 人理解和维护的文档世界。**

冻结后的职责边界：

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

但替换其内容模型：

```text
旧：canon/day/submission/domain-specific revisions

新：blob → canonical root tree → commit
```

核心目标不是“把 JSON 换成 Markdown”，而是消除 archive 对 AI 语义 schema 的 ownership。

---

## 2. Phase 1 的唯一架构目标

完成后，Published World 必须可以被精确定义为：

```text
Published World
= CurrentPointer
→ Commit
→ RootTree
→ immutable Blob(s)
```

其中：

- `CurrentPointer` 是唯一 publication authority；
- `Commit` 只引用一个完整 root tree，并保存最小 published control state；
- `RootTree` 是逻辑 World document path 到 immutable blob 的规范映射；
- `Blob` 保存原始文档 bytes；
- Session staging 与 Published World 严格隔离；
- Conversation 不属于 Published World。

成功的 World reader 不再需要理解：

- `CanonDocuments`；
- `PlanDocument`；
- `PlayDocument`；
- `PlayEventDocument`；
- `SettlementDocument`；
- `InitSubmission` / `PlanningSubmission` / `PlaySubmission` / `ReviseSubmission`；
- canon revision / day revision 的固定内容布局。

新增普通语义文档不应要求修改 archive core schema。

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

Phase 1 只实现和冻结前两个的 World 侧语义；第三个由 Phase 2 / Phase 3 消费。

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

不得引入第二个可以让未提交内容变成正式 World 的旁路。

---

## 4. Semantic plane 与 control plane

### 4.1 Semantic plane

主要由 AI / 人理解的内容采用文档原生模型，例如：

```text
world.md
rules.md
style.md
characters/**
locations/**
timeline/**
memory/**
days/**
custom/**
```

这些路径是产品/profile 约定，不是 archive core 的硬编码领域 schema。

Dayloom core 不应为了新增：

```text
characters/faction-a/leader.md
custom/economy/trade-routes.md
```

而新增对应 TypeScript domain type、validator、revision type 或 projector。

### 4.2 Control plane

程序必须确定性理解的内容保持严格结构化，包括：

- archive format/schema version；
- world identity；
- current revision / commit identity；
- commit parent relation；
- root tree identity；
- blob hash / size / media type；
- operation identity / state；
- pinned base identity；
- staging manifest；
- publish lock / conflict state；
- published business control state；
- integrity / recovery metadata。

原则：

```text
程序必须确定性理解它
→ structured

主要由 AI / 人理解它
→ document
```

“文档原生”不意味着 control plane 降低严格性；相反，语义越自由，控制面越必须严格。

---

## 5. Archive V2 物理布局

第一版冻结为一个扁平 canonical root tree + content-addressed blob store，不实现递归 Git-style Merkle tree。

推荐布局：

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
│                   └── <opaque-staging-file-id>
├── .locks/
│   └── publish.lock
└── logs/
    └── operations.jsonl
```

逻辑 World path 不直接决定物理 object-store path。

这一点用于避免：

- Windows / POSIX path 差异；
- case folding；
- device path；
- traversal；
- user-controlled path 直接进入内部存储布局。

---

## 6. Archive manifest

`manifest.json` 只描述 archive 身份与格式，不描述 Published World 内容。

概念形状：

```ts
interface ArchiveManifestV2 {
  schemaVersion: 2;
  worldId: string;
  createdAt: string;
}
```

World title、人物、世界介绍等语义内容应进入文档树，而不是不断扩张 manifest。

`current.json` 不存在时，archive 视为 `uninitialized`；即使 crash 留下尚未被 current 引用的 manifest / immutable objects，也不能视为 Published World。

---

## 7. WorldDocumentPath v1

文档路径本身是 V2 的稳定领域 vocabulary，必须在 Phase 1 冻结。

### 7.1 Identity

逻辑 path：

```text
- UTF-8 string
- relative
- `/` 作为唯一分隔符
- case-sensitive
- identity 不依赖宿主文件系统
```

例如：

```text
characters/Alice.md
characters/alice.md
```

在逻辑模型中是两个不同 path。

实现必须在写入物理对象前检测宿主平台无法安全表示的 collision；不得让 Windows case folding 改变逻辑身份。

### 7.2 必须拒绝

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
Windows drive / UNC / device forms
reserved Dayloom internal namespace
```

示例：

```text
valid:
world.md
characters/alice.md
days/day_0001/plan.md

invalid:
../world.md
/world.md
./world.md
characters\\alice.md
characters//alice.md
CON
```

### 7.3 Reserved namespace

World document tree 不得伪装 archive control plane。

至少保留一个明确内部 namespace，例如：

```text
.dayloom/**
```

第一版不得允许普通 World document 使用该 namespace。

内部 control files 仍保存在 archive object/control layout，不属于 root tree。

---

## 8. Media/content contract

第一版使用受控媒体类型集合，不接受任意隐式类型。

最低支持集合：

```text
text/markdown
text/plain
application/json
application/yaml
```

规则：

- 文本类文档必须是有效 UTF-8；
- `application/json` 必须语法合法；
- YAML 第一版可以只做 UTF-8 + 基础语法校验，不建立业务语义 schema；
- bytes 长度必须与记录值一致；
- 单文件和单 World 大小上限由配置/policy 控制；
- media type 必须显式保存到 tree entry，不只通过扩展名猜测。

必须坚持：

```text
syntax validation
≠ semantic validation
```

例如 `characters/alice.json` 可以验证为合法 JSON，但 archive core 不拥有 `name/age/relationships` 等业务字段 schema。

---

## 9. Blob identity

Blob 是 immutable raw bytes。

冻结：

```text
blobHash = lowercase hex SHA-256(raw bytes)
```

同一 bytes 必须得到同一 blob identity。

Blob object 必须满足：

```text
path hash
== SHA-256(actual bytes)
```

否则 archive integrity invalid。

Blob store 允许自然去重：

```text
same bytes
⇒ same blob
```

已存在同 hash blob 时不得覆盖为不同 bytes；若检测到 hash/path 与实际 bytes 不一致，必须 fail-closed。

---

## 10. Canonical RootTree v1

第一版 root tree 是一个扁平排序表。

概念类型：

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

### 10.1 Canonical order

`entries` 按规范 `path` 的 unsigned UTF-8 byte order 升序排列。

必须满足：

```text
unique path
+ canonical sorted order
+ valid media type
+ valid blob hash
+ bytes >= 0
```

### 10.2 Canonical encoding

Tree hash 必须由确定性编码得到。

第一版固定：

- UTF-8 JSON；
- 无 BOM；
- 固定字段顺序；
- 无无意义 whitespace；
- `entries` 已按 path canonical order 排序；
- newline policy 固定且由编码器统一实现。

定义：

```text
treeHash = lowercase hex SHA-256(canonicalTreeBytes)
```

不得直接依赖普通 `JSON.stringify` 对任意 object key insertion order 的偶然行为；应有专用 canonical tree encoder。

### 10.3 Integrity

一个有效 tree 必须满足：

```text
for every entry:
  referenced blob exists
  blob hash matches
  blob bytes matches
```

Tree 不保存 AI 语义类型。

---

## 11. Commit V2

Commit 只拥有 publication history 与最小 published control state。

概念形状：

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
    phase: WorldPhase;
    day: string | null;
    lastSettledDay: string | null;
  };
}
```

具体 control 字段可以在实施前根据现有 Runtime 业务约束做最小确认，但 Freeze 原则是：

```text
commit owns only published business control
```

不得重新引入：

```text
canonRevision
dayHeads
PlanDocument
PlayDocument
semantic content refs by domain type
```

### 11.1 Session 不属于 Published World 默认 truth

Phase 1 冻结：

```text
session id
operation id
staging state
recovery cursor
```

属于 Session/operation workspace，不默认写入 Published World commit。

“开启一个 AI Session”本身不自动制造 World revision。

只有真正属于 Published World 的业务控制变化才进入 commit control。

这样避免：

```text
runtime lifecycle noise
→ pollute immutable World history
```

如果未来业务明确要求“active session”本身成为 Published World 事实，必须作为新的显式 contract 讨论，而不能由 Phase 1 implementation 临时加入。

---

## 12. Staging overlay v1

Staging 是针对某个固定 base commit 的 overlay，而不是另一份完整 World copy。

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

这些行为第一版都归约为 `PUT` / `DELETE`。

例如 rename：

```text
DELETE old/path.md
PUT new/path.md
```

### 12.1 Final-state manifest

Staging manifest 保存每个 logical path 的**最终 staged mutation**，而不是完整操作日志。

同一路径重复修改：

```text
PUT A
PUT B
→ manifest only keeps PUT B
```

```text
PUT A
DELETE A
→ manifest only keeps DELETE A
```

因此同一个 base + 同一个最终 manifest 必须产生同一个 candidate tree。

概念形状：

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
  baseCommitId: string | null;
  baseRevision: number | null;
  baseRootTreeHash: string | null;
  changes: StagedChangeV1[];
}
```

`changes` 必须按 path canonical order 保存并保证 unique path。

### 12.2 Staging files

PUT 的 raw bytes 保存在：

```text
workspace/staging/files/<opaque-file-id>
```

不得使用 AI 提供的 logical path 直接构造 staging physical path。

manifest 中的 `sha256/bytes` 必须与 staging file 实际内容一致。

---

## 13. Pinned base / optimistic conflict contract

Operation 开始时必须 pin：

```text
baseRevision
baseCommitId
baseRootTreeHash
```

初始化操作则三者为 `null`。

Staging 全部基于该 base 解释。

Publication 前必须重新读取 current，并满足：

```text
current.revision == baseRevision
AND
current.commitId == baseCommitId
```

必要时同时验证 base commit 的 `rootTreeHash` 与 pinned value 一致。

如果 current 已改变：

```text
→ ARCHIVE_CONFLICT
→ no publication
→ staging preserved
```

第一版明确不做：

```text
automatic rebase
automatic merge
semantic conflict resolution
```

冲突后的处理由更高层显式决定。

---

## 14. Candidate tree

Candidate tree 是纯函数：

```text
candidateTree
= overlay(baseTree, stagingManifest)
```

语义：

- `PUT`：新增或替换 path；
- `DELETE`：从结果中移除 path；不存在 path 的 DELETE 是否允许必须固定为一种行为，第一版推荐 idempotent no-op；
- 未被 staging 提及的 path 原样继承 base；
- 输出重新 canonical sort；
- 输出必须通过完整 tree validation。

必须成立：

```text
same base tree
+ same staging manifest
⇒ same candidate tree bytes
⇒ same tree hash
```

Candidate tree 构建过程不调用 AI，不依赖 Conversation，不依赖当前 wall-clock time。

---

## 15. Effective read model

Phase 1 统一读模型：

### 15.1 Published read

```text
readPublished(path)
listPublishedPaths()
```

只从 current → commit → tree → blob 读取。

### 15.2 Session effective read

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

未来 MCP / TUI / Session read model 只能包装这些稳定能力，不应绕过 repository 直接扫描 object store。

Content search 不属于 archive core 的 Phase 1 contract；后续可以建立在 `list/read` 之上。

---

## 16. Public core capability boundary

Phase 1 实现完成后，核心业务能力至少应概念上包含：

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
validateStaging()
publish()
discard()/abort()

inspectArchive()
collectGarbage()
classifyRecovery()
```

具体 TypeScript API 名称可以在实施时优化，但 ownership 不得改变。

不得继续把 canonical write API 定义成：

```text
stageCanon()
stageDay()
stageSubmission()
```

MCP shape 也不得进入此领域 API。

---

## 17. Publication state machine

现有 Archive V1 “immutable objects first, current last”的事务思想保留并正式冻结。

推荐 V2 state machine：

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
write immutable commit candidate
↓
mark operation prepared
↓
acquire publish lock
↓
re-read current
↓
require current == pinned base
↓
re-validate target commit/tree/blob graph
↓
FINAL ATOMIC current.json REPLACE
↓
SUCCESS
↓
best-effort operation/log finalization
↓
release publish lock
```

实现可以在不改变 theorem 的前提下调整“预写 immutable object”与“锁获取”的具体位置，但最终必须满足：

```text
current replacement
= only visibility boundary
```

锁应尽可能只覆盖 publication critical section，不应覆盖长时间 document staging。

---

## 18. Publication theorem

成功必须证明：

```text
publish success
⇒ current references target commit
⇒ target commit exists and is immutable
⇒ target commit references complete valid root tree
⇒ root tree references only existing hash-valid blobs
⇒ target tree == overlay(pinned base tree, staged manifest)
⇒ published control state is valid
```

失败必须证明：

```text
failure before final current replacement
⇒ previous Published World remains current
```

明确允许：

```text
failure may leave unreachable immutable blobs/tree/commit
```

但禁止：

```text
failure exposes incomplete World
```

因此：

> **garbage is allowed; corrupt visible state is not.**

这条原则是 V2 crash safety 的核心。

---

## 19. Atomic current publication

`current.json` 是唯一需要原子替换的 mutable publication pointer。

概念形状：

```ts
interface CurrentPointerV2 {
  schemaVersion: 2;
  revision: number;
  commitId: string;
  updatedAt: string;
}
```

发布必须采用现有可移植 atomic-file 策略或等价机制：

```text
write temp
→ flush/sync as required
→ atomic rename/replace
→ sync parent directory where required
```

平台差异必须由 infrastructure 层吸收，不得改变 World-level success semantics。

---

## 20. Operation state machine

Operation metadata 至少需要能够区分：

```text
open
prepared
published
failed
aborted
```

重要语义：

```text
prepared
≠ published
```

`prepared` 仅表示 candidate immutable graph 已经足够完整，可以尝试 publication。

`published` 只能由 durable current pointer 事实证明。

Operation metadata 写失败不能反向否定已经完成的 current publication；current 仍是 publication truth。

---

## 21. Crash / recovery semantics

Recovery 不自动猜测或重放 publication 副作用，而是根据 durable facts 分类。

对于一个 prepared operation：

### 21.1 current 仍等于 base

```text
current == pinned base
→ target was not published
```

可以保留 staging / prepared objects，等待显式 retry 或 discard。

### 21.2 current 指向 target commit

```text
current.commitId == targetCommitId
→ publication succeeded
```

即使 operation metadata 仍写着 `prepared`，recovery 也应把它分类为 already-published，并可修复 diagnostics metadata。

### 21.3 current 已指向其它 commit

```text
current != base
AND
current != target
→ operation superseded/conflicted
```

不得自动 replay。

### 21.4 Recovery theorem

必须成立：

```text
recovery classification
= function(durable artifacts)
```

而不是：

```text
recovery
= guess + replay side effects
```

---

## 22. Cancel / discard semantics

Phase 1 默认冻结：

```text
cancel/discard staging
→ closes/discards operation workspace
→ Published World unchanged
```

Session start/cancel 不因为 runtime lifecycle 本身生成 World commit。

如果上层业务状态确实需要发布 phase/day 等 control change，则通过显式 World publication 表达，不依赖“Session 存在”这一事实隐式修改 World。

---

## 23. Integrity inspection

`inspectArchive()` 至少应验证：

```text
manifest valid
current valid
current commit exists
commit parent relation sane
commit rootTree exists
tree canonical encoding/hash valid
tree paths valid/unique/sorted
all blobs exist
all blob hashes match
all byte counts match
published control valid
```

并报告：

```text
reachable commits
a reachable trees/blobs set
unreachable immutable objects
interrupted/prepared operations
invalid/corrupt references
```

Inspection 必须是只读的。

---

## 24. Garbage collection

GC 只能删除**不可达 immutable objects**与满足 retention policy 的已关闭 operation workspace。

Reachability 从：

```text
current
→ commit parent chain
→ root trees
→ blobs
```

计算。

第一版允许 orphan immutable objects，因为它们是 crash-safe publication 的正常副产品。

GC 必须默认 dry-run / report-first；实际删除需显式开启。

GC 不得删除：

- current 可达 commit/tree/blob；
- 尚未关闭且可能继续 retry 的 operation staging；
- 无法确定 ownership 的对象。

---

## 25. Validation stack

Phase 1 validation 分四层，避免重新把 AI 语义塞回 archive schema。

### Layer 1 — Path

验证：

```text
canonical relative path
reserved namespace
platform-safe identity
collision
```

### Layer 2 — Content / media

验证：

```text
allowed media type
UTF-8 where required
JSON/YAML syntax where required
bytes quota
hash
```

### Layer 3 — Tree graph

验证：

```text
unique/sorted path
blob exists
hash matches
size matches
tree canonical hash matches
```

### Layer 4 — Control / publication

验证：

```text
commit parent
revision relation
published control
expected base
current conflict
operation state
```

明确不属于 archive core validation：

```text
character semantic fields
story semantics
plan semantic correctness
narrative event schema
AI-generated domain ontology
```

---

## 26. Security constraints

World document path 与 content 必须按 untrusted input 处理，尤其未来来自 AI / MCP 时。

必须覆盖：

```text
path traversal
absolute path
Windows drive / UNC / device names
symlink escape
case collision
NUL / control chars
reserved namespace injection
oversized file
oversized World
duplicate logical path
hash mismatch
malformed tree
malformed control JSON
```

AI-provided path 永远不能直接：

```text
path.join(worldRoot, aiPath)
```

必须经过 logical path parser / validator，并通过 repository/object-store abstraction 操作。

物理 blob/tree/object store 不允许通过 World document API 访问。

---

## 27. V1 → V2 breaking cutover

Phase 1 是明确 breaking migration。

默认 Freeze 决策：

```text
Archive V1
≠ Archive V2
```

V2 runtime 不做：

```text
implicit V1/V2 dual-read
implicit V1→V2 projection
V1/V2 dual-write
```

如果 dev 环境确认没有必须保留的外部 V1 World，可以直接切换 schema version 并废弃 V1 runtime write path。

如果后续确认存在必须保留的 V1 用户数据，应新增**显式、离线、一次性 migrator**：

```text
V1 archive
→ explicit migration
→ new V2 archive
```

Migrator 不得成为 V2 runtime 的长期 compatibility layer。

---

## 28. 旧强类型模型的退出条件

Phase 1 完成必须意味着：

```text
CanonDraft
DayDraft
canonRevision/dayRevision write path
strongly typed SessionSubmission publication
```

不再是 V2 canonical World write path。

允许短期 adapter：

```text
legacy semantic result
→ V2 stage PUT/DELETE
```

但只允许单向兼容：

```text
old model
→ new documents
```

禁止长期：

```text
old model ↔ new model dual synchronization
```

否则会重新产生双 truth。

当 Phase 1 Freeze 完成后：

- `ArchiveRepository` canonical API 不再暴露 `stageCanon()` / `stageDay()`；
- `CommitDraft` 不再包含 `canonRevision` / `dayHeads`；
- V2 reader 不再以旧 submission/schema 重建 Published World；
- 新增普通 World 文档不要求 core schema 修改。

---

## 29. 与当前 AI 调用的临时兼容边界

Phase 1 刻意不要求同步完成 Phase 2 / Phase 3。

允许当前 direct Promptpile adapter 暂时存在。

如果旧 `NaturalLanguageSession` 仍输出强类型 submission，为了独立完成 Phase 1，可以临时通过 adapter 将其转换为 V2 document staging。

但必须满足：

```text
AI/runtime compatibility adapter
≠ V2 World authority
```

Phase 1 correctness tests不得依赖：

- Promptpile；
- LLM 网络请求；
- promptpile-react；
- promptpile-mcp；
- promptpile-compress。

---

## 30. Phase 1 不做什么

Implementation Freeze 后明确停止扩大范围。

不做：

- persistent Promptpile Conversation；
- conversation compression / archive retrieval；
- promptpile-react；
- Agent Event Protocol；
- generic MCP executor；
- Dayloom MCP server；
- recursive Merkle tree；
- semantic diff / fuzzy patch；
- automatic merge / rebase；
- semantic schema registry；
- arbitrary binary media ecosystem；
- vector search；
- World content search engine；
- Conversation archive 与 World archive 合并。

这些都不能作为 Phase 1 Freeze blocker。

---

## 31. Executable evidence

Phase 1 Freeze 不以“代码看起来符合文档”为验收，而要求 architecture theorem 有 executable witness。

### 31.1 Path/media conformance

覆盖：

- valid POSIX logical paths；
- traversal / absolute / backslash / control chars；
- Windows reserved/case collisions；
- reserved namespace；
- UTF-8 / JSON / YAML validation；
- media allowlist；
- file/world quota。

### 31.2 Object identity

覆盖：

- blob hash deterministic；
- same bytes deduplicate；
- canonical tree order；
- same logical tree → same canonical bytes/hash；
- corrupt blob/tree fail-closed。

### 31.3 Overlay behavior

覆盖：

```text
PUT create
PUT replace
DELETE existing
DELETE missing idempotent no-op
multiple writes same path collapse to final state
readEffective
listEffective
```

### 31.4 Publication / OCC

覆盖：

- normal publish；
- stale base conflict；
- conflict preserves staging；
- no current change before final publication；
- current atomically advances only to complete target graph。

### 31.5 Fault injection

在 publication mutation boundaries 注入 crash/failure，至少覆盖：

```text
after blob materialization

after tree materialization

after commit materialization

after operation prepared

after publish lock

before current replace

after current replace

before operation status finalization
```

每个 fault 后重新打开 archive 并验证 Published World theorem。

### 31.6 Recovery

覆盖：

```text
prepared + current==base
prepared + current==target
prepared + current==other
```

并证明不会自动 replay publication。

### 31.7 Inspect / GC

覆盖：

- reachable graph；
- orphan blob/tree/commit；
- dry-run GC；
- retention；
- reachable object never deleted。

### 31.8 Restart witness

真实文件系统 witness：

```text
initialize V2 World
→ begin operation
→ stage create/replace/delete
→ read effective view
→ publish
→ destroy in-memory repository
→ reopen from disk
→ read identical Published World
→ inspect integrity green
```

---

## 32. Platform evidence

World logical identity 必须跨平台稳定。

Phase 1 至少应在：

```text
Node 20 / Ubuntu
Node 22 / Ubuntu
Node 20 / Windows
Node 22 / Windows
```

验证核心 filesystem/path/publication tests。

如果项目最终决定统一不同 Node support floor，可以在实施阶段按仓库整体 runtime contract调整，但 Windows/Linux 双平台 evidence 不能省略。

重点不是“所有测试都跑四次”，而是以下 theorem 必须跨平台：

```text
logical path identity
canonical tree hash
atomic publication
restart recovery
GC reachability
```

---

## 33. Phase 1 Freeze theorem

实现完成后必须同时证明以下不变量。

### 33.1 World truth

```text
PublishedWorld
= tree referenced by current.commit
```

不存在其它 Published World authority。

### 33.2 Staging isolation

```text
staged mutation
⇒ no published reader observes it
```

### 33.3 Deterministic candidate

```text
same base tree
+ same staging manifest
⇒ same candidate tree hash
```

### 33.4 Publication

```text
publish success
⇒ staged state validated
⇒ expected base still matched
⇒ immutable target graph complete
⇒ current atomically references target commit
⇒ target tree equals overlay(base, staging)
```

### 33.5 Failure

```text
failure before current replacement
⇒ previous Published World remains current
```

### 33.6 Conflict

```text
current != pinned base
⇒ no publication
⇒ staging preserved
```

### 33.7 Recovery

```text
recovery classification
⇒ depends only on durable artifacts
```

### 33.8 Extensibility

```text
new semantic World document path
⇒ no archive core semantic schema change required
```

### 33.9 Old-model exit

```text
V2 World publication
≠ canon/day/submission write path
```

---

## 34. Phase 1 Final acceptance checklist

只有以下全部满足，才允许进入 Phase 2：

- [ ] Archive V2 object model implemented；
- [ ] `WorldDocumentPath` parser/validator frozen；
- [ ] media/content validation implemented；
- [ ] SHA-256 blob identity + dedup implemented；
- [ ] canonical RootTree encoding/hash implemented；
- [ ] Commit V2 only references root tree + minimal control；
- [ ] staging manifest is unique staged truth；
- [ ] staging only exposes PUT/DELETE algebra；
- [ ] effective read model implemented；
- [ ] pinned base conflict semantics implemented；
- [ ] no auto rebase/merge；
- [ ] atomic current publication is sole visibility boundary；
- [ ] orphan immutable objects treated as garbage, not partial publication；
- [ ] recovery classifies durable state without automatic replay；
- [ ] inspect validates complete reachable graph；
- [ ] GC cannot delete reachable graph；
- [ ] V1 dual-read/dual-write absent；
- [ ] old canon/day/submission write path removed from V2 authority；
- [ ] restart witness green；
- [ ] publication fault-injection suite green；
- [ ] Windows/Linux path/publication evidence green；
- [ ] Phase 1 tests do not require Promptpile/React/MCP/Compress；
- [ ] current documentation matches implemented V2 contract。

---

## 35. Phase 2 handoff

Phase 1 向 `PERSISTENT_CONVERSATION_COMPRESSION_DRAFT.md` 只提供稳定 identity 与 repository capabilities：

```text
world identity
session/operation workspace location
published commit identity
read published/effective documents
staging lifecycle
```

Phase 2 不得修改：

```text
Published World definition
RootTree identity
publication theorem
staging isolation
```

Conversation compression 只能改变 AI history context，不能改变 World publication semantics。

---

## 36. Phase 3 handoff

Phase 3 的 Dayloom-scoped MCP tools 只能包装 Phase 1 已冻结的业务能力，例如：

```text
world.read
world.list
staging.read
staging.list
staging.put
staging.delete
staging.inspect
```

MCP 不拥有：

```text
World object identity
staging algebra
publication transaction
current pointer
conflict/recovery semantics
```

因此 MCP 是 adapter，不是 World domain model。

---

## 37. 最终边界

Phase 1 完成后的架构应保持简单：

```text
                     Dayloom World V2
                            │
            ┌───────────────┴───────────────┐
            │                               │
            ▼                               ▼
      Published World                 Session Staging
            │                               │
         current                         manifest
            │                               │
          commit                         PUT/DELETE
            │                               │
       canonical tree ─────── overlay ──────┘
            │
           blobs
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
materialize immutable objects
↓
CAS/re-check current against pinned base
↓
FINAL ATOMIC current replace
```

Phase 1 的最终定义：

```text
Dayloom
= safely version a document-native World
+ isolate staging
+ publish atomically
+ recover by durable facts
```

当 checklist 与 executable evidence 全部完成后，本文件状态应改为：

```text
Implemented / Freeze complete
```

随后把稳定事实迁入 `doc/` canonical documentation，并删除本阶段实施草案；历史演进由 Git history 保存。
