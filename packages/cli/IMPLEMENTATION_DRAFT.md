# `@dayloom/cli` 实现草案

> 状态：实现草案  
> 所在分支：`refactor/draft-cli-boundary`  
> 关联设计：`refactor-plans/draft-cli/PROBLEM_AND_GOALS.md`、`refactor-plans/draft-cli/CLI_COMMAND_DESIGN.md`  
> 当前包状态：仅建立可编译 CLI scaffold，尚未实现领域命令

## 1. 包的职责

`@dayloom/cli` 是新的 Draft → Archive 边界。

它负责一次性执行一个领域命令：读取 World 与 Draft，创建临时 Workspace，让 AI 在受限范围内编辑 Workspace，程序校验结果，生成 Dayloom Patch，并通过 Archive publication 原语发布。

核心流程：

```text
Draft
  ↓ snapshot
Pinned Archive
  ↓ materialize
Temporary Workspace
  ↓
AI edit / repair
  ↓
Programmatic Validation
  ↓
Workspace diff
  ↓
Dayloom Patch
  ↓
re-check pinned Archive
  ↓
Archive publish
  ↓
archive Draft snapshot + Patch
  ↓
cleanup Workspace
```

CLI 不负责 Conversation，也不建立长期 Session runtime。

## 2. 明确不迁移的旧 Core 能力

第一版不迁移：

```text
active Session authority
Aggregate Head
Conversation revision
Turn Coordinator
Commit A / Commit B
pendingDraftSync
retryDraftSync
CoreEvent
TUI presentation state
Conversation compression
Draft curation
Candidate lifecycle
Change Plan authority
```

这些职责不应重新以新名字进入 CLI。

CLI 是 process-stateless 的：一次 invocation 完成一次操作后退出。

## 3. v1 公共命令

目标命令面：

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

其中：

- `init / plan / play / revise`：Draft + AI 驱动的 mutation。
- `settle / abandon`：确定性 mutation，不调用 AI。
- `status / verify`：只读。

v1 明确不提供公开 `revert` 命令、API 或 inverse-patch 接口。

所有 mutation，包括 `settle / abandon`，最终都必须先形成 Dayloom Patch，再进入 publish。这样每个新 World commit 都有统一的修改记录。

## 4. 依赖边界

### 4.1 不依赖 `@dayloom/core`

新 CLI 不应以当前 `@dayloom/core` 为运行时依赖，否则只是把旧 Core 包在 CLI 外面。

需要保留的 World / Archive / AI 逻辑应逐步抽离、迁移或重写到更小的模块边界。

### 4.2 Archive Protocol

预计 CLI 可以直接依赖：

```text
@dayloom/archive-protocol
```

用于复用 Archive V2 的 path、blob、tree、commit、staging 等确定性协议能力。

当前仍位于 Core 内、但应迁移或适配的能力主要包括：

```text
read Published World
World profile / domain validation
mutation path policy
atomic publication
structured World readers/builders
```

迁移时应优先复用已有经过测试的实现，而不是重新发明第二套 Archive。

### 4.3 外部 AI

CLI 不实现 OpenAI / DeepSeek / Anthropic provider adapter。

继续使用 Promptpile caller config：

```text
--llm-config <file>
        ↓
DAYLOOM_LLM_CONFIG
```

Dayloom 控制 prompt、tool、Workspace 权限、repair policy 与 validation；Promptpile 控制具体外部模型连接。

## 5. 建议的源码结构

第一版建议保持结构直接，不先做过度抽象：

```text
packages/cli/
  src/
    main.ts
    index.ts

    cli/
      argv.ts
      output.ts
      errors.ts

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
      schema.ts
      build.ts
      validate.ts

    world/
      read.ts
      validate.ts
      publish.ts

    ai/
      config.ts
      boundaries.ts
      react.ts
      workspace-editor.ts
```

这只是实现分区，不要求把每个文件都升级成独立 public abstraction。实际实现中如果某一层很小，可以继续合并。

## 6. Draft 输入

CLI 接受：

```text
--draft <file>...
```

或：

```text
--draft-dir <dir>
```

二者互斥。

命令开始后立即复制 exact input bytes 到 operation-local Draft snapshot，并计算 hash。之后的 AI 与校验只读 snapshot，不再读取调用方原始 Draft 路径。

原则：

