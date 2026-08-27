# Dayloom Draft / CLI 重构：CLI 与 Patch 设计

> 状态：讨论稿  
> 分支：`refactor/draft-cli-boundary`  
> 范围：冻结新 CLI 的主要命令面、Draft 输入边界、AI Workspace、Patch 与 Archive publication 关系  
> 非目标：不修改 Draft 格式，不引入新的 Draft DSL，不提供公开 revert 接口

## 1. 核心模型

新架构只保留三个长期需要理解的对象：

```text
Draft
Archive
Patch
```

其中：

- Draft：人类 / AI 可读写的创作语义输入。
- Archive：Published World 的唯一事实权威和版本历史。
- Patch：一次 World mutation 的正式变更记录。

Workspace、AI edit、repair 都只是一次 CLI invocation 内部的临时执行过程，不是新的领域对象。

一句话概括：

> Draft 是输入，Workspace 是临时工作树，Patch 是修改记录，Archive 是唯一事实。

## 2. 设计原则

1. World 是每个命令的主对象，作为唯一 positional argument。
2. Draft 保持现有格式，不升级为 mutation DSL。
3. Draft 是显式外部输入，不再由长期 Core Session 持有 authority。
4. AI 永远不直接修改 Archive。
5. CLI 基于 pinned Archive materialize 一个临时 World Workspace，让 AI 直接编辑 Workspace。
6. Workspace 是完整的公开 World 文档视图，而不是另一个 Archive，也不是 partial Candidate overlay。
7. 不同 command 通过 write policy 限制 AI 可以修改哪些路径。
8. 程序最终根据 pinned base 与 Workspace 的差异生成 Dayloom Patch。
9. 所有会产生新 World commit 的 mutation 都必须先产生 Patch，再进入 Archive publication。
10. Programmatic Validator 是唯一硬发布边界；AI 不能绕过 validation。
11. 发布前必须重新检查当前 Archive 仍然等于本次 operation 的 pinned base。
12. Patch 使用 blob hash 表达前后状态，不依赖 Git patch 或 textual hunk。
13. Patch 不承担完整版本状态 authority；完整版本仍由 commit / tree / blob 表达。
14. CLI 拥有 AI prompt、tools、Workspace 权限与 validation；具体模型 provider 继续由 Promptpile caller config 决定。
15. v1 不提供公开 `revert` 命令、API 或接口。

统一命令形态：

```text
dayloom <action> <world> [inputs/options]
```

## 3. v1 命令集合

v1 只包含：

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

- `init / plan / play / revise`：Draft 驱动 mutation。
- `settle / abandon`：确定性 mutation，不依赖 Draft 或 LLM。
- `status / verify`：只读。

不公开旧 runtime / pipeline 内部概念：

```text
start
session
send
submit
cancel
retry
resume
history
conversation
candidate
operation
repair
review
publish
revert
```

`revert` 明确不属于 v1 公共接口。Patch 仍保存 `beforeBlobHash / afterBlobHash`，因此数据层不会丢失未来实现恢复工具所需的信息，但当前不设计公开还原语义、命令或错误契约。

## 4. Draft 输入

### 4.1 `--draft <file>`

指定一个 Draft 文档，可重复：

```bash
dayloom revise ./world \
  --draft ./character.md \
  --draft ./location.md \
  --draft ./story.md
```

多个 `--draft` 的顺序保持调用方输入顺序，不排序。

### 4.2 `--draft-dir <dir>`

指定一个完整 Draft 根目录，例如既有 Play Draft：

```text
play-draft/
  play.md
  events/
    e001.md
    e002.md
```

调用：

```bash
dayloom play ./world --draft-dir ./play-draft
```

CLI 按当前 command 的既有 Draft 约定读取目录；不新增 `draft.json`、`manifest.yaml` 等新格式。

### 4.3 互斥

```text
--draft <file>... | --draft-dir <dir>
```

二者互斥。

## 5. mutation 命令

### 5.1 Draft 驱动

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
```

Draft 和当前 World 提供领域语义，不额外暴露 `--day`、`--event`、`--path`、`--replace`、`--delete` 等重复 authority 或 mutation DSL 参数。

### 5.2 确定性 mutation

```text
dayloom settle <world>
        [--base <commit>]
        [--dry-run]
        [--json]

