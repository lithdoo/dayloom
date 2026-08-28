# Dayloom Draft / CLI 重构：冻结设计

> 状态：Frozen v1  
> 分支：`refactor/draft-cli-boundary`  
> 实施细节：`packages/cli/IMPLEMENTATION_DRAFT.md`  
> 范围：CLI、Draft 输入、Workspace、Patch、新 Archive publication  
> 非目标：不修改 Draft 格式，不引入 Draft DSL，不提供公开 revert

## 1. 核心模型

新架构长期只保留三个概念：

```text
Draft
Patch
Archive
```

定义：

```text
Draft   = 人 / AI 可读写的创作语义输入
Patch   = 一次 World 版本跃迁的正式修改记录
Archive = Published World 的唯一事实和历史
```

Workspace、AI edit、repair、publish lock 都只是一次 CLI invocation 的内部机制。

> Draft 是输入，Patch 解释变化，Archive 保存事实。

## 2. 主流程

Draft-driven mutation：

```text
Draft
  ↓ exact snapshot
Pinned Archive
  ↓ materialize
Temporary complete World Workspace
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
re-check pinned Archive
  ↓
atomic Archive publish
  ↓
Published commit
```

确定性 mutation：

```text
Pinned Archive
  ↓
deterministic file/control changes
  ↓
Dayloom Patch
  ↓
validation
  ↓
atomic Archive publish
```

所有 mutation 最终只有一条 publication 路径。

## 3. 不进入新架构的旧复杂度

不保留，也不换名字重新实现：

```text
Session authority
Aggregate Head
Conversation revision
Turn Coordinator
Commit A / Commit B
pendingDraftSync
retryDraftSync
Candidate lifecycle
Change Plan / Assignment authority
CoreEvent presentation protocol
TUI presentation reducer
```

CLI 是 process-stateless：一次命令运行结束即退出。

## 4. 新 Archive

新实现直接采用新的 Archive 数据模型，不设计旧文件兼容、历史迁移或双读协议。

核心不变量：

```text
每个 reachable commit
  ↓
恰好一个 operation
  ↓
恰好一个 patch
```

Draft-driven mutation 还必须关联 exact Draft snapshot。

布局：

```text
<world>/
  manifest.json
  current.json

  commits/
    <commitId>.json

  objects/
    blobs/sha256/<64-lowercase-hex>
    trees/sha256/<64-lowercase-hex>.json

  operations/
    <operationId>/
      operation.json
      patch.json
      draft-snapshot.json   # Draft-driven only
      draft/                # Draft-driven only
        ... exact bytes ...

  .locks/
    publish.lock
```

除了 `current.json` 和瞬时 publish lock，其余 Published history 都是 immutable。

Operation 不建立 `open / prepared / published / aborted` 状态机。是否发布只由：

```text
current → reachable commit
```

决定。

## 5. 协议基础格式

所有持久化 SHA-256 字段统一：

```text
sha256:<64 lowercase hex>
```

适用于 blob、root tree、Patch、Draft snapshot 和 Draft entry hash。

磁盘 content-addressed 路径只取 digest 部分。

对象 ID：

```text
world_<32 lowercase hex>
commit_<32 lowercase hex>
op_<32 lowercase hex>
```

均由程序生成；AI 不生成 Archive object ID。

Durable JSON 使用 strict parser：unknown field、unsupported schemaVersion、非法 ID/hash/timestamp 一律拒绝。参与 hash 的 Patch、DraftSnapshot、RootTree 使用 canonical JSON。

## 6. Manifest / Current / Commit / Operation

Manifest：

```ts
interface ArchiveManifestV1 {
  schemaVersion: 1;
  worldId: string;
  title: string;
  createdAt: string;
}
```

Current：

```ts
interface CurrentPointerV1 {
  schemaVersion: 1;
  revision: number;
  commitId: string;
  updatedAt: string;
}
```

Commit：

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

Operation：

```ts
interface ArchiveOperationV1 {
  schemaVersion: 1;
  id: string;
  command: DayloomPatchV1['command'];
  patchHash: string;
  createdAt: string;
}
```

Manifest immutable；Current 是唯一正常变化的 authority pointer；Operation 是 immutable command record，不是 publication 状态机。

`init` 的 Manifest 完全由程序生成：

```text
worldId   = CLI 生成
title     = validated state/world.yaml.title
createdAt = 正式 init publication timestamp
```

AI 不生成或编辑 Manifest。

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

分类：

- `init / plan / play / revise`：Draft + AI mutation。
- `settle / abandon`：确定性 mutation。
- `status / verify`：只读。

明确不公开：

```text
session
start
send
submit
cancel
retry
resume
candidate
repair
review
publish
revert
```

### 7.1 availability

| World 状态 | 可用 mutation |
| --- | --- |
| uninitialized | `init` |
| `idle` | `plan`, `revise` |
| `planned` | `play`, `abandon` |
| `awaiting-settle` | `settle`, `abandon` |
| invalid | 无 |

`status` 和真正 command guard 使用同一个 availability 实现。

## 8. CLI grammar

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

