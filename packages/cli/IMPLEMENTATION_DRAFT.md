# `@dayloom/cli` 实施规范

> 状态：Implementation-ready v1  
> 所在分支：`refactor/draft-cli-boundary`  
> 关联设计：`refactor-plans/draft-cli/PROBLEM_AND_GOALS.md`、`refactor-plans/draft-cli/CLI_COMMAND_DESIGN.md`  
> 当前包状态：CLI scaffold 已建立，领域命令尚未实现  
> 本文目标：实现者可以按本文从底到顶直接落地，不需要在实现途中再发明新的协议或长期状态模型

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
每个 commit
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
        <hash>
    trees/
      sha256/
        <hash>.json

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

## 4. Archive 核心数据结构

以下是实现必须冻结的最小语义。具体 TypeScript 名称可以微调，但字段职责不能漂移。

### 4.1 `WorldControlV1`

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

### 4.2 `DayloomPatchV1`

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

### 4.3 Patch canonical bytes 与 hash

`DayloomPatchV1` 必须有 canonical JSON encoding：

- 固定字段顺序；
- `changes` 按 canonical World path 排序；
- 无无意义 whitespace；
- UTF-8；
- 文件结尾一个 `LF`；
- parser 拒绝 unknown fields。

然后：

```text
patchHash = sha256(canonical Patch bytes)
```

### 4.4 `ArchiveOperationV1`

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

### 4.5 `ArchiveCommitV1`

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

### 4.6 对象关系

统一关系：

```text
current.json
    ↓
  commit
    ├────────→ root tree ───────→ blobs
    ├────────→ parent commit
    └────────→ operation
                  └────────→ patch
                                └────────→ Draft snapshot (optional)
```

各对象只回答一个问题：

```text
blob       = 文件内容是什么
tree       = 这个版本有哪些文件
patch      = 相对父版本具体改了什么
operation  = 这次是什么领域命令
commit     = 这次发布后的完整版本节点
current    = 哪个 commit 当前可见
```

## 5. Patch 必须形成可验证闭环

对任意 commit，`verify` 必须能从它的 parent + operation + patch 重新证明这个 commit。

### 5.1 非 init commit

给定：

```text
parent commit
parent tree
operation
patch
commit
```

必须验证：

```text
operation.command == patch.command
hash(patch) == operation.patchHash
patch.baseCommitId == commit.parentCommitId
patch.baseCommitId == parent.id
patch.control.before == parent.control
patch.control.after == commit.control
apply(parent.tree, patch.changes) == commit.rootTreeHash
command-specific control transition 合法
所有 patch path 对该 command 合法
所有 patch 引用 blob 存在且 hash 正确
```

### 5.2 init commit

必须验证：

```text
commit.revision == 1
commit.parentCommitId == null
patch.baseCommitId == null
patch.control.before == null
patch.command == 'init'
patch.control.after == commit.control
apply(empty tree, patch.changes) == commit.rootTreeHash
```

### 5.3 no-op 判定

合法 mutation 必须满足：

```text
patch.changes.length > 0
OR
patch.control.before != patch.control.after
```

因此 `settle` 即使没有文件变化，只要 control 合法变化，仍然是有效 mutation。

`revise` 的 control 不变化，所以必须真的产生文件变化。

## 6. Draft 输入与 `DraftSnapshotV1`

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

### 6.1 snapshot 时机

参数和最基本路径检查通过后，立即复制 exact bytes 到 invocation-local snapshot。

之后本次操作：

```text
只读 snapshot
不再读用户原 Draft
不修改用户原 Draft
不移动用户原 Draft
不删除用户原 Draft
```

### 6.2 `DraftSnapshotV1`

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

规则：

```text
--draft file...
  entries 顺序 = CLI 参数顺序

--draft-dir dir
  path = Draft root 相对路径
  entries 按 path 稳定排序
```

不归档调用方绝对路径。

每个 entry 的 `sha256` 对 exact bytes 计算。

`DraftSnapshotV1` 也使用 canonical JSON，然后：

```text
draftSnapshotHash = sha256(canonical DraftSnapshotV1 bytes)
```

Patch 中的：

```text
draftSnapshotHash
```

必须等于 operation 目录里 `draft-snapshot.json` 的实际 hash。

`verify` 进一步校验 snapshot 中每个 entry 对应的 `draft/*` exact bytes。

因此形成：

