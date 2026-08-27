# Dayloom Draft / CLI 重构：CLI 命令与参数设计

> 状态：讨论稿  
> 分支：`refactor/draft-cli-boundary`  
> 范围：定义新 CLI 的命令面、参数形式与输入边界  
> 非目标：不冻结 Draft 格式，不引入新的 Draft DSL，不描述具体内部实现

## 1. 设计原则

新 CLI 应直接表达 Dayloom 的领域动作，而不是暴露旧 `@dayloom/core` 的 Session、Turn、Operation 等 runtime 概念。

核心约定：

1. World 是每个命令的主对象，作为唯一 positional argument。
2. 所有外部文档输入都使用显式命名参数，不使用裸 `<draft-path>`。
3. Draft 是人类 / AI 可读写的语义文档，不升级为机器领域语言或 mutation DSL。
4. `--draft` 支持重复，以便未来显式传入多个文档。
5. `--draft-dir` 用于传入一个完整 Draft 目录。
6. `--draft` 与 `--draft-dir` 互斥，避免输入集合含义不明确。
7. CLI 不暴露 Planner、Converter、Repair、Reviewer 等内部执行阶段参数。
8. 不提供 `--force`、`--skip-validation`、`--ignore-conflict` 一类绕过领域约束的选项。

统一命令形态：

```text
dayloom <action> <world> [inputs/options]
```

例如：

```bash
dayloom plan ./world --draft ./day-plan.md
dayloom play ./world --draft-dir ./play-draft
dayloom revise ./world --draft ./a.md --draft ./b.md
dayloom settle ./world
```

## 2. v1 命令集合

第一版建议只包含以下 8 个命令：

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

不引入：

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

这些要么属于旧 runtime 模型，要么属于 submission pipeline 内部阶段，不应成为新 CLI 的公共领域接口。

## 3. Draft 输入参数

### 3.1 `--draft <file>`

用于指定一个 Draft 文档。

```bash
dayloom plan ./world --draft ./day-plan.md
```

该参数允许重复：

```bash
dayloom revise ./world \
  --draft ./character.md \
  --draft ./location.md \
  --draft ./story.md
```

多个 `--draft` 的顺序必须保持，不得排序或转为无序集合。调用方显式给出的顺序可以作为 submission conversion 的上下文顺序。

### 3.2 `--draft-dir <dir>`

用于指定一个完整 Draft 根目录。

例如现有 Play Draft 天然可能是目录结构：

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

CLI 根据当前 command 对应的既有 Draft 约定读取该目录；第一版不额外引入 `draft.json`、`manifest.yaml` 或其他 Draft runtime manifest。

### 3.3 互斥规则

以下合法：

```bash
dayloom plan ./world --draft ./plan.md
```

```bash
dayloom revise ./world --draft ./a.md --draft ./b.md
```

```bash
dayloom play ./world --draft-dir ./play-draft
```

以下非法：

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
        [--check | --dry-run]
        [--json]
```

语义：根据 Init Draft 创建一个新的 Dayloom World。

`world` 已经是有效 Dayloom World 时应失败，不覆盖现有 World。

不暴露 `--world-id`、`--revision`、`--session-id` 等参数。

### 4.2 `plan`

```text
dayloom plan <world>
        (--draft <file>... | --draft-dir <dir>)
        [--base <commit>]
        [--check | --dry-run]
        [--json]
```

语义：将 Planning Draft 应用到当前 World。

`targetDay`、constraints、beats 等领域语义来自 Draft 和当前 World，而不是重复暴露为 CLI 参数。

不提供 `--day`、`--beat` 等重复 authority 参数。

### 4.3 `play`

```text
dayloom play <world>
        (--draft <file>... | --draft-dir <dir>)
        [--base <commit>]
        [--check | --dry-run]
        [--json]
```

语义：将 Play Draft 中已经形成的事件和结果应用到当前 World。

不提供 `--day`、`--event`、`--beat`、`--end-day` 等参数；这些属于 Draft 的创作语义。

### 4.4 `revise`

```text
dayloom revise <world>
        (--draft <file>... | --draft-dir <dir>)
        [--base <commit>]
        [--check | --dry-run]
        [--json]
```

语义：根据 Revise Draft 修改当前 Published World 中允许修改的内容。

不提供 `--path`、`--replace`、`--delete` 等 mutation DSL 参数。实际 mutation scope 仍由 submission pipeline 与领域 policy 决定。

## 5. 不依赖 Draft 的领域命令

### 5.1 `settle`

```text
dayloom settle <world>
        [--base <commit>]
        [--dry-run]
        [--json]