dayloom status <world> [--json]
dayloom verify <world> [--json]
```

World 是唯一 positional primary object。

Draft 和 World 提供领域语义，不增加 mutation DSL 参数。

## 9. Draft snapshot

Draft 格式保持现有格式不变。

支持：

```text
--draft <file>...
```

可重复，顺序具有语义；或：

```text
--draft-dir <dir>
```

二者互斥。

CLI 开始后立即制作 exact Draft snapshot，此后只读 snapshot，不继续读取用户原文件，也不修改/移动/删除用户 Draft。

只接受真实 regular file / directory；symlink、socket、FIFO、device 等一律拒绝。

多 `--draft` 使用稳定归档位置：

```text
draft/files/0001/<basename>
draft/files/0002/<basename>
...
```

所以同名文件不会碰撞，参数顺序进入 snapshot identity。

`--draft-dir` 使用：

```text
draft/root/<relative-path>
```

并按 canonical relative path 稳定排序。

DraftSnapshot 使用 canonical JSON，hash 统一为：

```text
draftSnapshotHash = sha256:<64 lowercase hex>
```

Patch → DraftSnapshot → exact Draft bytes 必须可由 `verify` 完整验证。

## 10. Workspace

Workspace 是 pinned World 的完整公开文档视图，不是 Candidate overlay、第二套 Archive 或长期 Session workspace。

AI 可以读完整 World，但只允许写 command-specific paths。

AI 执行后、validation/diff 前必须扫描 Workspace，拒绝 symlink、special file、路径逃逸和 Archive protocol path。

必须有两层保护：

1. AI filesystem/tool write scope；
2. Patch 生成后程序再次校验 changed paths。

第二层是最终 authority。

`init` 没有 base tree，使用空 Workspace；AI 只生成创作性 World documents。Manifest、Current、Commit、Operation、Patch、control 等协议对象全部由程序生成。

## 11. command write policy

新架构不把 `audit/` 当作 World 审计入口；审计由 Operation/Patch/Draft snapshot 表达。

### `init`

允许创建完整初始长期 World：

```text
profile/dayloom.json
canon/{premise,rules,style,user-role}.md
state/{world,calendar,progress,variables}.yaml
characters/index.yaml
characters/<id>/{profile.md,state.yaml,relationships.yaml,memory.md,timeline.md}
locations/index.yaml
locations/<id>/{profile.md,state.yaml,memory.md,triggers.yaml,timeline.md}
arcs/index.yaml
arcs/<id>/{profile.md,state.yaml,timeline.md}
memory/{short-term.md,long-term.md,facts.yaml,unresolved-threads.yaml,important-events.yaml}
story-seeds/active.yaml
custom/**
```

不允许 `days/**`。

### `plan`

仅当前 target day：

```text
days/<day>/plan.json
days/<day>/timeline.md
days/<day>/dialogue/planning.md
days/<day>/events/index.yaml
```

### `play`

仅当前 planned day：

```text
days/<day>/play.json
days/<day>/play-index.json
days/<day>/summary.md
days/<day>/timeline.md
days/<day>/events/**
```

`play` 不直接改长期 state；长期状态由 `settle` 确定性应用。

### `revise`

允许长期 World 资料，但禁止：

```text
profile/**
days/**
state/calendar.yaml
```

允许 canon、state/world/progress/variables、characters、locations、arcs、memory、story-seeds、custom 的既定 World Profile 路径。

### `settle`

只有 deterministic settlement builder 可写：

```text
state/calendar.yaml
state/variables.yaml
characters/<existing-id>/{state.yaml,timeline.md}
locations/<existing-id>/{state.yaml,timeline.md}
arcs/<existing-id>/{state.yaml,timeline.md}
memory/facts.yaml
memory/important-events.yaml
story-seeds/active.yaml
days/<current-day>/{summary.md,diary.md,settlement.yaml,next-day-seed.yaml}
```

### `abandon`

只允许删除：

```text
days/<current-day>/**
```

精确正则/纯函数及 allowed/denied 测试以 `IMPLEMENTATION_DRAFT.md` 为准。

## 12. Validation 与 Repair

```text
AI edit
  ↓
validate complete Workspace + target control
  ├─ valid → Patch
  └─ invalid
       ↓
     deterministic diagnostics
       ↓
     bounded AI repair same Workspace
       ↓
     validate again
```

Programmatic Validator 才是发布硬门槛。

Repair 次数固定有界；diagnostics signature 不变化时提前停止。

v1 不要求 Planner / Change Plan / Candidate / mandatory AI reviewer。

## 13. World control

```ts
interface WorldControlV1 {
  phase: 'idle' | 'planned' | 'awaiting-settle';
  day: string | null;
  lastSettledDay: string | null;
}
```

AI 无权修改 control；command 确定性计算。

| Command | Transition |
| --- | --- |
| `init` | `null → idle` |
| `plan` | `idle → planned(nextDay)` |
| `play` | `planned → awaiting-settle` |
| `revise` | control 不变 |
| `settle` | `awaiting-settle → idle`，原 day 成为 lastSettledDay |
| `abandon` | `planned/awaiting-settle → idle`，lastSettledDay 不变 |

## 14. Dayloom Patch

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
  changes: readonly {
    path: string;
    beforeBlobHash: string | null;
    afterBlobHash: string | null;
  }[];
}
```

Patch 同时记录 file delta + control delta。

Patch 不保存 textual diff、重复 bytes 或 target commit ID。

Canonical Patch hash：

```text
patchHash = sha256:<64 lowercase hex>
```

合法 mutation 必须满足：

```text
changes.length > 0
OR
control.before != control.after
```

因此 control-only settle 合法。

## 15. Patch / Operation / Commit 闭环

```text
current
  ↓
commit
  ├──→ tree → blobs
  ├──→ parent commit
  └──→ operation
          └──→ patch
                  └──→ Draft snapshot (optional)
```

`verify` 必须从 parent + Patch 重新证明 child：

```text
patch.baseCommitId == parent.id
patch.control.before == parent.control
patch.control.after == commit.control
operation.command == patch.command
hash(patch) == operation.patchHash
apply(parent.tree, patch.changes) == commit.rootTreeHash
commit.revision == parent.revision + 1
```

同时验证 path policy、blob hash、Draft snapshot、Manifest/Current relation 和 lifecycle transition。

init 还验证：

```text
parent = null
baseCommitId = null
control.before = null
manifest.title == validated state/world.yaml.title
```

## 16. Pinned base 与并发

除 init 外，命令开始时固定：

```text
revision
commitId
rootTreeHash
control
```

`--base <commit>` 是可选 optimistic-concurrency precondition。

AI 工作期间不持 publish lock。

publish 时进入锁后再次验证 current 仍是 pinned base；不一致返回 `WORLD_CONFLICT`。

不 merge，不 fuzzy apply，不 rebase，不自动重跑 AI。

## 17. Publication

统一 publisher：

```text
validated Patch
  ↓
acquire publish lock
  ↓
re-check base
  ↓
install immutable blobs
  ↓
install immutable target tree
  ↓
install Draft snapshot artifacts (optional)
  ↓
install patch.json
  ↓
install operation.json
  ↓
install commit.json
  ↓
verify target graph
  ↓
install manifest on init
  ↓
atomic current.json switch
```

`current.json` 永远是最后 visibility step。

current 切换前失败：Published World 不变；非 init 可留下无 authority 的 immutable orphan artifacts。

current 成功切换后 mutation 已发布，cleanup 失败不能回滚 commit。

## 18. `--check` / `--dry-run`

`--check` 仅 Draft-driven command：读 World、check availability、snapshot/lint Draft；不调用 AI、不要求 LLM、不生成 Patch。

`--dry-run` 执行完整 pipeline 到 Patch validation，并最终检查 base 未过时，但不 publish。

`init --dry-run` 不生成正式 worldId/Manifest，只返回 validated title + Patch preview。

Draft-driven dry-run 需要 LLM；`settle / abandon --dry-run` 不需要。

## 19. 外部 AI 配置

唯一 CLI 配置入口：

```text
--llm-config <file>
```

fallback：`DAYLOOM_LLM_CONFIG`；缺少时 `LLM_CONFIG_REQUIRED`。

Dayloom 不自己实现 provider adapter；provider/model/API 连接交给 Promptpile caller config。

Dayloom 控制 prompt、tools、Workspace root/write policy、repair、validation、publication。

不增加 `--provider / --model / --api-key / --base-url`。

## 20. 机器输出

所有命令支持 `--json`。

稳定 envelope：

```json
{
  "ok": true,
  "command": "plan",
  "result": {}
}
```

错误：

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

`--json` stdout 只输出一个最终 JSON object。新 TUI 依赖 `error.code` 和稳定 result 字段，不解析 message 或 stderr。

## 21. `status` 与 `verify`

`status` 返回 World status、revision、commitId、phase、day、lastSettledDay、availableCommands。

`verify` 从 current 沿 parent history 验证：

```text
manifest/current
commit/tree/blob
operation/patch
Patch tree transition
Patch control transition
command write policy
Draft snapshot exact bytes
revision/parent chain
```

只验证从 current 可达的 Published history；orphan artifacts 不影响 World validity。

## 22. 完成标准

新架构只有在以下方向同时成立时才算完成：

```text
Draft
→ exact snapshot
→ Workspace
→ Validate / Repair
→ Patch
→ Commit
→ verify
```

以及：

```text
Commit
→ Operation
→ Patch
→ Parent tree/control
→ 重新证明当前 Commit tree/control
```

以及 init：

```text
validated state/world.yaml.title
→ program-generated Manifest
→ init Commit/Patch
→ current
→ verify
```

最终不变量：

> 每一次 Published World 变化都能被 Patch 精确解释；每一个 reachable commit 都能从父版本和 Patch 重新证明；每一份 Draft-driven mutation 都能追溯 exact Draft bytes；AI 永远不拥有 Archive authority。

具体 schema、正则、测试门槛和实施顺序以 `packages/cli/IMPLEMENTATION_DRAFT.md` 为最终实现依据。