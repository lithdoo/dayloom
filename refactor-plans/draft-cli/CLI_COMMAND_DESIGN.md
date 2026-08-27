# Dayloom Draft / CLI 重构：CLI 命令与参数设计

> 状态：讨论稿  
> 分支：`refactor/draft-cli-boundary`  
> 范围：定义新 CLI 的命令面、Draft 输入、AI 配置，以及 Draft 更新 Archive 的简化流程  
> 非目标：不冻结 Draft 格式，不引入新的 Draft DSL，不把临时 AI 工作区升级为新的领域模型

## 1. 设计原则

新 CLI 直接表达 Dayloom 的领域动作，不暴露旧 `@dayloom/core` 的 Session、Turn、Operation 等 runtime 概念。

核心约定：

1. World 是每个命令的主对象，作为唯一 positional argument。
2. 所有外部 Draft 输入都使用显式命名参数，不使用裸 `<draft-path>`。
3. Draft 继续是人类 / AI 可读写的语义文档，不升级为 mutation DSL。
4. `--draft` 支持重复；`--draft-dir` 用于传入一个完整 Draft 目录。
5. `--draft` 与 `--draft-dir` 互斥。
6. Draft 驱动的变更不再经过长期 Session / Aggregate Head / Conversation authority。
7. AI 不直接修改 Archive；CLI 为一次命令创建临时可编辑 Workspace。
8. AI 直接编辑 Workspace，程序通过 base World 与 Workspace 的差异生成 Dayloom Patch。
9. Dayloom Patch 使用 `path + beforeBlobHash + afterBlobHash` 表达变更，并由 Dayloom 自己归档和管理。
10. Programmatic Validator 是是否允许发布的硬边界；AI 不能绕过 validation。
11. Workspace 是临时实现细节，命令结束后可删除；长期对象只保留 Draft 快照、Archive 历史和 Patch 记录。
12. CLI 拥有 AI 的 prompt、工具、Workspace 权限和 validation，但不拥有具体 AI provider；外部模型继续由 Promptpile 配置层负责。

统一命令形态：

```text
dayloom <action> <world> [inputs/options]
```

例如：

```bash
dayloom plan ./world --draft ./day-plan.md --llm-config ./llm.toml
dayloom play ./world --draft-dir ./play-draft --llm-config ./llm.toml
dayloom revise ./world --draft ./a.md --draft ./b.md --llm-config ./llm.toml
dayloom settle ./world
```

## 2. v1 命令集合

第一版当前建议保持以下 8 个命令：

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

- `init / plan / play / revise`：Draft 驱动的领域变更命令。
- `settle / abandon`：不依赖 Draft 的确定性领域变更命令。
- `status / verify`：只读命令。

不引入旧 runtime 命令：

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
```

`revert` 是否作为 v1 公共命令暂未冻结，但 Patch 数据结构必须从第一版开始支持安全反向还原。

## 3. Draft 输入参数

### 3.1 `--draft <file>`

用于指定一个 Draft 文档：

```bash
dayloom plan ./world --draft ./day-plan.md
```

允许重复：

```bash
dayloom revise ./world \
  --draft ./character.md \
  --draft ./location.md \
  --draft ./story.md
```

多个 `--draft` 的顺序必须保持，不得排序或转为无序集合。

### 3.2 `--draft-dir <dir>`

用于指定一个完整 Draft 根目录。

例如 Play Draft 可以保持既有目录结构：

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

CLI 根据当前 command 对应的既有 Draft 约定读取目录；第一版不额外引入 `draft.json`、`manifest.yaml` 或其他 Draft runtime manifest。

### 3.3 互斥规则

合法：

```bash
dayloom revise ./world --draft ./a.md --draft ./b.md
```

```bash
dayloom play ./world --draft-dir ./play-draft
```

非法：

```bash
dayloom play ./world \
  --draft ./play.md \
  --draft-dir ./play-draft
```

即：

```text
--draft <file>... | --draft-dir <dir>
```

二者互斥。

## 4. Draft 驱动命令

### 4.1 `init`

```text
dayloom init <world>
        (--draft <file>... | --draft-dir <dir>)
        [--llm-config <file>]
        [--check | --dry-run]
        [--json]
```

根据 Init Draft 创建新的 Dayloom World。

`world` 已经是有效 Dayloom World 时应失败，不覆盖现有 World。

### 4.2 `plan`

```text
dayloom plan <world>
        (--draft <file>... | --draft-dir <dir>)
        [--base <commit>]
        [--llm-config <file>]
        [--check | --dry-run]
        [--json]
