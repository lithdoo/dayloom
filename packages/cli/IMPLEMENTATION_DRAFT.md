# `@dayloom/cli` 实施规范

> 状态：Implementation-ready v1  
> 所在分支：`refactor/draft-cli-boundary`  
> 关联设计：`refactor-plans/draft-cli/PROBLEM_AND_GOALS.md`、`refactor-plans/draft-cli/CLI_COMMAND_DESIGN.md`  
> 当前包状态：CLI scaffold 已建立，领域命令尚未实现  
> 本文目标：实现者可以按本文从底到顶直接落地，不需要在实现途中再发明新的协议、长期状态模型或命令权限规则

## 1. 最终模型

长期只保留三个需要理解的对象：

```text
Draft
Patch
Archive
```

含义：

```text
Draft   = 用户 / AI 的创作输入
Patch   = 一次 World 版本跃迁的正式修改记录
Archive = Published World 的唯一事实与历史
```

Workspace、AI、repair、publish lock 都只存在于一次 CLI invocation 内，不是长期 authority。

完整流程：

```text
Draft
  ↓ exact snapshot
Pinned Archive
  ↓ materialize
Temporary World Workspace
  ↓
AI edit
  ↓
Programmatic Validation
  ├─ invalid → bounded repair → validate again
  ↓
Workspace diff
  +
deterministic control transition
  ↓
Dayloom Patch
  ↓
Patch validation
  ↓
acquire publish lock
  ↓
re-check pinned Archive
  ↓
install immutable target graph + operation artifacts
  ↓
verify target graph
  ↓
atomic current.json switch
  ↓
Published World
  ↓
cleanup Workspace
```

硬规则：

> AI 永远不直接写 Archive。  
> Validator 是唯一硬发布边界。  
> 所有 mutation commit 都必须有 Patch。  
> `current.json` 是唯一最终可见性切换点。  
> CLI 一次运行结束后，不留下需要下次恢复的 Session runtime。

## 2. 不进入新架构的东西

新 CLI 不实现，也不换名字重新实现：

```text
active Session authority
Aggregate Head
Conversation revision
Turn Coordinator
Commit A / Commit B
pendingDraftSync
retryDraftSync
CoreEvent presentation protocol
TUI presentation reducer
Conversation compression authority
Draft curation lifecycle
Candidate lifecycle
Change Plan / Assignment authority
```

CLI 是 process-stateless：

```text
启动
→ 完成一个命令
→ 退出
```

一次 invocation 内可以有临时文件、AI 子进程、repair round 和 publish lock，但这些都没有跨进程生命周期。

## 3. 新 Archive 协议原则

本实现按新的 Archive 协议直接落地，不为旧文件格式、旧 Operation、旧 Commit 或旧 World 提供兼容层、迁移层或双读逻辑。

新的协议从第一天满足：

```text
每个 reachable commit
  ↓
恰好一个 operation
  ↓
恰好一个 patch
```

Draft-driven mutation 还必须有一个 exact Draft snapshot。

不允许出现“新 commit 没有 Patch”的历史例外。

### 3.1 新 Archive 布局

```text
<world>/
  manifest.json
  current.json

  commits/
    <commitId>.json

  objects/
    blobs/
      sha256/
        <64-lowercase-hex>
    trees/
      sha256/
        <64-lowercase-hex>.json

  operations/
    <operationId>/
      operation.json
      patch.json
      draft-snapshot.json     # 仅 Draft-driven mutation
      draft/                  # 仅 Draft-driven mutation
        ... exact Draft bytes ...

  .locks/
    publish.lock
```

没有 durable Candidate、Session、staging workspace 或 runtime head。

### 3.2 immutable 与 mutable

以下对象安装后不可修改：

```text
blob
tree
commit
operation.json
patch.json
draft-snapshot.json
draft/*
manifest.json
```

唯一正常变化的权威指针：

```text
current.json
```

`.locks/publish.lock` 只是瞬时协调文件。

### 3.3 Operation 没有状态机

新的 Operation 不使用：

```text
open
prepared
published
aborted
```

Operation 是一次 mutation 的不可变记录。

“是否已经发布”不单独存状态，而由 Archive 图决定：

```text
current
  ↓
reachable commit
  ↓
operation
```

可达即属于 Published World 历史；不可达对象只是 orphan immutable artifact，不具有 authority。

这样 publication 不需要 operation recovery state machine。

## 4. 统一 ID、hash 与 JSON 编码

这一节是协议级规则，不允许各模块自行选择格式。

### 4.1 稳定 ID

新对象 ID：

```text
world_<32 lowercase hex>
commit_<32 lowercase hex>
op_<32 lowercase hex>
```

由程序使用安全随机 UUID 生成，去掉 `-` 后转小写。

AI 永远不生成 Archive object ID。

### 4.2 hash 字符串

所有公开/持久化 SHA-256 hash 字段统一使用：

```text
sha256:<64 lowercase hex>
```

适用于：

```text
blob hash
rootTreeHash
patchHash
draftSnapshotHash
Draft entry sha256
```

禁止有的字段带 `sha256:`、有的字段只存裸 hex。

磁盘对象路径只使用 `<64 lowercase hex>` digest 部分：

```text
sha256:abc...xyz
        ↓
objects/blobs/sha256/abc...xyz
```

### 4.3 durable JSON

所有 durable JSON parser：

- 拒绝 unknown fields；
- 拒绝 unsupported `schemaVersion`；
- 拒绝非法 ID/hash/timestamp；
- 使用 UTF-8；
- 编码后恰好一个 trailing `LF`。