```text
用户 Draft = 外部输入
operation Draft snapshot = 本次执行的固定输入
```

CLI 不修改、不移动、不删除用户原 Draft。

成功的 Draft-driven mutation 应把 exact Draft snapshot 与本次 Patch 一起归档。

## 7. Archive base pinning

除 `init` 外，mutation 启动时读取 Published World，并固定：

```text
revision
commitId
rootTreeHash
```

如果调用方提供：

```text
--base <commit>
```

则启动时要求 current commit 严格一致。

AI 执行期间不长期持有 Archive lock。真正 publish 前再次读取 current；base 已变化时返回：

```text
WORLD_CONFLICT
```

不自动 merge，也不 fuzzy apply。

## 8. Workspace

Workspace 是完整的公开 World working tree，而不是 partial Candidate overlay。

例如：

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

不 materialize Archive 协议层内部文件：

```text
objects/
commits/
trees/
operations/
current.json
manifest protocol internals
```

完整 working tree 的目的，是让 AI 与 Validator 都面对一个直观的 World 文件视图，避免重新引入 Candidate assembly / overlay 模型。

### 写权限

读取可以较宽，写入必须 command-specific。

做两层保护：

1. AI filesystem/tool 层只允许写命令规定的路径。
2. diff 得到 Patch 后，程序再次验证所有 changed paths 都在该命令允许范围内。

第二层是最终 authority，不能因为 AI tool 已经做了 sandbox 就省略。

## 9. AI edit 与 Repair

Draft-driven mutation 的 AI 主流程尽量只保留两个动作：

```text
edit workspace
repair workspace from diagnostics
```

首次调用：

```text
Draft snapshot + pinned World/Workspace
  → AI edits Workspace
```

之后：

```text
validate
  ├─ ok → diff
  └─ invalid
       ↓
     diagnostics
       ↓
     bounded AI repair
       ↓
     validate again
```

Repair 有固定最大次数；如果 diagnostics signature 不再变化，可以提前终止。

Validator 是唯一硬发布边界。AI 自己的 review 或判断不能代替程序校验。

第一版不重新引入 Planner / Change Plan / Assignment / Candidate。

## 10. Dayloom Patch

Patch 是一次 World mutation 的正式修改记录。

第一版核心结构：

```json
{
  "schemaVersion": 1,
  "baseCommitId": "commit_17",
  "command": "play",
  "draftHash": "sha256:...",
  "changes": [
    {
      "path": "characters/alice/state.yaml",
      "beforeBlobHash": "aaa",
      "afterBlobHash": "bbb"
    }
  ]
}
```

其中：

```text
修改： A    → B
新增： null → B
删除： A    → null
```

Patch 不保存 textual diff hunk，也不重复保存完整文件 bytes。真正内容仍由 Archive immutable blob store 保存。

Patch 不保存 `targetCommitId`，避免 Patch 与 commit / operation 重复承担 authority，也让 `--dry-run` 能在没有 target commit 时自然地产生 Patch。

### Patch 如何得到

程序比较：

```text
pinned base tree
vs
final Workspace
```

对每个 path 计算 blob hash，得到新增、删除、修改集合。

生成 Patch 后必须检查：

- changed path 合法；
- command 允许修改该 path；
- before hash 与 pinned base 一致；
- after blob 内容 / media type 合法；
- Patch 不为空（除非某个确定性命令明确允许 no-op；第一版默认 mutation no-op 不发布）。

## 11. Patch 与 Archive 的职责关系

目标关系保持单一职责：

```text
commit
  ├── tree ──→ blobs
  └── operation
          └── patch
```

各自回答不同问题：

```text
tree       = 这个版本完整是什么
patch      = 这次相对 base 改了什么
operation  = 这是哪一种操作
commit     = 这次发布形成的版本节点
```

Patch 通过 `beforeBlobHash / afterBlobHash` 保留完整的历史变化信息，但 v1 不对外暴露还原接口。

Patch V1 的精确 ID、存放路径，以及 operation 如何引用 Patch，需要在实现 publication 前先冻结。

## 12. Publish

Publish 应最大程度复用现有 Archive V2 原子发布性质：

1. acquire publish lock；
2. re-check current == pinned base；
3. install new immutable blobs；
4. install Patch / tree / commit / operation 所需 immutable records；
5. 完整验证将要公开的 World；
6. 最后原子更新 `current.json`；
7. current 切换成功才算 mutation 对外可见。