```

根据 Planning Draft 更新当前 World。

`targetDay`、constraints、beats 等语义来自 Draft 和当前 World，不重复暴露为 CLI 参数。

### 4.3 `play`

```text
dayloom play <world>
        (--draft <file>... | --draft-dir <dir>)
        [--base <commit>]
        [--llm-config <file>]
        [--check | --dry-run]
        [--json]
```

根据 Play Draft 更新当前 Day / World。

不提供 `--day`、`--event`、`--beat`、`--end-day` 等重复领域语义参数。

### 4.4 `revise`

```text
dayloom revise <world>
        (--draft <file>... | --draft-dir <dir>)
        [--base <commit>]
        [--llm-config <file>]
        [--check | --dry-run]
        [--json]
```

根据 Revise Draft 修改当前 Published World 中允许修改的内容。

不提供 `--path`、`--replace`、`--delete` 等 mutation DSL 参数。

## 5. 不依赖 Draft 的领域命令

### 5.1 `settle`

```text
dayloom settle <world>
        [--base <commit>]
        [--dry-run]
        [--json]
```

对当前 Day 执行确定性结算。

### 5.2 `abandon`

```text
dayloom abandon <world>
        [--base <commit>]
        [--dry-run]
        [--json]
```

放弃当前生命周期中允许 abandon 的 Day 状态。

## 6. 只读命令

### 6.1 `status`

```text
dayloom status <world>
        [--json]
```

读取当前 World 的公开状态和当前允许的领域动作。

JSON 输出可供新 TUI 使用，例如：

```json
{
  "worldId": "world_xxx",
  "revision": 18,
  "commitId": "commit_xxx",
  "day": 4,
  "phase": "planned",
  "availableCommands": ["play", "abandon", "revise"]
}
```

新 TUI 不重新实现 lifecycle capability 判断，而是消费 CLI / 领域层结果。

### 6.2 `verify`

```text
dayloom verify <world>
        [--json]
```

只读校验 Archive 和 World 的完整性，包括：

- Manifest
- `current.json`
- commit / tree / blobs
- hash 与引用关系
- World Profile
- 领域引用闭合
- Archive invariants
- 已归档 Patch 引用的 blob 是否存在

该命令不调用 AI，不改变 World。

## 7. 新的 Draft → Archive 流程

新的核心流程不再使用 Candidate / Change Plan 作为必需的长期架构概念。

```text
Draft
  ↓
固定本次 Draft 输入快照
  ↓
读取并 pin 当前 Archive base
  ↓
materialize 可编辑 Workspace
  ↓
AI 根据 Draft 直接编辑 Workspace
  ↓
Programmatic Validation
  ↓
失败时允许有限次数 AI Repair
  ↓
base / Workspace diff
  ↓
生成 Dayloom Patch
  ↓
再次检查当前 Archive 仍等于 pinned base
  ↓
通过现有 Archive publication 原语发布
  ↓
归档 Draft 快照 + Patch
  ↓
删除临时 Workspace
```

### 7.1 固定 Draft 输入快照

CLI 启动后应复制本次 `--draft` / `--draft-dir` 的 exact bytes 到 operation-local 临时目录，并计算输入 hash。

后续 AI 和 validation 只读取这个固定快照，不继续读取用户原始 Draft 路径。

这样用户在命令执行期间继续编辑原文件，也不会改变正在运行的 operation。

CLI 不修改、不移动、不删除用户提供的 Draft。

### 7.2 Pin 当前 Archive base

命令启动时读取当前 Published World，并固定：

```text
revision
commitId
rootTreeHash
```

如果提供 `--base <commit>`，启动时必须与其严格一致。

发布前再次检查当前 Archive；如果已经变化，则返回：

```text
WORLD_CONFLICT
```

不自动 merge，不 fuzzy apply。

## 8. Workspace

Workspace 是本次命令的临时可编辑 World 视图，不是新的 Archive，也不是长期领域对象。

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

Workspace 只包含 AI 理解和修改 World 所需的公开文档，不复制 Archive 协议层对象，例如：

```text
objects/
commits/
trees/
operations/
current.json
```

### 8.1 写权限

不同命令拥有不同可写范围。

Dayloom 应同时使用两层保护：

1. AI 文件工具只允许写 command-specific 路径。
2. 最终生成 Patch 后，再由程序检查所有 changed path 是否允许该 command 修改。

即使 AI 绕过第一层或产生异常输出，也不能越过第二层进入 Archive。

### 8.2 Workspace 生命周期

Workspace 只服务一次 CLI invocation：

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

成功或失败后都可以删除，不需要恢复、Session Head、activeSession 或 pending sync。

## 9. Validation 与 Repair

AI 修改 Workspace 后，程序直接验证修改后的 World 结果。

基本循环：

```text
AI edit
  ↓