需要参与 hash 的对象（Patch、DraftSnapshot、RootTree）使用 canonical JSON：固定字段顺序、无无意义 whitespace、数组顺序由对应协议规定。

Manifest、Commit、Operation、Current 虽不以自身 bytes 作为 identity，也使用固定字段顺序编码，避免磁盘格式漂移。

## 5. Archive 核心数据结构

### 5.1 `WorldControlV1`

```ts
interface WorldControlV1 {
  phase: 'idle' | 'planned' | 'awaiting-settle';
  day: string | null;
  lastSettledDay: string | null;
}
```

World 的版本状态由：

```text
root tree
+
control
```

共同决定。

### 5.2 `ArchiveManifestV1`

```ts
interface ArchiveManifestV1 {
  schemaVersion: 1;
  worldId: string;
  title: string;
  createdAt: string;
}
```

规则：

- `worldId` 必须满足 `world_<32 lowercase hex>`；
- `title` 必须是非空 World title；
- `createdAt` 必须是 UTC ISO-8601 timestamp；
- Manifest 只在 `init` publication 中创建一次，之后 immutable；
- AI 不直接写 Manifest。

### 5.3 `CurrentPointerV1`

```ts
interface CurrentPointerV1 {
  schemaVersion: 1;
  revision: number;
  commitId: string;
  updatedAt: string;
}
```

规则：

- `revision >= 1`；
- `commitId` 必须满足 `commit_<32 lowercase hex>`；
- `updatedAt` 必须是 UTC ISO-8601 timestamp；
- `current.revision == current commit.revision`；
- `current.commitId == current commit.id`。

`current.json` 是 Archive 唯一正常变化的 authority pointer。

### 5.4 `DayloomPatchV1`

```ts
interface DayloomPatchV1 {
  schemaVersion: 1;
  baseCommitId: string | null;
  command: 'init' | 'plan' | 'play' | 'revise' | 'settle' | 'abandon';
  draftSnapshotHash: string | null;
  control: {
    before: WorldControlV1 | null;
    after: WorldControlV1;
  };
  changes: readonly DayloomPatchChangeV1[];
}

interface DayloomPatchChangeV1 {
  path: string;
  beforeBlobHash: string | null;
  afterBlobHash: string | null;
}
```

文件变化统一表达：

```text
修改： A    → B
新增： null → B
删除： A    → null
```

Patch 不保存 textual hunk，不重复保存文件 bytes，不保存 target commit ID。

Patch 的职责只有：

> 证明 base World 如何变成目标 World。

### 5.5 Patch canonical bytes 与 hash

`DayloomPatchV1` canonical encoding：

- 字段顺序固定为 `schemaVersion, baseCommitId, command, draftSnapshotHash, control, changes`；
- `control` 字段顺序固定；
- `changes` 按 canonical World path 升序；
- 每个 change 字段顺序固定为 `path, beforeBlobHash, afterBlobHash`；
- UTF-8；
- 无无意义 whitespace；
- trailing `LF`。

然后：

```text
patchHash = sha256:<hash(canonical Patch bytes)>
```

### 5.6 `ArchiveOperationV1`

```ts
interface ArchiveOperationV1 {
  schemaVersion: 1;
  id: string;
  command: DayloomPatchV1['command'];
  patchHash: string;
  createdAt: string;
}
```

Operation 不保存：

```text
status
baseRootTreeHash
targetRootTreeHash
targetCommitId
Draft path
AI transcript
```

这些要么可从 Patch / Commit 推导，要么不是 Archive authority。

### 5.7 `ArchiveCommitV1`

```ts
interface ArchiveCommitV1 {
  schemaVersion: 1;
  id: string;
  revision: number;
  parentCommitId: string | null;
  operationId: string;
  createdAt: string;
  rootTreeHash: string;
  control: WorldControlV1;
}
```

Commit 表示完整版本节点。

### 5.8 对象关系

```text
manifest.json

current.json
    ↓
  commit
    ├────────→ root tree ───────→ blobs
    ├────────→ parent commit
    └────────→ operation
                  └────────→ patch
                                └────────→ Draft snapshot (optional)
```

职责：

```text
manifest   = World identity 与初始元信息
blob       = 文件内容是什么
tree       = 这个版本有哪些文件
patch      = 相对父版本具体改了什么
operation  = 这次是什么领域命令
commit     = 这次发布后的完整版本节点
current    = 哪个 commit 当前可见
```

## 6. Patch 必须形成可验证闭环

对任意 commit，`verify` 必须能从 parent + operation + patch 重新证明这个 commit。

### 6.1 非 init commit

必须验证：

```text
operation.command == patch.command
hash(patch) == operation.patchHash
patch.baseCommitId == commit.parentCommitId
patch.baseCommitId == parent.id
patch.control.before == parent.control
patch.control.after == commit.control
commit.revision == parent.revision + 1
apply(parent.tree, patch.changes) == commit.rootTreeHash
command-specific control transition 合法
所有 patch path 对该 command 合法
所有 patch 引用 blob 存在且 hash 正确
```

### 6.2 init commit

必须验证：

```text
commit.revision == 1
commit.parentCommitId == null
patch.baseCommitId == null
patch.control.before == null
patch.command == 'init'
patch.control.after == commit.control
apply(empty tree, patch.changes) == commit.rootTreeHash
manifest.title == validated state/world.yaml.title
```

### 6.3 no-op 判定

合法 mutation 必须满足：

```text
patch.changes.length > 0
OR
patch.control.before != patch.control.after
```

因此 `settle` 即使没有文件变化，只要 control 合法变化，仍然是有效 mutation。

