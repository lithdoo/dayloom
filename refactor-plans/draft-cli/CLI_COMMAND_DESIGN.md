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

一句话：

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

新 Archive 概念布局：

```text
<world>/
  manifest.json
  current.json

  commits/
    <commitId>.json

  objects/
    blobs/sha256/<hash>
    trees/sha256/<hash>.json

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

## 5. v1 公共命令

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

### 5.1 command availability

| World 状态 | 可用 mutation |
| --- | --- |
| uninitialized | `init` |
| `idle` | `plan`, `revise` |
| `planned` | `play`, `abandon` |
| `awaiting-settle` | `settle`, `abandon` |
| invalid | 无 |

`status` 和真正 command guard 使用同一个 availability 实现。

## 6. CLI grammar

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

Draft 和 World 提供领域语义，不增加 `--path / --replace / --delete / --event` 等 mutation DSL 参数。

## 7. Draft 输入

Draft 保持现有格式不变。

支持：

```text
--draft <file>...
```

可重复，顺序具有语义。

或：

```text
--draft-dir <dir>
```

表示一个完整 Draft root。

两者互斥。

CLI 启动后立即制作 exact Draft snapshot，此后本次 invocation 只读取 snapshot，不继续读取用户原文件。

CLI 永远不修改、移动或删除用户提供的 Draft。

Draft-driven publish 成功后，exact Draft snapshot 归档到对应 operation 目录。

## 8. Workspace

Workspace 是 pinned World 的完整公开文档视图：

```text
Published World
  ↓ materialize
Workspace
  ↓ AI edit
