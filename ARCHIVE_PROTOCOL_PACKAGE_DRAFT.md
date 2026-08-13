# Dayloom Archive Protocol 独立包实施草案

> 状态：Implementation Freeze / 待实施  
> 日期：2026-08-13  
> 包名：`@dayloom/archive-protocol`  
> 实施顺序：**Phase 1A / 3**  
> 后续：`DAYLOOM_ARCHIVE_ADAPTATION_DRAFT.md`  
> 原则：协议先 Freeze，Dayloom runtime 再适配；本包不拥有 filesystem / transaction / gameplay。

## 1. 一句话定义

`@dayloom/archive-protocol` 是 **Dayloom Archive v2 磁盘协议的稳定、纯函数、可执行投影**。

```text
@dayloom/archive-protocol
= public archive data contract
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

本包只回答：

> **“这些 Archive bytes、JSON、hash、path 和引用图是什么意思，是否合法，是否规范一致？”**

它不回答：

> “从哪里读文件、如何加锁、如何发布、如何回退、当前 Dayloom 能执行什么命令。”

---

## 2. 为什么必须独立成包

Archive v2 不再只是 `@dayloom/core` 的内部 persistence detail。

目标 consumer 至少包括：

```text
@dayloom/archive
@dayloom/core（间接）
archive verify / inspect tools
archive migration tools
archive rollback/history tools（通过 @dayloom/archive）
future branch management（通过 @dayloom/archive）
```

因此依赖关系应固定为：

```text
                @dayloom/archive-protocol
                    pure / no I/O
                          │
                          ▼
                    @dayloom/archive
                  transactional runtime
                          │
             ┌────────────┴────────────┐
             ▼                         ▼
       @dayloom/core              archive tools
       game/domain runtime        verify/history/...
             │
             ▼
        @dayloom/tui
```

Archive protocol 不应被迫依赖完整 game runtime 才能校验一个存档。

---

## 3. Normative ownership

Phase 1A 冻结以下 ownership：

### Protocol owns

- Archive format/schema version；
- Archive manifest 数据形状；
- current pointer 数据形状；
- commit 数据形状；
- `PublishedWorldPhase`；
- root tree 数据形状；
- blob identity；
- World document path canonicalization；
- portable collision semantics；
- staging manifest 数据形状；
- durable operation metadata 数据形状；
- canonical encoding；
- canonical ordering；
- hash identity；
- pure parsing / validation；
- pure tree overlay / diff；
- pure durable recovery classification；
- protocol compatibility / version rejection。

### Protocol explicitly does not own

- `fs` / path discovery / directory traversal；
- real archive root resolution；
- mkdir / readFile / writeFile；
- temp file / rename / fsync；
- lock lifecycle；
- OCC mutation claim；
- staging physical-file management；
- immutable object promotion；
- `current.json` publication；
- rollback publication；
- branch ref publication；
- GC deletion；
- repair execution；
- Dayloom World Profile；
- Dayloom mutation policy；
- Runtime command availability；
- Session lifecycle；
- Promptpile / React / MCP / compression。

依赖方向必须保持：

```text
archive-protocol
must not import
@dayloom/archive
@dayloom/core
@dayloom/tui
Promptpile ecosystem
Node filesystem APIs
```

---

## 4. Public protocol vocabulary

第一版公开协议至少包含以下稳定 vocabulary。

### 4.1 ArchiveManifestV2

```ts
export interface ArchiveManifestV2 {
  schemaVersion: 2;
  worldId: string;
  title: string;
  createdAt: string;
}
```

语义：

- `worldId`：Archive 稳定机器身份；
- `title`：Hub / CLI 可直接读取的稳定展示标签；
- `createdAt`：Archive 创建时间；
- manifest 不保存可变化的 World semantic documents。

### 4.2 CurrentPointerV2

```ts
export interface CurrentPointerV2 {
  schemaVersion: 2;
  revision: number;
  commitId: string;
  updatedAt: string;
}
```

协议只定义 pointer 的数据意义与不变量，不定义其原子替换方式。

### 4.3 PublishedWorldPhase

```ts
export type PublishedWorldPhase =
  | 'idle'
  | 'planned'
  | 'awaiting-settle';