`revise` 的 control 不变化，所以必须真的产生文件变化。

## 7. init 的 Manifest 生成规则

Manifest 完全由程序生成，不由 AI 生成或编辑。

流程：

```text
Init Draft
→ AI 生成 World Workspace
→ full World validation
→ 读取验证后的 state/world.yaml.title
→ 程序生成 worldId
→ 程序生成 createdAt
→ ArchiveManifestV1
```

固定规则：

```text
worldId   = world_<32 lowercase hex>，CLI 生成
title     = validated WorldProfile.state.world.title
createdAt = 本次正式 init publication 的 UTC timestamp
```

`--dry-run` 不创建或归档正式 Manifest，也不需要生成可复用的 `worldId`；dry-run 只返回从 Workspace 验证得到的 title 与 Patch preview。

Manifest 不属于 World Workspace，因此 AI 无法修改它。

## 8. Draft 输入与 `DraftSnapshotV1`

Draft 格式保持原样。

不增加：

```text
frontmatter
base revision
draft manifest
mutation DSL
machine-oriented Change Plan
```

CLI 接受：

```text
--draft <file>...
```

或：

```text
--draft-dir <dir>
```

二者互斥。

### 8.1 输入文件安全规则

Draft snapshot 前必须使用 `lstat`/等价能力检查。

只接受：

```text
regular file
directory（仅 --draft-dir root 以及其真实子目录）
```

拒绝：

```text
symbolic link
socket
FIFO
device
其他特殊文件
```

所有归档相对路径必须：

- 使用 `/` 作为 separator；
- 非 absolute；
- 不含 `.` / `..` path segment；
- 不含 NUL；
- 不通过 symlink 逃出 Draft root。

### 8.2 snapshot 时机

参数和最基本路径检查通过后，立即复制 exact bytes 到 invocation-local snapshot。

之后本次操作：

```text
只读 snapshot
不再读用户原 Draft
不修改用户原 Draft
不移动用户原 Draft
不删除用户原 Draft
```

### 8.3 `DraftSnapshotV1`

```ts
interface DraftSnapshotV1 {
  schemaVersion: 1;
  mode: 'files' | 'directory';
  entries: readonly DraftSnapshotEntryV1[];
}

interface DraftSnapshotEntryV1 {
  order: number;
  path: string;
  bytes: number;
  sha256: string;
}
```

`path` 是 **operation 归档内 `draft/` 下的 canonical relative path**，不是调用方绝对路径。

#### `--draft <file>...`

按参数顺序归档：

```text
draft/
  files/
    0001/<original-basename>
    0002/<original-basename>
    0003/<original-basename>
```

例如：

```bash
dayloom revise world \
  --draft ./foo/notes.md \
  --draft ./bar/notes.md
```

归档为：

```text
draft/files/0001/notes.md
draft/files/0002/notes.md
```

因此同名文件永远不会碰撞。

Snapshot entries：

```text
order = CLI 参数序号，从 1 开始
path  = files/<4-digit-order>/<basename>
```

多个 `--draft` 的 order 是语义的一部分，不排序。

#### `--draft-dir <dir>`

按原目录相对路径归档：

```text
draft/root/<relative-path>
```

Snapshot entries 按 canonical relative path 升序，`order` 从 1 开始重新编号。

目录本身不作为 entry，只有 regular files 进入 snapshot。

### 8.4 Draft hash

每个 entry 的：

```text
sha256 = sha256:<hash(exact bytes)>
```

`DraftSnapshotV1` canonical encoding：

- 字段顺序固定；
- entries 按已经规定的 order；
- entry 字段顺序固定为 `order, path, bytes, sha256`；
- UTF-8；
- 无无意义 whitespace；
- trailing `LF`。

然后：

```text
draftSnapshotHash = sha256:<hash(canonical DraftSnapshotV1 bytes)>
```

Patch 中的 `draftSnapshotHash` 必须等于 operation 目录里的 `draft-snapshot.json` 实际 hash。

`verify` 继续校验每个 entry 对应的 `draft/*` exact bytes。

因此形成：

```text
Patch
  ↓ draftSnapshotHash
DraftSnapshotV1
  ↓ entry sha256
exact Draft bytes
```

`settle / abandon`：

```text
draftSnapshotHash = null
```

并且不得存在 Draft snapshot artifacts。

## 9. v1 公共命令

只公开：

```text
init
plan
play
revise
settle
abandon
status
verify
```

明确不公开：

```text
session
start
send
submit
cancel
retry
resume
conversation
candidate
repair
review
publish
revert
```

v1 不提供公开 revert 命令、API 或 inverse-patch 接口。

Patch 的 `beforeBlobHash / afterBlobHash` 和 immutable blobs 自然保留未来恢复所需的数据，但本阶段不实现恢复产品语义。

## 10. command availability 与 control transition

### 10.1 availability

| World 状态 | 可用 mutation |
| --- | --- |
| uninitialized | `init` |
| `idle` | `plan`, `revise` |
| `planned` | `play`, `abandon` |
| `awaiting-settle` | `settle`, `abandon` |
| invalid | 无 mutation |

`status` 和各 command 必须调用同一个 availability 函数。

新 TUI 不复制 lifecycle 判断。

### 10.2 control 由程序决定

AI 永远不能修改 control。