dayloom abandon <world>
        [--base <commit>]
        [--dry-run]
        [--json]
```

虽然 `settle / abandon` 不经过 AI Workspace edit，它们和 Draft 驱动命令仍共享同一个 publication 原则：

```text
deterministic changes
  ↓
Dayloom Patch
  ↓
validation
  ↓
Archive publish
```

即：任何 mutation 都有对应 Patch。

## 6. 只读命令

### 6.1 `status`

```text
dayloom status <world> [--json]
```

返回当前 World、revision、commit、day / phase，以及当前允许的领域命令。新 TUI 应消费该结果，不重新实现 lifecycle capability 判断。

### 6.2 `verify`

```text
dayloom verify <world> [--json]
```

只读验证：

- Manifest / `current.json`
- commit / tree / blobs
- hash 与引用关系
- World Profile 与领域引用
- Archive invariants
- operation / Patch 引用关系
- Patch 中引用的 blob 是否存在

不调用 AI，不修改 World。

## 7. Draft → Archive 主流程

Draft 驱动 mutation 的核心流程：

```text
Draft
  ↓
固定 Draft exact snapshot
  ↓
读取并 pin 当前 Archive base
  ↓
materialize 完整 World Workspace
  ↓
AI 根据 Draft 直接编辑 Workspace
  ↓
Programmatic Validation
  ↓
失败时有限次数 AI Repair
  ↓
base / Workspace diff
  ↓
生成 Dayloom Patch
  ↓
Patch path / mutation policy 校验
  ↓
重新检查 Archive current == pinned base
  ↓
Archive atomic publish
  ↓
归档 Patch + Draft snapshot
  ↓
删除临时 Workspace
```

v1 不要求独立 Change Plan、Assignment 或 Candidate lifecycle。

如果未来实际运行证明 AI 经常产生合法但超出用户意图的修改，再根据数据考虑增加可选 semantic planning/review，而不是预先把它冻结成协议层。

## 8. Draft snapshot

CLI 启动后将 `--draft` / `--draft-dir` 的 exact bytes 复制到 operation-local 临时位置，并计算稳定 hash。

此后本次 operation 只读取该 snapshot，不继续读取用户原始 Draft 路径。

因此运行过程中用户继续编辑原始 Draft，也不会改变正在执行的 mutation。

CLI 永远不修改、移动或删除用户提供的原始 Draft。

成功 publication 后，Draft 驱动 mutation 应归档本次 exact Draft snapshot，并让对应 operation / Patch 可以追溯到该 snapshot/hash。

## 9. Pinned Archive base

除 `init` 外，命令启动时固定当前：

```text
revision
commitId
rootTreeHash
```

提供：

```text
--base <commit>
```

时，命令启动时必须严格匹配该 commit，否则返回 `WORLD_CONFLICT`。

未提供 `--base` 时，以启动时读取到的 current World 为 pinned base。

发布前必须再次检查 visible Archive。若 revision / commitId / rootTreeHash 已变化，则失败：

```text
WORLD_CONFLICT
```

不自动 merge，不 fuzzy apply。

## 10. Workspace

Workspace 是一次 invocation 的临时完整 World working tree。

概念上：

```text
Published Archive
      ↓ materialize
temporary workspace/
  canon/
  characters/
  locations/
  arcs/
  state/
  days/
  ...
```

不复制 Archive 协议层内容：

```text
objects/
commits/
trees/
operations/
patches/
current.json
manifest.json
```

### 10.1 为什么使用完整 World view

AI 和 Validator 都面对一个普通、完整的 World 文档树：

```text
read full World
edit allowed paths
validate full World
```

避免重新引入 partial overlay / Candidate assembly 一类额外模型。

`init` 是特殊情况：没有 Published base，CLI 创建一个新的空 / 最小 World Workspace，由 Init Draft 驱动生成完整初始 World。

### 10.2 写权限

不同 command 有不同 write policy。

两层保护必须同时存在：

1. AI 文件工具只允许写 command-specific 路径。
2. diff 生成 Patch 后，程序再次检查所有 changed path 都符合该 command 的 mutation policy。

AI 可以读完整公开 World，但不能越权写入 Archive 或协议文件。

### 10.3 生命周期

```text
create
  ↓
AI edit / repair
  ↓
validate / diff
  ↓
publish or fail
  ↓