```text
Patch
  ↓ draftSnapshotHash
DraftSnapshotV1
  ↓ entry sha256
exact Draft bytes
```

完整闭环。

`settle / abandon`：

```text
draftSnapshotHash = null
```

并且不得存在 Draft snapshot artifacts。

## 7. v1 公共命令

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

## 8. command availability 与 control transition

### 8.1 availability

| World 状态 | 可用 mutation |
| --- | --- |
| uninitialized | `init` |
| `idle` | `plan`, `revise` |
| `planned` | `play`, `abandon` |
| `awaiting-settle` | `settle`, `abandon` |
| invalid | 无 mutation |

`status` 和各 command 必须调用同一个 availability 函数。

新 TUI 不复制 lifecycle 判断。

### 8.2 control 由程序决定

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

## 9. Archive base pinning

除 `init` 外，mutation 开始时固定：

```text
revision
commitId
rootTreeHash
control
```

提供：

```text
--base <commit>
```

时，启动阶段 current commit 必须严格一致，否则：

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

全部等于 pinned base。

否则：

```text
WORLD_CONFLICT
```

不 merge，不 rebase，不 fuzzy apply，不自动重跑 AI。

## 10. Workspace

Workspace 是完整公开 World 文档 working tree，不是 Candidate overlay，也不是 Archive 副本。

```text
temporary workspace/
  canon/
  characters/
  locations/
  arcs/
  state/
  story-seeds/
  days/
  ...
```

不 materialize Archive 协议文件：

```text
manifest.json
current.json
commits/
objects/
operations/
.locks/
```

### 10.1 普通 mutation

对 `plan / play / revise`：

```text
pinned root tree
  ↓ materialize all World documents
complete Workspace
```

在 AI 修改前必须可证明：

```text
hashWorkspaceTree(workspace) == pinned.rootTreeHash
```

### 10.2 init

`init` 没有 base tree。

CLI 创建新的空 / 最小 Workspace，由 Init Draft 驱动 AI 生成初始 World 文档。

AI 不生成：

```text
manifest
commit
operation
patch
current
control
```

这些全部由程序产生。

### 10.3 两层写权限

第一层：AI tool/filesystem sandbox 只能写 command-specific World paths。

第二层：diff 形成 Patch 后，程序再次检查每一个 changed path。

第二层才是最终 authority。

write policy 是纯函数：

```ts
assertMutationPathAllowed(command, path)
```

不允许 AI 通过生成 Archive 协议路径绕开权限。

### 10.4 新资源 ID

v1 不建立 Change Plan / Assignment protocol。

AI 可以在允许路径内创建符合 World 规则的新资源 ID；Validator 严格检查：

```text
ID syntax
uniqueness
index consistency
cross references
complete World validity
```

如果以后实际数据证明 ID 生成质量不足，可以增加一个很薄的 `allocate_id` AI tool；它只能是便利工具，不能变成第二套 authority。

## 11. AI edit 与 bounded repair

Draft-driven mutation 的 AI 只有两个动作：

```text
edit workspace
repair workspace from diagnostics
```

首次：

```text
Draft snapshot
+
command context
+
complete Workspace
  ↓
AI edit
```

然后：

