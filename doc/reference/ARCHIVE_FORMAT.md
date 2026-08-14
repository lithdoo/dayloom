# Archive Format V2

> **类型**：reference
> **状态**：implemented
> **最后核对**：2026-08
> **协议入口**：`packages/archive-protocol/`
> **运行时入口**：`packages/core/src/archive-v2/`

## Ownership

`@dayloom/archive-protocol` 定义 Archive 的数据含义：V2 manifest/current/commit/operation、V1 tree/staging、文档路径、canonical encoding/hash、对象关系和恢复分类。

`@dayloom/core` 负责副作用：安全解析 world root、文件读写、原子替换、publish lock、OCC、Session authority、inspect/GC，以及 Dayloom World Profile 和 mutation policy。Protocol 不依赖 Core；Core 只能从 Protocol public exports 导入。

## Published World

唯一正式读取链为：

```text
current.json
  → commits/<commit-id>.json
  → objects/trees/sha256/<tree-hash>.json
  → objects/blobs/sha256/<blob-hash>
```

`current.json` 是唯一 Published World visibility switch。commit、tree 和 blob 都是不可变对象；正式读取禁止扫描目录猜测“最新”对象。

稳定发布 phase 只有 `idle`、`planned`、`awaiting-settle`。`initializing`、`planning`、`playing`、`revising` 是由 durable Session record 投影出的 Runtime phase，不写入 commit。

## Physical Layout

```text
<world-root>/
├── manifest.json
├── current.json
├── commits/<commit-id>.json
├── objects/
│   ├── trees/sha256/<tree-hash>.json
│   └── blobs/sha256/<blob-hash>
├── operations/<world-operation-id>/
│   ├── operation.json
│   └── workspace/
│       ├── manifest.json             # init candidate only
│       ├── session.json              # Core-owned, not Protocol
│       └── staging/
│           ├── index.json
│           └── files/<opaque-id>
└── .locks/publish.lock
```

## Three Visibility Switches

Mutable authority 必须使用“临时文件 → file flush → atomic rename/replace → parent directory sync”：

- `staging/index.json`：staged state changed；
- `operation.json` 的 `open → prepared`：完整 candidate graph 可见；
- `current.json`：Published World changed。

各 switch 之前的未引用文件只是 garbage，不能形成 partial visible state。Windows 不提供 portable directory fsync；Core 只忽略该平台对目录句柄返回的已知 unsupported 错误，普通文件 flush 失败仍传播。

## Operation and Publication

一个 Session 恰好拥有一个 durable `ArchiveOperationV2`。多次 input、prepare、submit 或 cancel 使用同一个 WorldOperationId；Runtime command correlation id 是不同概念。

Prepare：

```text
validate operation/staging relation
→ verify every staged file
→ build candidate tree
→ publish immutable blobs/tree/commit
→ validate prepared target relation
→ atomically switch operation.json to prepared
```

Publish：

```text
acquire publish lock
→ re-read current
→ expected-base OCC
→ validate complete prepared graph
→ create-once manifest when initializing
→ atomically replace current.json
→ best-effort operation/session reconciliation
```

current 替换后即使 reconciliation 失败也不能回滚 Published World。冲突保留 staging 和 candidate，以便诊断或显式重试。

## Durable Session

`workspace/session.json` 是 Core-owned `CoreSessionRecordV1`，也是 active Session 的唯一 durable authority。start/cancel 不发布 World commit：

- start 创建 `ArchiveOperationV2(open)` 与 `CoreSessionRecord(active)`；
- submit 在同一 operation 中 stage、prepare、publish；
- cancel 将同一 operation 设为 `aborted`，Session 设为 `cancelled`，current 不变；
- restart 由 Published World、Session record、operation 和 staging 唯一投影 Runtime phase。

## Dayloom World Profile

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

Protocol 只判断结构合法性；Core 判断产品权限。已发布历史 day 的 play/summary 不能由普通 gameplay 静默覆盖，显式 revise 才能修改。reserved/internal physical paths 永远不能从 World document mutation API 访问。

## Inspect and GC

GC roots 为：

```text
Published current graph
∪ every prepared operation target graph
```

inspect 必须区分 published reachable、prepared retained、true orphan 和 malformed operation。GC 默认 dry-run；`delete: true` 时持有 publish lock，且只能删除上述 root 集合不可达的 commit/tree/blob。

## Executable Evidence

```bash
npm run test -w @dayloom/archive-protocol
npm run test -w @dayloom/core
npm run test -w @dayloom/tui
```

测试覆盖 canonical hash/path、staging visibility、prepare immutability、OCC、prepared-root GC、Session restart、start/submit identity、cancel 不发布，以及 Windows real PTY cutover。