| Command | Before | After |
| --- | --- | --- |
| `init` | `null` | `idle`, day `null`, lastSettledDay `null` |
| `plan` | `idle` | `planned`, day = `nextDay(lastSettledDay)`, lastSettledDay 不变 |
| `play` | `planned` | `awaiting-settle`, day 不变，lastSettledDay 不变 |
| `revise` | `idle` | 与 before 完全相同 |
| `settle` | `awaiting-settle` | `idle`, day `null`, lastSettledDay = 原 day |
| `abandon` | `planned` / `awaiting-settle` | `idle`, day `null`, lastSettledDay 不变 |

control transition builder 必须是纯函数，并有完整单元测试。

## 11. World document 与 command write policy

Archive 协议路径（`manifest.json`、`current.json`、`commits/**`、`objects/**`、`operations/**`、`.locks/**`）永远不是 World document，也永远不能由 AI/command mutation policy 当作普通文件修改。

### 11.1 通用 World document roots

v1 只承认：

```text
profile/
canon/
state/
characters/
locations/
arcs/
memory/
story-seeds/
days/
custom/
```

`audit/` 不再属于新 World 的审计入口；新的审计/来源关系由 Operation、Patch、Draft snapshot 表达。

所有文件还必须满足 World Profile 的 media type、schema、ID 与引用规则。

### 11.2 `init`

AI 可以 **创建**（没有 base，因此不存在 modify/delete）以下 World paths：

```text
profile/dayloom.json
canon/premise.md
canon/rules.md
canon/style.md
canon/user-role.md

state/world.yaml
state/calendar.yaml
state/progress.yaml
state/variables.yaml

characters/index.yaml
characters/<id>/profile.md
characters/<id>/state.yaml
characters/<id>/relationships.yaml
characters/<id>/memory.md
characters/<id>/timeline.md

locations/index.yaml
locations/<id>/profile.md
locations/<id>/state.yaml
locations/<id>/memory.md
locations/<id>/triggers.yaml
locations/<id>/timeline.md

arcs/index.yaml
arcs/<id>/profile.md
arcs/<id>/state.yaml
arcs/<id>/timeline.md

memory/short-term.md
memory/long-term.md
memory/facts.yaml
memory/unresolved-threads.yaml
memory/important-events.yaml
story-seeds/active.yaml

custom/**
```

`init` 不允许创建 `days/**`。初始 World 必须处于 `idle`，day 由后续 `plan` 建立。

`profile/dayloom.json` 的内容必须是程序可验证的固定 Dayloom profile descriptor；实现可由程序在 AI 完成后补入，而不是要求 AI 创作它。若采用程序补入，则该文件仍进入 Workspace 最终 validation 与 Patch。

### 11.3 `plan`

设 target day 为程序根据 control 算出的 `<day>`。

AI 只允许 add/modify/delete：

```text
days/<day>/plan.json
days/<day>/timeline.md
days/<day>/dialogue/planning.md
days/<day>/events/index.yaml
```

不能修改其他 day，也不能修改长期 World state。

### 11.4 `play`

设当前 planned day 为 `<day>`。

AI 只允许 add/modify/delete：

```text
days/<day>/play.json
days/<day>/play-index.json
days/<day>/summary.md
days/<day>/timeline.md
days/<day>/events/**
```

`play` 不直接修改长期 character/location/arc/state。长期状态变化在 `settle` 中由结构化 event patch 确定性应用。

`play` 发布前必须以当前长期 World 状态验证全部 settlement patch 的 applicability：variable key 合法、expected 与当前值一致、同一 settlement target 不得重复/冲突写入，并且所有 patch 能按 event 顺序确定性应用。`settle` 必须复用同一校验作为执行前保险，因此 Published `awaiting-settle` World 必须天然可 settle。

### 11.5 `revise`

`revise` 只允许长期 World 资料，不允许 `days/**`、`profile/**` 或 `state/calendar.yaml`。

允许：

```text
canon/premise.md
canon/rules.md
canon/style.md
canon/user-role.md

state/world.yaml
state/progress.yaml
state/variables.yaml

characters/index.yaml
characters/<id>/profile.md
characters/<id>/state.yaml
characters/<id>/relationships.yaml
characters/<id>/memory.md
characters/<id>/timeline.md

locations/index.yaml
locations/<id>/profile.md
locations/<id>/state.yaml
locations/<id>/memory.md
locations/<id>/triggers.yaml
locations/<id>/timeline.md

arcs/index.yaml
arcs/<id>/profile.md
arcs/<id>/state.yaml
arcs/<id>/timeline.md

memory/short-term.md
memory/long-term.md
memory/facts.yaml
memory/unresolved-threads.yaml
memory/important-events.yaml
story-seeds/active.yaml

custom/**
```

新增/删除 entity 时 index 和实体目录必须由 full World validator 保证一致。

Workspace AI tools 只给 `revise` 暴露受同一 command/path policy 约束的 `delete_file`；删除文件后可向上清理空的 entity/custom 子目录，但不得删除顶层 World document root。`init`、`plan`、`play` 不开放删除工具，也不开放 move、delete-directory 或任意 edit 工具。

### 11.6 `settle`

`settle` 不使用 AI，只有 deterministic settlement builder 能产生 changes。

允许写：

```text
state/calendar.yaml
state/variables.yaml

characters/<existing-id>/state.yaml
characters/<existing-id>/timeline.md
locations/<existing-id>/state.yaml
locations/<existing-id>/timeline.md
arcs/<existing-id>/state.yaml
arcs/<existing-id>/timeline.md

memory/facts.yaml
memory/important-events.yaml
story-seeds/active.yaml

days/<current-day>/summary.md
days/<current-day>/diary.md
days/<current-day>/settlement.yaml
days/<current-day>/next-day-seed.yaml
```