cleanup
```

Workspace 不恢复、不归档，也没有 Session Head、activeSession、pending sync。

## 11. Validation 与 Repair

基本循环：

```text
AI edit
  ↓
validate full Workspace
  ├─ ok → diff / Patch
  └─ invalid
       ↓
     diagnostics
       ↓
     AI repair same Workspace
       ↓
     validate again
```

Repair 有固定最大轮数；diagnostics 不再变化时可以提前停止。

硬规则：

```text
AI 认为正确 ≠ 可以发布
Validator 通过 = 才可以进入 Patch publication
```

Advisory AI review 如保留，只是提示，不具有 publication authority。

## 12. Dayloom Patch

Patch 是一次 World mutation 的正式增量记录。

Patch 不保存 textual hunk，而记录 path 对应 blob 的前后状态：

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

`init` 的 `baseCommitId` 为 `null`。

`settle / abandon` 没有 Draft，因此 `draftHash` 应允许为 `null` 或省略；精确 schema 后续冻结。

### 12.1 为什么 Patch 不包含 targetCommitId

Patch 在 publish 之前就必须可以完整生成，`--dry-run` 也需要得到同一份 mutation 描述。

因此 Patch 不应依赖尚未产生的 target commit，也不重复承担 commit authority。

Patch 回答：

> 这次相对于 base 改了什么？

Commit / Tree 回答：

> 新版本完整是什么？

Operation 回答：

> 这次是什么类型的操作，它产生了哪个 Patch 和哪个 Commit？

### 12.2 Patch 如何生成

比较：

```text
pinned base tree: path -> blob hash
Workspace:        path -> blob hash
```

所有不同路径生成 change。无需第三方 diff 算法。

新的 Workspace 内容在 publication 时安装为 Archive immutable blobs；Patch 只保存 hash 引用，不重复保存 bytes。

### 12.3 Patch 是所有 mutation 的统一记录

以下命令成功产生新 commit 时都必须有 Patch：

```text
init
plan
play
revise
settle
abandon
```

因此 Archive 历史中每个 mutation commit 都能回答“这次具体改了什么”。

## 13. Patch 与 Archive 的职责关系

避免 Patch、operation、commit、tree 重复成为 authority。

推荐关系：

```text
current.json
    ↓
  commit
    ├──────────────→ tree → blobs
    │
    └→ operation
          ├→ patch
          └→ target commit
```

职责固定：

- `blob`：不可变文件内容。
- `tree`：某个完整 World 版本的 path → blob 映射。
- `commit`：版本历史节点、parent、control 与 operation 关联。
- `operation`：一次领域 mutation 的身份、类型、base、target 与 Patch 关联。
- `patch`：base 到本次 mutation 结果的增量变化。

Patch 本身不再额外存 `targetCommitId`，避免双向重复 authority。

现有 Archive V2 如需增加 `operation.patchId`，属于 Archive protocol 的小幅扩展，而不是新建第二套版本系统。

## 14. 归档与备份

成功 mutation 后长期保留：

```text
Archive commit / tree / blobs
operation
Patch
Draft snapshot（仅 Draft 驱动 mutation）
```

临时 Workspace 不保留。

Patch 的 `beforeBlobHash / afterBlobHash` 必须引用 Archive 中长期可读取的 immutable blobs。Archive 不得在仍有 commit / Patch 引用时破坏性删除这些 blobs。

这使 Patch 天然保留精确恢复所需的数据，但 v1 不提供公开 revert 行为。

## 15. v1 不提供公开 revert

当前明确冻结：

```text
没有 dayloom revert 命令
没有公开 revert API
没有公开 inverse-patch apply 接口
没有 REVERT_CONFLICT 公共错误契约
```

原因不是 Patch 无法恢复，而是 v1 先保持 CLI 与 mutation surface 最小。

Patch schema 仍保存 before / after hash，因此未来如果确有产品需要，可以在不迁移历史数据的情况下另外设计恢复能力。

当前设计文档不继续定义 revert 的具体业务语义。

## 16. 公共选项

### 16.1 `--json`

所有命令支持。只改变输出编码，不改变业务语义。

成功 mutation 示例：

```json
{
  "ok": true,
  "command": "plan",
  "baseCommitId": "commit_17",
  "commitId": "commit_18",
  "patchId": "patch_xxx",
  "changedPaths": ["days/day4/plan.json"]
}
```

### 16.2 `--check`

仅 Draft 驱动命令。

执行低成本确定性预检：

```text
read World
snapshot/read Draft
check command allowed
Draft lint
basic input validation
```

不调用 AI，不运行完整 Workspace mutation，不 publish，因此不要求 LLM 配置。

### 16.3 `--dry-run`

所有 mutation 命令可用。

Draft 驱动：

```text
Draft snapshot
→ Workspace
→ AI edit
→ validation / repair
→ diff
→ Patch preview
```

确定性命令：

```text
deterministic changes
→ validation
→ Patch preview
```

均在 publish 前停止，不归档正式 operation / commit / Patch。

Draft 驱动 `--dry-run` 需要 LLM；`settle / abandon --dry-run` 不需要。

`--check` 与 `--dry-run` 互斥。

### 16.4 `--base <commit>`

除 `init` 外 mutation 可用。用于显式 optimistic-concurrency precondition，不写入 Draft。

### 16.5 `--llm-config <file>`

Draft 驱动 AI execution 使用。

解析顺序：

```text
--llm-config <file>
        ↓