validate
  ├─ ok → diff
  └─ invalid
       ↓
     AI repair
       ↓
     validate again
```

Repair 必须有固定最大轮数；如果 diagnostics 不再变化，可以提前停止。

Validator 是唯一硬 authority：

```text
AI 认为正确 ≠ 可以发布
Validator 通过 = 才可以生成可发布 Patch
```

第一版不要求保留独立 Change Plan / Assignment / Candidate lifecycle。

如果未来实际数据证明 AI 经常修改超出预期范围，再考虑增加可选 planning stage，而不是把它预先冻结为公共协议。

Advisory AI review 也不是发布所必需的 authority；如保留，只能作为提示，不能替代程序 validation。

## 10. Dayloom Patch

Patch 是一次 World 修改的正式记录，由 Dayloom 自己生成和归档，不依赖 Git patch 或第三方 textual patch 格式。

Patch 的核心不是文本 hunk，而是 Archive blob 的前后关系。

最小示例：

```json
{
  "schemaVersion": 1,
  "baseCommitId": "commit_17",
  "targetCommitId": "commit_18",
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

三类变更统一表示为：

```text
修改： A    → B
新增： null → B
删除： A    → null
```

### 10.1 Patch 如何生成

CLI 比较 pinned base tree 与最终 Workspace：

```text
base path -> blob hash
workspace path -> blob hash
```

对于 hash 不同、只存在于一边的 path，生成 Patch change。

无需引入复杂文本 diff 算法。

### 10.2 Blob 内容不重复存进 Patch

Patch 只记录 hash 引用；真正文件内容继续保存在 Archive immutable blob store。

因此 Patch 不重复保存大段文件 bytes。

发布新内容时，新的 Workspace 文件先安装为 immutable blob，再由 Patch / tree / commit 引用。

### 10.3 Patch 是长期记录

每次成功 mutation 应保存对应 Patch，并关联：

```text
command
baseCommitId
targetCommitId
Draft snapshot/hash
changes
```

Patch 同时承担：

```text
修改记录
审计入口
还原依据
```

Draft 的 exact input snapshot 也应与这次 operation / Patch 一起归档，但用户原始 Draft 文件保持不变。

## 11. Patch Revert / 还原

Blob-hash Patch 天然可以生成 inverse patch。

例如：

```text
a.md     A    → B
b.yaml   C    → null
c.json   null → D
```

反向就是：

```text
a.md     B    → A
b.yaml   null → C
c.json   D    → null
```

但不能无条件还原。

应用 inverse patch 前，每个 path 必须严格检查当前 blob hash 仍然等于原 Patch 的 `afterBlobHash`。

例如原修改：

```text
A → B
```

当前已经因为后续 commit 变成：

```text
C
```

则不能直接改回 A，应返回类似：

```text
REVERT_CONFLICT
```

这样不会覆盖后续修改。

普通还原应生成一个新的 Archive commit，而不是把 `current.json` 指针直接倒回历史 commit。历史保持 append-only：

```text
commit17
  ↓
commit18
  ↓
commit19
  ↓ revert
commit20
```

是否在 v1 暴露 `dayloom revert` 命令后续单独冻结，但 Patch schema 和 Archive 保留策略必须从第一版支持这一能力。

## 12. 公共选项

### 12.1 `--json`

所有命令支持。

`--json` 只改变输出编码，不改变业务语义。

成功结果可以包含：

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

### 12.2 `--check`

适用于 Draft 驱动命令。

只执行低成本、确定性的输入预检：

```text
read World
read Draft
check command allowed
Draft lint
basic structural validation
```

不调用 AI，不创建完整 AI Workspace，不 publish，因此不要求 LLM 配置。

### 12.3 `--dry-run`

适用于所有 mutation 命令。

Draft 驱动命令执行完整流程直到 Patch：

```text
Draft snapshot
  → materialize Workspace
  → AI edit
  → validation
  → bounded repair
  → diff
  → Patch
```

但不 publish。

Draft 驱动命令的 `--dry-run` 仍需要 LLM 配置。

`settle / abandon --dry-run` 执行确定性变更、validation 和 Patch 生成，但不 publish，不需要 LLM。

`--check` 与 `--dry-run` 互斥。

### 12.4 `--base <commit>`

适用于除 `init` 外的 mutation 命令。

要求命令启动时当前 World 必须严格匹配指定 commit，否则返回 World conflict。

未提供时，以命令启动时读取到的 current World 作为 pinned base，并在 publish 前再次检查。

### 12.5 `--llm-config <file>`

适用于需要 AI 的 Draft 驱动 execution。

配置解析优先级：

```text
--llm-config <file>
        ↓
DAYLOOM_LLM_CONFIG
        ↓
missing
```

需要 AI 但没有配置时返回稳定错误，例如：

```text
LLM_CONFIG_REQUIRED
```

不需要 LLM：

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

## 13. 外部 AI 模型配置边界

### 13.1 Provider 继续交给 Promptpile

Dayloom 不自己实现 OpenAI、DeepSeek、Anthropic 等 provider adapter。

调用方通过 Promptpile caller configuration 指定模型：

```toml
[[llm_api]]
name = "deepseek"
model = "deepseek-chat"
base_url = "https://api.deepseek.com/v1"
api_key_env = "DEEPSEEK_API_KEY"

[promptpile]
llm_api = "deepseek"
```

结构保持：

```text
Dayloom CLI
    │
    │ caller-owned llm.toml
    ▼
Promptpile / Promptpile React
    │
    ▼
External LLM API
```

### 13.2 配置权与执行权分离

调用方可以决定：

```text
provider / llm_api
model
base_url
API key 来源
temperature 等模型参数
```

Dayloom 决定：

```text
AI 能读取哪些 Draft / World 文件
AI 能写哪些 Workspace 路径
AI 可以调用哪些工具
operation prompt
after hook
validation policy
repair 次数
publish policy
```

即：

> CLI 决定 AI 做什么以及允许做什么；Promptpile 决定如何调用具体外部模型。

### 13.3 Caller config 必须受约束

Caller-owned Promptpile 配置不得覆盖 Dayloom 自己拥有的 runtime 字段，例如：

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

CLI 为每个 AI operation 生成 operation-local Promptpile / ReAct config。

### 13.4 CLI 的 AI 层进一步简化

旧 Core 有 Conversation AI 和复杂 Submission AI orchestration。

新架构拆成：

```text
New TUI
  Conversation AI
      ↓
    Draft
      ↓
Dayloom CLI
  Workspace Editing AI
      ↓
    Patch
      ↓
   Archive
```

CLI 不迁移：

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

CLI 的必要 AI 能力可以缩到：

```text
edit workspace
repair workspace from validator diagnostics
```

如果以后保留 advisory review，也只是可选 AI operation。

内部 AI boundary 可以保持很薄：

```text
src/
  ai/
    config.ts
    boundaries.ts
    react.ts
    workspace-editor.ts
```

### 13.5 TUI 与 CLI 可以共享同一份模型配置

推荐：

```bash
export DAYLOOM_LLM_CONFIG=~/.config/dayloom/llm.toml
```

TUI 使用它生成 / 修改 Draft，CLI 继承同一环境变量执行 Workspace 修改和 Archive 更新。

二者共享模型配置，但不共享长期 AI runtime 或 Session authority。

### 13.6 模型配置不是 World 数据

以下内容不得写入 World 或作为 Archive authority：

```text
llm.toml
API key
provider credential
环境变量值
```

模型选择属于 execution environment，不属于 World domain state。

### 13.7 暂不设计多模型 orchestration

v1 不新增：

```text
--planner-model
--converter-model
--repair-model
--reviewer-model
```

也不新增 Dayloom-specific 多模型 routing。

## 14. 明确不提供的绕过选项

不提供：

```text
--force
--skip-validation
--ignore-conflict
--unsafe-publish
```

调用方和 AI 可以提出修改，但不能绕过 programmatic validation、Patch path policy 与 Archive publication authority。

## 15. v1 CLI Grammar 汇总

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

说明：`--llm-config` 虽列在 Draft 驱动命令 grammar 中，但 `--check` 模式不会读取或要求它。

## 16. 当前待继续设计的问题

1. Patch V1 的精确 JSON schema、ID 和 Archive 存放位置。
2. Patch 与现有 Archive `operation / commit / tree / blob` 的引用关系。
3. Workspace 对 `init / plan / play / revise` 各自 materialize 哪些文件、哪些路径可写。
4. Programmatic Validator 是否直接验证完整 materialized World，还是验证 Patch 应用后的虚拟 World。
5. Draft snapshot 的 Archive 存放形式与 Patch 的关联方式。
6. 是否把 `revert` 纳入 v1 命令集合，以及其 JSON / exit-code 契约。
7. 每个命令的稳定 JSON 输出 schema与 CLI exit code 体系。
8. `DRAFT_INVALID`、`WORLD_CONFLICT`、`LLM_CONFIG_REQUIRED`、`PATCH_INVALID`、`REVERT_CONFLICT` 等稳定错误分类。
9. 多个 `--draft` 如何形成 operation input，以及 command-specific 数量限制。
10. CLI 如何向新 TUI 暴露长时间 AI edit / repair 进度，而不重新引入旧 CoreEvent 模型。