settle 不创建/删除 entity，不改 index，不改 canon/profile/custom。

### 11.7 `abandon`

`abandon` 不使用 AI。

只允许删除：

```text
days/<current-day>/**
```

不得 add/modify 任何 World document。

### 11.8 两层 enforcement

Draft-driven command：

1. AI tool/filesystem sandbox 只给上述 command-specific write scope；
2. Workspace diff 形成 Patch 后，程序再次逐 path 验证。

确定性 command 也必须让最终 Patch 通过同一个 policy validator。

policy 实现必须是纯函数，并接收 command + pinned/target day context：

```ts
assertMutationPathAllowed(command, path, context)
```

## 12. Archive base pinning

除 `init` 外，mutation 开始时固定：

```text
revision
commitId
rootTreeHash
control
```

提供 `--base <commit>` 时，启动阶段 current commit 必须严格一致，否则：

```text
WORLD_CONFLICT
```

没有 `--base` 时，以 invocation 开始读到的 current 为 base。

AI 工作期间不长期持 publish lock。

真正 publish 时在 lock 内重新读取 current，必须仍然满足：

```text
revision
commitId
rootTreeHash
```

全部等于 pinned base，否则 `WORLD_CONFLICT`。

不 merge，不 rebase，不 fuzzy apply，不自动重跑 AI。

## 13. Workspace

Workspace 是完整公开 World 文档 working tree，不是 Candidate overlay，也不是 Archive 副本。

```text
temporary workspace/
  profile/
  canon/
  characters/
  locations/
  arcs/
  state/
  memory/
  story-seeds/
  days/
  custom/
```

不 materialize Archive 协议文件。

### 13.1 普通 mutation

对 `plan / play / revise`：

```text
pinned root tree
  ↓ materialize all World documents
complete Workspace
```

AI 修改前必须可证明：

```text
hashWorkspaceTree(workspace) == pinned.rootTreeHash
```

### 13.2 init

`init` 没有 base tree。

CLI 创建新的空 Workspace，由 Init Draft 驱动生成初始 World 文档；程序负责 protocol descriptor/control/Manifest 等非创作 authority。

### 13.3 Workspace filesystem 安全

materialize 时只创建真实 directory + regular file。

AI 执行后、每次 validation/diff 前必须重新扫描 Workspace，并拒绝：

```text
symbolic link
socket
FIFO
device
其他特殊文件
任何逃出 Workspace root 的路径
任何 Archive protocol path
```

AI tool 本身也不提供 create-symlink 等能力。

### 13.4 新资源 ID

v1 不建立 Change Plan / Assignment protocol。

AI 可以在 `revise` 允许路径内创建符合 World 规则的新资源 ID；Validator 严格检查：

```text
ID syntax
uniqueness
index consistency
cross references
complete World validity
```

如果以后实际数据证明 ID 生成质量不足，可以增加很薄的 `allocate_id` AI tool；它只是便利工具，不是第二套 authority。

## 14. AI edit 与 bounded repair

Draft-driven mutation 的 AI 只有两个动作：

```text
edit workspace
repair workspace from diagnostics
```

流程：

```text
Draft snapshot
+
command context
+
complete Workspace
  ↓
AI edit
  ↓
validate Workspace + target control
  ├─ valid → diff
  └─ invalid
       ↓
     deterministic diagnostics
       ↓
     AI repair same Workspace
       ↓
     validate again
```

Repair 必须：

- 固定最大次数；
- diagnostics signature 与 Workspace hash 都相同时提前停止；若 diagnostics 相同但 Workspace 仍在变化，则允许在固定最大次数内渐进修复；
- 始终编辑同一个 invocation-local Workspace；
- 不能扩大 write scope；
- 不能修改 Draft snapshot。

第一版不实现 Planner、Change Plan、Assignment、Candidate 或 mandatory AI reviewer。

AI 的“完成”不代表可发布。

## 15. Workspace diff → Patch

对最终合法 Workspace 建立：

```text
base path → blob hash map
workspace path → blob hash map
```

比较所有 World paths，生成 add / modify / delete 的 `DayloomPatchChangeV1`。

不需要第三方 diff 库。

### 15.1 before hash

非 init 必须来自 pinned base tree；init 全部为 `null`。

### 15.2 after hash

对 Workspace exact bytes 使用统一 Archive SHA-256 算法：

```text
sha256:<64 lowercase hex>
```

新内容 bytes 不放进 Patch；publication 时安装到 immutable blob store。

### 15.3 Patch validation

生成后必须验证：

- schema strict；
- paths 唯一并 canonical 排序；
- path 属于 World documents；
- command/context 允许修改这些 paths；
- before hash 与 base tree 完全一致；
- after hash 对应 Workspace bytes 存在且 hash 一致；
- target tree 可以由 base tree + changes 唯一推出；
- control transition 符合 command；
- Draft-driven command 有有效 `draftSnapshotHash`；
- deterministic command 的 `draftSnapshotHash == null`；
- file delta 与 control delta 不能同时为空。

## 16. World Validation

Validator 面对：

```text
完整 Workspace
+
目标 control
```

必须检查：

```text
World document syntax
required documents
IDs
indexes
cross references
domain invariants
day / phase invariants
media type / content restrictions
command-specific mutation policy
```

AI edit / repair 阶段通过完整 Workspace Validator。

Publish 前还必须从即将安装的 target tree + target control 再验证一次，证明“验证过的 Workspace”和“真正要发布的 Archive graph”一致。

## 17. Publication theorem

所有 mutation 进入同一个 publisher。