DAYLOOM_LLM_CONFIG
        ↓
missing → LLM_CONFIG_REQUIRED
```

无需 LLM：

```text
init/plan/play/revise --check
settle
abandon
status
verify
settle/abandon --dry-run
```

需要 LLM：

```text
init
plan
play
revise
init/plan/play/revise --dry-run
```

## 17. 外部 AI 配置边界

Dayloom 不自己实现 OpenAI / DeepSeek / Anthropic provider adapter。继续让 Promptpile caller config 决定具体模型连接。

典型配置：

```toml
[[llm_api]]
name = "deepseek"
model = "deepseek-chat"
base_url = "https://api.deepseek.com/v1"
api_key_env = "DEEPSEEK_API_KEY"

[promptpile]
llm_api = "deepseek"
```

职责分层：

```text
caller llm.toml
      ↓
Promptpile / React
      ↓
External LLM

Dayloom CLI
  ├─ prompt
  ├─ tools
  ├─ Workspace read/write policy
  ├─ validation
  ├─ repair policy
  └─ publish policy
```

Caller 可以决定 provider / model / base_url / key source / model parameters，但不能覆盖 Dayloom-owned runtime 字段，例如：

```text
dir
dirs
output_dir
input
continue
tools_file
after_hook
promptpile-react runtime section
```

CLI 的 AI 层只需要：

```text
edit workspace
repair workspace from validator diagnostics
```

不迁移旧：

```text
AiTurnAgent
Turn Coordinator
Conversation compression
response arbitration
Draft curation
Conversation revision
Session recovery
Change Plan authority
Candidate lifecycle
```

TUI 与 CLI 可以共享 `DAYLOOM_LLM_CONFIG`，但不共享长期 Session/runtime authority。

模型配置和 secret 不属于 World 数据，不写入 Archive。

v1 不设计多模型 orchestration，也不提供：

```text
--provider
--model
--planner-model
--converter-model
--repair-model
--reviewer-model
```

## 18. 明确不提供的绕过选项

不提供：

```text
--force
--skip-validation
--ignore-conflict
--unsafe-publish
```

调用方和 AI 可以提出修改，但不能绕过 Validator、Patch path policy 和 Archive publication authority。

## 19. 当前待继续冻结的问题

1. Patch V1 精确 JSON schema、Patch ID 与 Archive 存放位置。
2. Archive V2 中 `operation.patchId` 及 Patch / Draft snapshot 引用的精确协议改动。
3. `init / plan / play / revise` 的 command-specific write policy。
4. 完整 World Workspace 的 materialize / validate 细节，尤其 `init` 空 Workspace。
5. Draft snapshot 的 Archive 存放路径和 hash 计算规则。
6. mutation JSON 输出 schema 与 CLI exit code。
7. `DRAFT_INVALID`、`WORLD_CONFLICT`、`LLM_CONFIG_REQUIRED`、`PATCH_INVALID` 等稳定错误分类。
8. 多个 `--draft` 的精确 operation input 规则。
9. CLI 如何向薄 TUI 暴露 AI edit / repair 的低复杂度进度信息，而不重新引入 CoreEvent。