```

明确禁止进入 commit：

```text
uninitialized
initializing
planning
playing
revising
invalid
```

这些属于 archive absence、Session/Runtime projection 或读取结果，不是 Published World 状态。

### 4.4 ArchiveCommitV2

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

最低 control invariants：

```text
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
PlanDocument
PlayDocument
semantic domain references
```

### 4.5 DocumentTreeEntryV1 / RootTreeV1

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

RootTree 是一个完整逻辑 World snapshot，不是操作日志。

### 4.6 StagingManifestV1

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

协议定义 staging manifest 的逻辑语义，但不定义 `fileId` 对应哪个物理文件路径。

### 4.7 ArchiveOperationV2

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
  lastError: SerializableArchiveError | null;
}
```

协议冻结状态含义：

```text
open
→ staging may still change

prepared
→ exactly one immutable candidate graph / target identity

published
→ durable current facts prove target became published

aborted
→ operation intentionally closed without publication
```

第一版不使用含义模糊的 terminal `failed`。

---

## 5. WorldDocumentPath v1

World path 是 public protocol vocabulary，必须由所有 producer / consumer 得到相同 canonical identity。

### 5.1 Canonicalization

```text
raw string
→ Unicode NFC normalize
→ validate
→ canonical WorldDocumentPathV1
```

规范 path：

```text
UTF-8
relative
`/` only
NFC
case-sensitive logical identity
host-independent
```

### 5.2 Portable collision

Dayloom Archive v2 要求一个合法 tree 可以跨 Windows/Linux 安全 materialize。

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

因此：

```text
characters/Alice.md
characters/alice.md
```

不可同时存在。

### 5.3 必须拒绝

至少拒绝：