```ts
interface PublishInputV1 {
  worldRoot: string;
  base: PinnedWorldV1 | null;
  patch: DayloomPatchV1;
  patchBytes: Uint8Array;
  workspaceFiles: ReadonlyMap<string, Uint8Array>;
  draftSnapshot?: PreparedDraftSnapshotV1;
  initialManifest?: ArchiveManifestV1;
}
```

不要让每个 command 自己拼 Archive 文件。

### 17.1 publish 前确定

进入 publisher 前已经确定：

```text
Patch
patchHash
target tree
target tree hash
target control
new commit ID
new operation ID
createdAt
init 时的 Manifest
```

正式 publish 使用同一个 `createdAt` 写 Operation/Commit；init 的 Manifest `createdAt` 也使用这个 timestamp。

### 17.2 publish lock 内顺序

```text
1. acquire .locks/publish.lock
2. re-read current / uninitialized state
3. re-check pinned base
4. install new immutable blobs
5. install target immutable tree
6. install operation Draft artifacts（如有）
7. install patch.json
8. install operation.json
9. install commit.json
10. 从磁盘重新 verify target graph
11. init 时 install manifest.json
12. atomic replace/create current.json
13. release lock
```

第 12 步之前，新 commit 对 Published World 不可见。

### 17.3 failure

非 init 在 current 切换前失败：

- current 不变；
- World authority 不变；
- 已安装 immutable orphan artifacts 可以保留；
- 不需要 rollback 状态机。

init 在安装 manifest 后、创建 current 前失败：

- 删除本次 manifest，使目录恢复 uninitialized；
- immutable orphan objects 可以保留。

### 17.4 current 切换之后

一旦 `current.json` 原子切换成功：

```text
mutation = published
```

之后日志/临时目录清理失败不能回滚已发布 commit，也不引入“published but failed”业务状态。

## 18. `settle / abandon`

### 18.1 settle

```text
read + pin World
→ validate settlement applicability
→ deterministic settlement changes
→ deterministic control transition
→ Patch
→ validate target
→ publish
```

允许：

```text
file changes = []
control changed = true
```

### 18.2 abandon

```text
read + pin World
→ delete days/<current-day>/**
→ deterministic control transition
→ Patch
→ validate target
→ publish
```

系统没有“AI publish”和“deterministic publish”两套协议。

## 19. `--check` 与 `--dry-run`

### 19.1 `--check`

Draft-driven command：

```text
parse argv
read World state
check command availability
read + snapshot Draft
Draft lint
basic input validation
```

不调用 AI，不创建完整 AI Workspace，不要求 LLM config，不生成 Patch。

确定性 mutation 不提供 `--check`；直接使用 `--dry-run`。

### 19.2 `--dry-run`

Draft-driven：

```text
snapshot
→ pin base
→ Workspace
→ AI edit / repair
→ validate
→ diff
→ Patch
→ Patch validation
→ final base re-check
→ return Patch
```

不 publish。

`settle / abandon --dry-run` 走确定性 pipeline 到 Patch 后停止。

`--dry-run` 结束时仍确认 current 与 pinned base 一致；已变化则 `WORLD_CONFLICT`。

`init --dry-run` 不生成正式 worldId / Manifest，只验证初始 World、返回 title 与 Patch preview。

## 20. CLI grammar

```text
dayloom init <world>
        (--draft <file>... | --draft-dir <dir>)
        [--llm-config <file>]
        [--check | --dry-run]
        [--json]

dayloom plan <world>
        (--draft <file>... | --draft-dir <dir>)
        [--base <commit>]
        [--llm-config <file>]
        [--check | --dry-run]
        [--json]

dayloom play <world>
        (--draft <file>... | --draft-dir <dir>)
        [--base <commit>]
        [--llm-config <file>]
        [--check | --dry-run]
        [--json]

dayloom revise <world>
        (--draft <file>... | --draft-dir <dir>)
        [--base <commit>]
        [--llm-config <file>]
        [--check | --dry-run]
        [--json]

dayloom settle <world>
        [--base <commit>]
        [--dry-run]
        [--json]

dayloom abandon <world>
        [--base <commit>]
        [--dry-run]
        [--json]

dayloom status <world>
        [--json]

dayloom verify <world>
        [--json]
```

World 是唯一 positional primary object。

## 21. 稳定 CLI 输出契约

这个契约在实现命令前冻结。

### 21.1 JSON success envelope

```json
{
  "ok": true,
  "command": "plan",
  "result": {}
}
```

### 21.2 JSON error envelope

```json
{
  "ok": false,
  "command": "plan",
  "error": {
    "code": "WORLD_CONFLICT",
    "message": "Published World changed during the operation."
  }
}
```

`details` 可以作为可选 object，但消费者不得依赖 message 解析业务状态。

### 21.3 mutation result

正常 publish：

```json
{
  "mode": "published",
  "baseCommitId": "commit_x",
  "commitId": "commit_y",
  "revision": 4,
  "operationId": "op_y",
  "patchHash": "sha256:...",
  "changedPaths": 3,
  "controlChanged": true
}
```

Init 的 `baseCommitId` 为 `null`。

Dry-run：

```json
{
  "mode": "dry-run",
  "baseCommitId": "commit_x",
  "patchHash": "sha256:...",
  "patch": { "schemaVersion": 1 },
  "changedPaths": 3,
  "controlChanged": true
}
```

`init --dry-run` 可额外返回：

```json
{
  "title": "Validated world title"
}
```

但不返回正式 `worldId`。

Check：

```json
{
  "mode": "checked",
  "baseCommitId": "commit_x"
}
```