```text
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

- 有固定最大次数；
- diagnostics signature 相同时提前停止；
- 始终编辑同一个 invocation-local Workspace；
- 不能扩大 write scope；
- 不能修改 Draft snapshot。

第一版不实现 Planner、Change Plan、Assignment、Candidate 或 mandatory AI reviewer。

AI 的“完成”不代表可发布。

## 12. Workspace diff → Patch

对最终合法 Workspace 建立：

```text
base path → blob hash map
workspace path → blob hash map
```

比较所有 World paths，生成 add / modify / delete 的 `DayloomPatchChangeV1`。

不需要第三方 diff 库。

### 12.1 before hash

非 init：

```text
beforeBlobHash
```

必须来自 pinned base tree。

init：全部为：

```text
null
```

### 12.2 after hash

对 Workspace exact bytes 使用 Archive blob hash 算法计算。

新内容的 bytes 不放进 Patch；publication 时安装到 immutable blob store。

### 12.3 Patch validation

生成后必须验证：

- schema 严格；
- paths 唯一并 canonical 排序；
- path 属于 World documents；
- command 允许修改这些 paths；
- before hash 与 base tree 完全一致；
- after hash 对应内容存在且 hash 一致；
- target tree 可以由 base tree + changes 唯一推出；
- control transition 符合 command；
- Draft-driven command 有有效 `draftSnapshotHash`；
- deterministic command 的 `draftSnapshotHash == null`；
- file delta 与 control delta 不能同时为空。

## 13. World Validation

Validator 面对的是：

```text
完整 Workspace
+
目标 control
```

而不是 Patch 的局部文本。

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

在 AI edit / repair 阶段通过完整 Workspace Validator。

Publish 前还必须从即将安装的 target tree + target control 再验证一次，证明“验证过的 Workspace”和“真正要发布的 Archive graph”一致。

## 14. Publication theorem

所有 mutation 最终进入一个统一 publisher。

Publisher 输入应接近：

```ts
interface PublishInputV1 {
  worldRoot: string;
  base: PinnedWorldV1 | null;
  patch: DayloomPatchV1;
  patchBytes: Uint8Array;
  workspaceFiles: ReadonlyMap<string, Uint8Array>;
  draftSnapshot?: PreparedDraftSnapshotV1;
  initialManifest?: InitialManifestInputV1;
}
```

不要让每个 command 自己拼 Archive 文件。

### 14.1 publish 前已经完成

进入 publisher 前必须已经确定：

```text
Patch
patchHash
target tree
target tree hash
target control
new commit ID
new operation ID
```

### 14.2 publish lock 内顺序

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
11. init 时安装 manifest.json
12. atomic replace/create current.json
13. release lock
```

第 12 步之前，新的 commit 对 Published World 不可见。

### 14.3 failure

非 init 操作在 `current.json` 切换前失败：

- current 不变；
- World authority 不变；
- 已安装的 immutable orphan artifacts 可以保留；
- 不需要 rollback 状态机。

它们没有从 current commit graph 可达，因此没有 authority。

init 在创建 `manifest.json` 后、创建 `current.json` 前失败时，应删除本次新建的 manifest，使目录重新保持可初始化；immutable orphan objects 可以保留。

### 14.4 current 切换之后

一旦 `current.json` 原子切换成功：

```text
mutation = published
```

之后发生的日志、临时目录清理失败不能把已发布 commit 回滚。

CLI 可以返回成功并把 cleanup warning 写 stderr；或在内部 best-effort cleanup，不引入“published but failed”业务状态。

## 15. `settle / abandon`

这两个命令不经过 AI，但使用完全相同的 Patch / publication 模型。

### 15.1 settle

```text
read + pin World
→ deterministic settlement file changes
→ deterministic control transition
→ Patch
→ validate target
→ publish
```

允许：

```text
file changes = []
control changes != []
```

### 15.2 abandon

```text
read + pin World
→ delete current day-owned documents
→ deterministic control transition
→ Patch
→ validate target
→ publish
```

因此系统没有“AI publish”和“deterministic publish”两套协议。

## 16. `--check` 与 `--dry-run`

### 16.1 `--check`

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

### 16.2 `--dry-run`

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

`--dry-run` 仍应在结束时确认 current 与 pinned base 一致；如果已经变化，返回 `WORLD_CONFLICT`，避免输出看似可应用、实际上已过时的结果。

## 17. CLI grammar

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

## 18. 稳定 CLI 输出契约

这个契约在实现命令前冻结，不放到最后再改。

### 18.1 JSON success envelope

```json
{
  "ok": true,
  "command": "plan",
  "result": {}
}
```

### 18.2 JSON error envelope

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

`details` 可以作为可选 object，但不得要求消费者解析 message。

### 18.3 mutation result

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

Check：

```json
{
  "mode": "checked",
  "baseCommitId": "commit_x"
}
```

### 18.4 status result

至少稳定包含：

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

未初始化 World 使用：

```text
status = uninitialized
revision = null
commitId = null
phase = null
```

### 18.5 verify result

```json
{
  "valid": true,
  "revision": 3,
  "commitId": "commit_x",
  "commitsVerified": 3
}
```

### 18.6 stdout / stderr

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

v1 不定义结构化实时 CoreEvent / JSONL progress 协议。

## 19. 稳定错误与 exit code

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

新 TUI 以 `error.code` 为主要机器判断，不解析 message，也不依赖 stderr 文案。

## 20. `status` 与 `verify`

### 20.1 status

只读取当前 Published World：

```text
manifest
current
commit
control
```

返回状态与 available commands。