```

不是：

```text
Candidate overlay
第二套 Archive
长期 Session workspace
```

AI 可以读完整 World，但只允许写 command-specific paths。

必须有两层保护：

1. AI filesystem/tool write scope；
2. Patch 生成后程序再次校验 changed paths。

第二层是最终 authority。

`init` 没有 base tree，使用空 / 最小 Workspace，由 AI 根据 Init Draft 生成初始 World documents。

AI 不生成 manifest、commit、operation、patch、current 或 control。

## 9. Validation 与 Repair

主循环：

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

规则：

```text
AI 认为完成 ≠ 可以发布
Programmatic Validator 通过 = 才能继续
```

Repair 次数固定有界；diagnostics signature 不变化时提前停止。

v1 不要求 Planner / Change Plan / Candidate / mandatory AI reviewer。

## 10. World control

World 版本由：

```text
root tree
+
commit.control
```

共同组成。

control：

```ts
interface WorldControlV1 {
  phase: 'idle' | 'planned' | 'awaiting-settle';
  day: string | null;
  lastSettledDay: string | null;
}
```

AI 无权修改 control；它由 command 确定性计算。

| Command | Transition |
| --- | --- |
| `init` | `null → idle` |
| `plan` | `idle → planned(nextDay)` |
| `play` | `planned → awaiting-settle` |
| `revise` | control 不变 |
| `settle` | `awaiting-settle → idle`，原 day 成为 lastSettledDay |
| `abandon` | `planned/awaiting-settle → idle`，lastSettledDay 不变 |

## 11. Dayloom Patch

Patch 同时记录：

```text
文件树变化
+
control 变化
```

核心结构：

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

文件变化：

```text
修改： A    → B
新增： null → B
删除： A    → null
```

Patch 不保存 textual diff hunk，不重复保存文件 bytes，不保存 target commit ID。

Patch 使用 canonical JSON，`changes` 按 path 稳定排序：

```text
patchHash = sha256(canonical Patch bytes)
```

### 11.1 no-op

合法 mutation 必须满足：

```text
changes.length > 0
OR
control.before != control.after
```

所以 `settle` 可以没有文件变化，只产生合法 control transition。

## 12. Patch / Operation / Commit 关系

关系保持单向：

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

职责：

```text
blob      = 文件内容
tree      = 完整文件集合
patch     = 相对父版本改了什么
operation = 这次是什么 command
commit    = 发布后的完整版本
current   = 当前可见版本
```

Operation 是 immutable command record，不是 publication 状态机。

Patch 通过 hash 被 Operation 锚定；Draft snapshot 通过 `draftSnapshotHash` 被 Patch 锚定。

## 13. Patch 闭环验证

`verify` 必须能从 parent + Patch 重新证明每一个 child commit。

非 init：

```text
patch.baseCommitId == parent.id
patch.control.before == parent.control
patch.control.after == commit.control
operation.command == patch.command
hash(patch) == operation.patchHash
apply(parent.tree, patch.changes) == commit.rootTreeHash
```

同时验证：

```text
path policy
blob existence/hash
Draft snapshot hash（如有）
command control transition
revision / parent chain
```

init：

```text
parent = null
baseCommitId = null
control.before = null
command = init
apply(empty tree, patch.changes) == root commit tree
```

因此 Patch 不是单纯 audit 文本，而是可程序验证的版本跃迁证明。

## 14. Pinned base 与并发

除 init 外，命令开始时固定：

```text
revision
commitId
rootTreeHash
control
```

`--base <commit>` 是可选 optimistic-concurrency precondition。

AI 工作期间不持 publish lock。

publish 时进入锁后再次验证 current 仍是 pinned base；不一致：

```text
WORLD_CONFLICT
```

不自动 merge，不 fuzzy apply，不 rebase，不自动重跑 AI。

## 15. Publication

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

`current.json` 切换前发生故障：Published World 不变。

非 init 允许留下不可达 immutable orphan artifacts；它们没有 authority，不需要 publication recovery state machine。

current 成功切换后，该 mutation 已发布。之后临时目录 cleanup 失败不能回滚 commit。

## 16. 归档与备份

长期保留：

```text
commit / tree / blobs
operation
Patch
Draft snapshot（Draft-driven only）
```

Workspace 不归档。

Archive 不得删除任何仍被 reachable commit / Patch 引用的 blob。

Patch 的 before / after blob hashes 因而保留精确历史数据。

v1 明确：

```text
没有 dayloom revert
没有公开 revert API
没有 inverse-patch apply 接口
```

是否以后提供恢复功能不影响当前 Patch 数据模型。

## 17. `--check` / `--dry-run`

### `--check`

仅 Draft-driven command：

```text
read World
check availability
snapshot Draft
Draft lint
basic input validation
```

不调用 AI，不要求 LLM config，不生成 Patch。

### `--dry-run`

执行完整 mutation pipeline 到 Patch validation，最后再检查 base 未过时，但不 publish。

Draft-driven dry-run 需要 LLM。

`settle / abandon --dry-run` 不需要 LLM。

## 18. 外部 AI 配置

唯一 CLI 配置入口：

```text
--llm-config <file>
```

fallback：

```text
DAYLOOM_LLM_CONFIG
```

缺少时：

```text
LLM_CONFIG_REQUIRED
```

Dayloom 不自己实现 OpenAI / DeepSeek / Anthropic provider adapter；provider/model/API 连接继续交给 Promptpile caller config。

Caller 控制：

```text
provider
model
base_url
credential source
temperature/model params
```

Dayloom 控制：

```text
prompt
tools
Workspace root
write policy
repair policy
validation
publication
```

不增加 `--provider / --model / --api-key / --base-url`。

## 19. 机器输出

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

`--json` stdout 只输出一个最终 JSON object。stderr 只用于日志 / warning。

新 TUI 依赖 `error.code` 和稳定 result 字段，不解析 message 或 stderr。

## 20. `status` 与 `verify`

`status` 返回：

```text
World status
revision
commitId
phase
day
lastSettledDay
availableCommands
```

`verify` 从 current commit 沿 parent history 验证完整闭环：

```text
manifest/current
commit/tree/blob
operation/patch
Patch tree transition
Patch control transition
Draft snapshot exact bytes
revision/parent chain
```

只验证从 current 可达的 Published history；不可达 orphan artifacts 不影响 World validity。

## 21. 完成标准

新架构只有在以下两个方向同时成立时才算完成：

```text
Draft
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

最终不变量：

> 每一次 Published World 变化都能被 Patch 精确解释；每一个 reachable commit 都能从父版本和 Patch 重新证明；AI 永远不拥有 Archive authority。

具体 schema、测试门槛和实施顺序以 `packages/cli/IMPLEMENTATION_DRAFT.md` 为实现依据。