任意 pre-current 失败不能产生部分 Published World 更新。

对于 `init`，仍需保持现有“未初始化目录 → 首次 publication”的原子语义。

## 13. `settle / abandon`

这两个命令不需要 AI，也不需要 Workspace editor，但仍走同一个 mutation tail：

```text
read + pin World
  ↓
deterministic domain changes
  ↓
Dayloom Patch
  ↓
validation
  ↓
re-check base
  ↓
publish
```

这样 CLI 内只有一套 publish / audit / Patch 规则。

## 14. `--check` 与 `--dry-run`

### `--check`

只执行低成本确定性检查：

```text
read World
read Draft
command availability
Draft lint
basic input validation
```

不调用 AI，不 materialize 完整 AI Workspace，不生成可发布 commit。

### `--dry-run`

Draft-driven mutation 执行到 Patch 为止：

```text
snapshot
→ Workspace
→ AI edit / repair
→ validate
→ diff
→ Patch
```

不 publish。

确定性 mutation 同样生成 Patch 后停止。

## 15. 输出与错误

第一阶段优先保证最终输出稳定，不重新建立 CoreEvent 事件体系。

建议：

- 普通模式：stderr 输出少量阶段进度，stdout 输出最终人类结果。
- `--json`：stdout 只输出最终稳定 JSON；日志仍走 stderr。
- 如新 TUI 后续确实需要结构化实时进度，再单独加入很薄的 JSONL progress contract，不预先复制 CoreEvent。

第一批稳定错误可围绕：

```text
DRAFT_INVALID
WORLD_INVALID
WORLD_CONFLICT
LLM_CONFIG_REQUIRED
AI_FAILED
VALIDATION_FAILED
PATCH_INVALID
NOT_AVAILABLE
INTERNAL_ERROR
```

具体 exit code 与 JSON schema 在命令实现前冻结。

## 16. 测试重点

第一批测试不应围绕旧 Session 行为，而应围绕新边界：

1. Draft snapshot 在执行中保持不可变。
2. Workspace materialize 后等价于 pinned Published World。
3. AI 无法把非法 path 写入最终 Patch。
4. base / Workspace diff 对 add / modify / delete 生成正确 hash。
5. Validator 拒绝非法 World，即使 AI 返回成功。
6. repair 次数有界且 diagnostics 不变时停止。
7. publish 前 World 改变时返回 `WORLD_CONFLICT`。
8. publication 保持 current 原子切换。
9. `settle / abandon` 也生成 Patch。
10. 成功 Draft-driven mutation 能关联 exact Draft snapshot 与 Patch。

## 17. 推荐实现顺序

### Phase 0 — Scaffold

当前阶段：

- 建立 `@dayloom/cli` package；
- 建立 `dayloom` bin；
- 接入 monorepo build / test；
- 暂不引入 Core runtime 依赖。

### Phase 1 — Read-only foundation

先完成：

```text
status
verify
World read
command availability
```

用现有 Archive / World 测试确认 CLI 可以独立理解 Published World。

### Phase 2 — Patch foundation

实现：

```text
Workspace materialization
Workspace diff
Patch V1 schema
Patch validation
Patch archive relation
```

这一阶段先不接 AI，可以用测试 fixture 手工修改 Workspace。

### Phase 3 — Deterministic mutations

迁移：

```text
settle
abandon
```

验证统一的：

```text
changes → Patch → validate → publish
```

### Phase 4 — Draft + AI

接入：

```text
Draft snapshot / lint
Promptpile config
Workspace editor
bounded repair
```

依次实现 `init / plan / play / revise`。

### Phase 5 — CLI contract hardening

冻结：

```text
JSON output
exit codes
progress output
packaging
integration tests
```

## 18. 实现纪律

实现过程中优先遵守以下约束：

> Draft 是输入，不是 DSL。  
> Workspace 是临时工作树，不是第二套 Archive。  
> Patch 是修改记录，不是文本 patch 引擎。  
> Archive 是唯一 Published World authority。  
> Validator 决定能不能发布。  
> CLI 不重新长出长期 Session runtime。

如果某个新抽象只是在重新包装旧 Core 的 Session / Candidate / event machinery，应优先删除或缩小，而不是继续兼容。