```text
empty
absolute
leading `/`
trailing `/`
`.` / `..` segments
empty segments
backslash
NUL
ASCII control chars
Windows drive / UNC
Windows reserved device names
segments ending dot / space
Windows-invalid materialization chars
reserved `.dayloom/**`
non-NFC stored paths
```

协议包应提供统一 parser/normalizer，而不是让各 consumer 各写一套 regexp。

---

## 6. Media/content protocol

第一版受控 media type：

```text
text/markdown
text/plain
application/json
application/yaml
```

纯 protocol validation：

- text 必须 valid UTF-8；
- JSON 必须 syntax-valid；
- YAML 必须 syntax-valid；
- `bytes` 必须是非负安全整数；
- media type 必须来自 frozen set。

明确：

```text
syntax validation
≠ Dayloom semantic validation
```

`archive-protocol` 不验证 character/story/plan 等领域字段。

---

## 7. Blob identity

```text
blobHash
= lowercase hex SHA-256(raw bytes)
```

协议公开纯函数：

```ts
hashBlobV1(bytes): string
isBlobHashV1(value): boolean
verifyBlobV1(bytes, expectedHash): boolean
```

Protocol 不负责从磁盘定位或读取 blob。

---

## 8. Canonical RootTree encoding

RootTree 必须有唯一 canonical bytes。

第一版固定：

- UTF-8 JSON；
- no BOM；
- 固定字段顺序；
- no insignificant whitespace；
- `entries` 先按 canonical path unsigned UTF-8 bytes 升序；
- newline policy 固定；
- path 必须已 canonical NFC；
- path / portable collision 均 unique。

定义：

```text
treeHash
= lowercase hex SHA-256(canonicalRootTreeBytes)
```

必须有专用 encoder，禁止把任意对象直接交给普通序列化逻辑并把 insertion order 当 contract。

Public API 示例：

```ts
encodeRootTreeCanonicalV1(tree): Uint8Array
hashRootTreeV1(tree): string
compareWorldDocumentPathsV1(a, b): number
validateRootTreeV1(tree): ProtocolValidationResult
```

---

## 9. Pure tree algebra

协议层可以拥有纯 tree semantics，因为它们不涉及 I/O 或 lifecycle side effect。

### 9.1 overlay

```text
candidateTree
= overlay(baseTree, stagingManifest)
```

规则：

- PUT adds/replaces；
- DELETE existing removes；
- DELETE missing 是 idempotent no-op；
- untouched entries inherit；
- output canonicalized and sorted。

必须满足：

```text
same base tree
+ same final staging manifest
⇒ same candidate tree bytes
⇒ same tree hash
```

### 9.2 diff

可提供：

```ts
diffRootTreesV1(from, to)
```

输出纯数据 change set，供 inspect/history/rollback UI 使用。

Diff 不拥有 publication 语义。

### 9.3 reachability vocabulary

Protocol 可以定义 commit/tree/blob reference vocabulary 和纯 graph helpers；但不得扫描 filesystem 或执行 GC。

---

## 10. Pure recovery classification

Protocol 可以定义纯函数：

```ts
classifyOperationRecoveryV2({ operation, current })
```

例如对 prepared operation：

```text
current == target
→ published

current == base
→ unpublished-retryable

current != base && current != target
→ superseded/conflict
```

这个函数只解释 durable facts。

真正：

```text
读磁盘
修 operation.json
删除对象
重新发布
```

属于 `@dayloom/archive`。

---

## 11. Parser / validator contract

所有 public parser 必须：

```text
unknown input
→ either valid frozen value
→ or structured protocol error
```

不得：

- silently coerce wrong types；
- silently ignore unsupported schemaVersion；
- silently normalize already-stored invalid canonical representations；
- guess future versions。

建议 API：

```ts
parseArchiveManifestV2(value: unknown): ArchiveManifestV2
parseCurrentPointerV2(value: unknown): CurrentPointerV2
parseArchiveCommitV2(value: unknown): ArchiveCommitV2
parseRootTreeV1(value: unknown): RootTreeV1
parseStagingManifestV1(value: unknown): StagingManifestV1
parseArchiveOperationV2(value: unknown): ArchiveOperationV2
```

Version mismatch 必须 fail-closed。

---

## 12. Error surface

协议错误必须是纯、稳定、可序列化的诊断；不得把 Node filesystem error 当 protocol error。

最低类别可包括：

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
```

具体错误 class/API 可以在实现中优化，但 tests 应断言稳定 code，而不是完整英文字符串。

---

## 13. Package public surface

建议显式 exports，避免一个巨大 root barrel 变成无边界 toolbox。

概念上：

```json
{
  "exports": {
    ".": "...",
    "./path": "...",
    "./tree": "...",
    "./archive": "...",
    "./staging": "...",
    "./operation": "..."
  }
}
```

可以提供 root convenience export，但各 domain 必须可独立消费。

包要求：

```text
pure TypeScript
no runtime dependency unless strictly required
no filesystem imports
no environment access
no cwd/process lifecycle
no Dayloom core import
```

---

## 14. Repository conformance fixtures

Protocol Freeze 不能只靠 unit tests。

应建立 repo-level fixtures，至少包括：

```text
valid manifest/current/commit/tree
valid empty tree
valid non-ASCII NFC paths
valid staging overlay
valid prepared operation

invalid schema versions
invalid JSON shapes
non-NFC path
portable case collision
Windows reserved path
bad sort order
duplicate path
bad blob hash
bad tree canonical bytes
invalid commit control
invalid operation target/base relation
```

Fixtures 应被：

```text
@dayloom/archive-protocol tests
@dayloom/archive consumer tests
migration/verify tools（未来）
```

复用，避免每个 consumer 自造“类似格式”。

---

## 15. Implementation phases

### Phase A — package skeleton

- 创建 `packages/archive-protocol`；
- manifest / package exports；
- architecture guard；
- zero I/O dependency baseline。

### Phase B — data contracts

- manifest/current/commit；
- path/media/blob；
- tree；
- staging；
- operation。

### Phase C — canonical pure functions

- path normalize/compare/collision；
- canonical tree encoder/hash；
- parsers/validators；
- overlay/diff；
- recovery classification。

### Phase D — conformance

- repo-level fixtures；
- negative fixtures；
- consumer compatibility tests。

### Phase E — package proof

- build/test；
- npm pack；
- fresh-install smoke；
- public exports only；
- no private `dist/*` requirement。

---

## 16. CI / package evidence

Formal Freeze 最少需要：

```text
Node 20 / Ubuntu
Node 22 / Ubuntu
Node 20 / Windows
Node 22 / Windows
```

每格：

```text
build
unit/conformance tests
canonical fixture tests
consumer compatibility smoke
npm pack + fresh install
public import surface smoke
```

如果仓库正式统一到其它 Node floor，再统一调整；协议包自身不得暗中拥有更宽或更窄的虚假支持声明。

---

## 17. Architecture guards

必须有 executable guard，禁止：

```text
node:fs
node:fs/promises
child_process
process.cwd/env mutation
@dayloom/archive
@dayloom/core
@dayloom/tui
promptpile*
```

进入 `archive-protocol` source dependency graph。

协议包可以使用纯 crypto/hash implementation；若使用 Node crypto，应明确这只是纯计算依赖，不得引入 filesystem/runtime lifecycle。

---

## 18. Freeze theorem

Formal Freeze 后应能证明：

### Protocol purity

```text
protocol function result
= function(explicit input)
```

不依赖 filesystem/cwd/env/runtime state。

### Canonical identity

```text
same valid logical archive value
⇒ same canonical representation
⇒ same canonical hash/ordering result
```

### Cross-platform path identity

```text
same raw path input
⇒ same normalize/validate result
on supported platforms
```

### Parse strictness

```text
unsupported version / invalid shape
⇒ no valid protocol value
```

### Tree determinism

```text
same base tree + same staging manifest
⇒ same candidate tree + tree hash
```

### Ownership

```text
archive-protocol success
never implies filesystem mutation occurred
```

它只证明协议值是否合法、规范结果是什么。

---

## 19. Final acceptance checklist

只有全部满足才宣布 `@dayloom/archive-protocol` v1 Freeze：

- [ ] 独立 package 已创建；
- [ ] zero filesystem/runtime lifecycle dependency；
- [ ] manifest/current/commit contract 实现；
- [ ] `PublishedWorldPhase` 与 Session phase 分离；
- [ ] WorldDocumentPath NFC / portability contract 实现；
- [ ] media/blob contract 实现；
- [ ] RootTree canonical encoder/hash 实现；
- [ ] staging/operation contract 实现；
- [ ] overlay/diff pure semantics 实现；
- [ ] recovery classification pure semantics 实现；
- [ ] strict version/shape parser 实现；
- [ ] repo conformance fixtures 完整；
- [ ] architecture guard 证明无 core/archive/private runtime imports；
- [ ] Node/OS matrix green；
- [ ] packed fresh-install public-surface smoke green；
- [ ] `@dayloom/archive` consumer compatibility green。

---

## 20. Freeze 后文档治理

实施完成后：

```text
current protocol truth
→ canonical doc/reference + package README

schemas / fixtures / tests
→ executable evidence

本草案
→ 删除

Git history
→ 保留实施过程
```

不得长期让 Implementation Freeze plan 与正式 Archive Protocol 文档并列成为两个 authority。

---

## 21. Phase 1A handoff

本包 Freeze 后，下一步只做：

```text
DAYLOOM_ARCHIVE_ADAPTATION_DRAFT.md
```

其职责是消费已经冻结的 protocol，完成：

```text
@dayloom/archive transactional runtime
+
@dayloom/core World/domain adaptation
```

不得在适配阶段重新复制或重新定义 Archive Protocol 基础数据语义。