### 21.4 status result

```json
{
  "status": "published",
  "revision": 3,
  "commitId": "commit_x",
  "phase": "planned",
  "day": "day3",
  "lastSettledDay": "day2",
  "availableCommands": ["play", "abandon"]
}
```

未初始化：

```text
status = uninitialized
revision = null
commitId = null
phase = null
day = null
lastSettledDay = null
```

### 21.5 verify result

```json
{
  "valid": true,
  "revision": 3,
  "commitId": "commit_x",
  "commitsVerified": 3
}
```

### 21.6 stdout / stderr

普通模式：

```text
stdout = 最终人类结果
stderr = 少量阶段进度 / warning
```

`--json`：

```text
stdout = 恰好一个最终 JSON object
stderr = 日志 / warning，可被 TUI 忽略
```

v1 不定义 CoreEvent / JSONL progress 协议。

## 22. 稳定错误与 exit code

错误码：

```text
INVALID_ARGUMENT
DRAFT_INVALID
LLM_CONFIG_REQUIRED
NOT_AVAILABLE
WORLD_INVALID
WORLD_CONFLICT
AI_FAILED
VALIDATION_FAILED
PATCH_INVALID
INTERNAL_ERROR
```

Exit code：

```text
0 = success
1 = INTERNAL_ERROR
2 = INVALID_ARGUMENT / DRAFT_INVALID / LLM_CONFIG_REQUIRED
3 = NOT_AVAILABLE / WORLD_CONFLICT
4 = WORLD_INVALID / VALIDATION_FAILED / PATCH_INVALID
5 = AI_FAILED
```

新 TUI 以 `error.code` 为机器判断，不解析 message，也不依赖 stderr 文案。

## 23. `status` 与 `verify`

### 23.1 status

只读取：

```text
manifest
current
head commit/control
```

返回状态与 available commands。

不扫描 runtime，不看 Session，不调用 AI。

### 23.2 verify

`verify` 是新 Archive 闭环的证明器。

先验证：

```text
manifest strict schema
current strict schema
current ↔ head commit relation
manifest title ↔ init World title relation
```

再从 current commit 沿 parent 链到 init commit，对每个 commit 验证：

```text
commit parser
root tree hash
blob existence + hash
operation existence + parser
patch existence + patchHash
operation.command == patch.command
patch base relation
patch control relation
patch tree transition
command path policy
command control transition
Draft snapshot relation（如有）
revision 连续
parent 连续
```

Draft-driven operation：必须存在且验证 Draft snapshot/exact bytes。

`settle/abandon`：必须 `draftSnapshotHash == null` 且不存在 Draft artifacts。

`verify` 只验证从 current 可达的 Published World 历史；不可达 orphan artifacts 不影响有效性。

## 24. 推荐源码结构

```text
packages/cli/
  src/
    main.ts
    index.ts

    cli/
      argv.ts
      output.ts
      errors.ts
      availability.ts

    commands/
      init.ts
      plan.ts
      play.ts
      revise.ts
      settle.ts
      abandon.ts
      status.ts
      verify.ts

    draft/
      snapshot.ts
      lint.ts

    workspace/
      materialize.ts
      filesystem.ts
      write-policy.ts
      diff.ts

    patch/
      build.ts
      validate.ts

    world/
      read.ts
      control.ts
      validate.ts
      publish.ts

    ai/
      config.ts
      boundaries.ts
      react.ts
      workspace-editor.ts
```

Archive durable schema：

```text
packages/archive-protocol/src/
  ids.ts
  hash.ts
  blob.ts
  tree.ts
  patch.ts
  operation.ts
  commit.ts
  current.ts
  manifest.ts
  layout.ts
  relations.ts
```

如果某模块很小，可以合并；不要为了目录完整创造无价值 abstraction。

## 25. 实施顺序与完成判定

### Phase 0 — Scaffold 完整化

完成：

- `@dayloom/cli` package 可 build；
- `dayloom` bin 可运行；
- root `build/test` 接线；
- `package-lock.json` 同步新 workspace；
- argv / JSON envelope / error code / exit code 基础实现。

完成判定：

```text
npm ci
npm run build
npm test
```

在干净 checkout 成功。

### Phase 1 — 新 Archive Protocol

实现并冻结：

```text
ID/hash codecs
ArchiveManifestV1
CurrentPointerV1
ArchiveCommitV1
ArchiveOperationV1
DayloomPatchV1
canonical Patch encoding/hash
new layout
pure relation validators
control transition validator
```

完成判定：

- parser 全部 strict；
- unknown fields 被拒绝；
- hash 全部统一 `sha256:<64 lowercase hex>`；
- canonical round-trip 稳定；
- parent + patch 可以证明 child commit；
- init relation 可证明；
- manifest/current relation 可证明；
- control-only Patch 可证明。

### Phase 2 — Read / status / verify

实现：

```text
read Published World
World profile validation
status
verify
availability
```

完成判定：

- 手工 fixture 的完整 Archive 可 verify；
- 任意篡改 manifest/current/blob/tree/patch/Draft snapshot/relation 会 verify 失败；
- status 与 availability 使用同一 control source。

### Phase 3 — Workspace / Patch / Publisher

先不接 AI。

实现：

```text
Workspace materialization
Workspace filesystem safety scan
exact command write policy
Workspace tree hashing
Workspace diff
Patch builder
Patch validator
new atomic publisher
```

用 fixture 手工修改 Workspace。

完成判定：