```

语义：对当前 Day 执行确定性结算。

Day 和生命周期状态由当前 World 决定，不提供 `--day` 参数。

### 5.2 `abandon`

```text
dayloom abandon <world>
        [--base <commit>]
        [--dry-run]
        [--json]
```

语义：放弃当前生命周期中允许 abandon 的 Day 状态。

同样不引入 Session 层概念。

## 6. 只读命令

### 6.1 `status`

```text
dayloom status <world>
        [--json]
```

语义：读取当前 World 的公开状态和当前允许的领域动作。

人类输出示例：

```text
World: The Old House
Revision: 18
Day: 4
Phase: planned

Available actions:
  play
  abandon
  revise
```

JSON 输出可供新 TUI 使用：

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

新 TUI 不应重新实现生命周期 capability 判断，而应消费 CLI / 领域层公开结果。

### 6.2 `verify`

```text
dayloom verify <world>
        [--json]
```

语义：只读校验 Archive 和 World 的完整性。

检查范围可包括：

- Manifest
- `current.json`
- commit / tree / blobs
- hash 与引用关系
- World Profile
- 领域引用闭合
- Archive invariants

该命令不调用 AI，不改变 World。

## 7. 公共选项

### 7.1 `--json`

所有命令支持。

`--json` 只改变输出编码，不改变业务语义。

成功结果示例：

```json
{
  "ok": true,
  "command": "plan",
  "baseCommitId": "commit_17",
  "commitId": "commit_18",
  "changedPaths": ["days/day4/plan.json"]
}
```

失败结果示例：

```json
{
  "ok": false,
  "code": "DRAFT_INVALID",
  "diagnostics": []
}
```

### 7.2 `--check`

适用于 Draft 驱动命令。

仅执行确定性且低成本的输入预检，例如：

```text
read World
read Draft
check command allowed
Draft lint
basic structural validation
```

不调用 AI，不生成 Candidate，不 publish。

### 7.3 `--dry-run`

适用于所有 mutation 命令。

对于 Draft 驱动命令，执行完整 submission pipeline：

```text
lint
  -> Change Plan
  -> assignment
  -> AI conversion
  -> candidate
  -> validation
  -> bounded repair
  -> advisory review
  -> diff
```

但在 publish 前停止。

对于 `settle / abandon`，执行完整确定性 candidate / validation / diff，但不 publish。

`--check` 与 `--dry-run` 互斥。

### 7.4 `--base <commit>`

适用于除 `init` 外的 mutation 命令。

语义：要求命令启动时当前 World 必须严格匹配指定 commit；否则返回 World conflict。

例如：

```bash
dayloom plan ./world --draft ./plan.md --base commit_17
```

该参数可让 TUI 将“生成 Draft 时看到的 World”与“提交时的当前 World”绑定，而无需向 Draft 文档本身写入 base metadata。

未提供 `--base` 时，以命令启动时读取到的 current World 作为本次 operation 的 pinned base，并在 publish 前再次检查。

## 8. 配置边界

CLI 不应在每个领域命令上暴露内部 AI pipeline 参数，例如：

```text
--planner-model
--converter-model
--repair-model
--review-model
--max-repair
```

这些属于 Dayloom 配置，而不是领域命令参数。

未来如有需要，可以提供统一：

```text
--config <file>
```

例如：

```bash
dayloom plan ./world --draft ./plan.md --config ./dayloom.json
```

## 9. 明确不提供的绕过选项

不提供：

```text
--force
--skip-validation
--ignore-conflict
--unsafe-publish
```

原则保持不变：调用方和 AI 可以提出变更，但不能绕过程序化领域校验与 Archive publication authority。

## 10. v1 CLI Grammar 汇总

```text
dayloom init <world>
        (--draft <file>... | --draft-dir <dir>)
        [--check | --dry-run]
        [--json]

dayloom plan <world>
        (--draft <file>... | --draft-dir <dir>)
        [--base <commit>]
        [--check | --dry-run]
        [--json]

dayloom play <world>
        (--draft <file>... | --draft-dir <dir>)
        [--base <commit>]
        [--check | --dry-run]
        [--json]

dayloom revise <world>
        (--draft <file>... | --draft-dir <dir>)
        [--base <commit>]
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

## 11. 当前待继续设计的问题

本文件只定义命令面。下一步需要单独设计：

1. 每个命令的稳定 JSON 输出 schema。
2. CLI exit code 体系。
3. `DRAFT_INVALID`、`WORLD_CONFLICT`、AI conversion failure、candidate validation failure 等错误分类。
4. 多个 `--draft` 如何形成 submission input，是否允许 command-specific 数量限制。
5. `--draft-dir` 对每种 Draft kind 的精确加载规则。
6. CLI 如何向新 TUI 暴露长时间 submission 的进度，而不重新引入旧 CoreEvent 模型。