不扫描 runtime，不看 Session，不调用 AI。

### 20.2 verify

`verify` 是新 Archive 闭环的证明器。

从 current commit 沿 parent 链一直走到 init commit，对每个 commit 验证：

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

最后验证 manifest / current 与 head commit 一致。

`verify` 只验证从 current 可达的 Published World 历史；不可达 orphan artifacts 不影响有效性。

## 21. 推荐源码结构

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

Archive durable schema 放：

```text
packages/archive-protocol/src/
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

## 22. 实施顺序与完成判定

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
new manifest/current/commit/operation schema
DayloomPatchV1
canonical Patch encoding/hash
new layout
pure relation validators
control transition validator
```

完成判定：

- parser 全部 strict；
- unknown fields 被拒绝；
- canonical round-trip 稳定；
- parent + patch 可以证明 child commit；
- init relation 可证明；
- control-only Patch 可证明。

### Phase 2 — Read / status / verify

实现：

```text
read Published World
materialized domain profile validation
status
verify
availability
```

完成判定：

- 手工 fixture 的完整 Archive 可 verify；
- 任意篡改 blob / tree / patch / Draft snapshot / relation 会 verify 失败；
- status 与 availability 使用同一 control source。

### Phase 3 — Workspace / Patch / Publisher

先不接 AI。

实现：

```text
Workspace materialization
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
- 非法 path 被拒绝；
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

整个闭环无 AI 成立。

特别测试 settle 的：

```text
changes = []
control changed = true
```

### Phase 5 — Draft snapshot + AI

实现：

```text
DraftSnapshotV1
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
- repair 有界；
- invalid AI output 永远不能 publish；
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

端到端测试覆盖：

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

## 23. 必须长期保持的测试不变量

至少覆盖：

1. Draft snapshot exact bytes 与 hash 稳定。
2. 多个 `--draft` 的顺序进入 snapshot identity。
3. Workspace 初始树严格等于 pinned tree。
4. AI 无法越权生成最终 Patch path。
5. Workspace add / modify / delete 得到正确 blob-hash Patch。
6. Patch canonical hash 稳定。
7. Patch control.before 与 parent commit 一致。
8. Patch control.after 与 target commit 一致。
9. control-only settle 是合法 mutation。
10. file delta + control delta 同时为空时拒绝 publish。
11. full World validator 是发布硬门槛。
12. repair 最大轮数严格有界。
13. diagnostics 不变时 repair 提前停止。
14. publish lock 内 base 改变返回 `WORLD_CONFLICT`。
15. current 永远是最后 visibility step。
16. current 切换前故障不改变 Published World。
17. Draft-driven commit 必须有可验证 Draft snapshot。
18. deterministic commit 不得伪造 Draft snapshot。
19. 每个 reachable commit 必须有且只有一个 Patch。
20. `verify` 能从 parent + Patch 证明每一个 child commit。
21. `status` 的 availableCommands 与实际 command guard 完全一致。
22. `--json` stdout 始终只有一个 JSON object。
23. `@dayloom/cli` 不依赖 `@dayloom/core`。

## 24. 实现纪律

实现过程中，如果出现选择，优先用下面规则判断：

> Draft 是输入，不是 DSL。  
> Workspace 是临时工作树，不是第二套 Archive。  
> Patch 是版本跃迁记录，不是文本 patch 引擎。  
> Operation 是 immutable command record，不是状态机。  
> Archive 是唯一 Published World authority。  
> Validator 决定能不能发布。  
> `current.json` 决定什么时候真正生效。  
> CLI 不重新长出长期 Session runtime。  
> 能从现有数据推导的信息，不重复存第二份 authority。  
> 能用纯函数验证的关系，不交给 AI 判断。

如果实现需要引入新的长期可变状态、恢复协议、Candidate authority、Session authority 或第二套 publication 状态机，应先视为设计退化，而不是默认接受。

## 25. 完成定义

`@dayloom/cli` v1 只有在下面闭环全部成立时才算完成：

```text
Draft
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

最终要求：

> 每一次 Published World 变化都能被 Patch 精确解释；每一个 Patch 都能被程序验证；每一个当前可见 commit 都能从父版本和 Patch 重新证明；AI 从不拥有 Archive authority。

达到这一点后，新 CLI 的修改、记录、验证和发布形成完整闭环，不需要 Candidate、Change Plan、Session Head 或额外恢复状态机。