- add / modify / delete 正确；
- control-only mutation 正确；
- 每个 command 的 allowed/denied path 有表驱动测试；
- symlink/special file 被拒绝；
- base conflict 被拒绝；
- current 始终最后切换；
- pre-current failure 不改变 Published World；
- publish 后 `verify` 立即通过。

### Phase 4 — deterministic mutations

实现：

```text
settle
abandon
```

完成判定：

```text
command
→ Patch
→ publish
→ status
→ verify
```

特别测试：

```text
settle: changes = [] + control changed = true
abandon: only delete days/<current-day>/**
```

### Phase 5 — Draft snapshot + AI

实现：

```text
DraftSnapshotV1
same-basename archive mapping
Draft symlink/special-file rejection
Draft lint
Promptpile config
AI Workspace editor
bounded repair
init
plan
play
revise
```

完成判定：

- AI 只能改 Workspace；
- source Draft 在运行中变化不影响 snapshot；
- 两个同名 `--draft` 可以稳定归档并具有不同 identity path；
- symlink/special Draft input 被拒绝；
- repair 有界；
- invalid AI output 永远不能 publish；
- init Manifest 完全由程序生成；
- publish 后 Patch → Draft snapshot → exact bytes 可 verify；
- 四个 Draft-driven command 都满足 publish 后立即 `verify`。

### Phase 6 — End-to-end hardening

完成：

```text
--check
--dry-run
--json
human output
packaging
failure injection tests
concurrent publication tests
```

完成判定：

```text
init
→ status
→ plan
→ status
→ play
→ status
→ settle
→ status
→ revise
→ status
→ verify
```

以及：

```text
plan
→ abandon
→ verify
```

所有 mutation 后都能立即 `verify`，任意失败都不会产生部分可见 World。

## 26. 必须长期保持的测试不变量

至少覆盖：

1. 所有 SHA-256 字段都是 `sha256:<64 lowercase hex>`。
2. Manifest / Current strict schema 与 relation 正确。
3. init Manifest title 来自 validated `state/world.yaml.title`，worldId 只由程序生成。
4. Draft snapshot exact bytes 与 hash 稳定。
5. 多个 `--draft` 的顺序进入 snapshot identity。
6. 同 basename 的多个 `--draft` 不发生归档碰撞。
7. Draft symlink / special file 被拒绝。
8. Workspace 初始树严格等于 pinned tree。
9. Workspace symlink / special file 被拒绝。
10. 每个 command 的 write policy 有完整 allowed/denied 表驱动测试。
11. AI 无法越权生成最终 Patch path。
12. Workspace add / modify / delete 得到正确 blob-hash Patch。
13. Patch canonical hash 稳定。
14. Patch control.before 与 parent commit 一致。
15. Patch control.after 与 target commit 一致。
16. control-only settle 是合法 mutation。
17. file delta + control delta 同时为空时拒绝 publish。
18. full World validator 是发布硬门槛。
19. repair 最大轮数严格有界。
20. diagnostics 与 Workspace hash 都不变时 repair 提前停止；Workspace 持续变化时允许有界渐进修复。
21. publish lock 内 base 改变返回 `WORLD_CONFLICT`。
22. current 永远是最后 visibility step。
23. current 切换前故障不改变 Published World。
24. Draft-driven commit 必须有可验证 Draft snapshot。
25. deterministic commit 不得伪造 Draft snapshot。
26. 每个 reachable commit 必须有且只有一个 Patch。
27. `verify` 能从 parent + Patch 证明每一个 child commit。
28. `status` 的 availableCommands 与实际 command guard 完全一致。
29. `--json` stdout 始终只有一个 JSON object。
30. `@dayloom/cli` 不依赖 `@dayloom/core`。
31. `play` 不得发布 precondition stale、settlement target 冲突或 variable key 非法的 `awaiting-settle` World。

## 27. 实现纪律

实现过程中，如果出现选择，优先用下面规则判断：

> Draft 是输入，不是 DSL。  
> Workspace 是临时工作树，不是第二套 Archive。  
> Patch 是版本跃迁记录，不是文本 patch 引擎。  
> Operation 是 immutable command record，不是状态机。  
> Archive 是唯一 Published World authority。  
> Manifest/Current/Commit/Operation/Patch 的协议由程序掌握，AI 不能写。  
> Validator 决定能不能发布。  
> `current.json` 决定什么时候真正生效。  
> CLI 不重新长出长期 Session runtime。  
> 能从现有数据推导的信息，不重复存第二份 authority。  
> 能用纯函数验证的关系，不交给 AI 判断。

如果实现需要引入新的长期可变状态、恢复协议、Candidate authority、Session authority 或第二套 publication 状态机，应先视为设计退化，而不是默认接受。

## 28. 完成定义

`@dayloom/cli` v1 只有在下面闭环全部成立时才算完成：

```text
Draft
→ exact snapshot
→ Workspace
→ Validate / Repair
→ Patch
→ Archive Commit
→ verify
```

以及：

```text
Archive Commit
→ operation
→ Patch
→ parent tree/control
→ 可重新证明当前 commit tree/control
```

以及 init：

```text
validated state/world.yaml.title
→ program-generated Manifest
→ init Commit/Patch
→ current
→ verify
```

最终要求：

> 每一次 Published World 变化都能被 Patch 精确解释；每一个 Patch 都能被程序验证；每一个当前可见 commit 都能从父版本和 Patch 重新证明；每一份 Draft 来源都能从 Patch 追溯到 exact bytes；AI 从不拥有 Archive authority。

达到这一点后，新 CLI 的修改、记录、验证和发布形成完整闭环，不需要 Candidate、Change Plan、Session Head 或额外恢复状态机。
