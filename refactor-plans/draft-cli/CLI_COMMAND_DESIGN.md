# Dayloom Draft / CLI 重构：CLI 命令与参数设计

> 状态：讨论稿  
> 分支：`refactor/draft-cli-boundary`  
> 范围：定义新 CLI 的命令面、参数形式、Draft 输入边界与外部 AI 配置边界  
> 非目标：不冻结 Draft 格式，不引入新的 Draft DSL，不描述完整内部实现

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
9. CLI 拥有 AI operation 的业务权限、prompt、工具、workspace 与 validation，但不拥有具体 AI provider 适配；外部模型调用继续交给 Promptpile 配置层。

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
        [--llm-config <file>]
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
        [--llm-config <file>]
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
        [--llm-config <file>]
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
        [--llm-config <file>]
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

不调用 AI，不生成 Candidate，不 publish，因此不要求存在 LLM 配置。

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

但在 publish 前停止。因为会执行 AI submission pipeline，所以 Draft 驱动命令的 `--dry-run` 仍需要 LLM 配置。

对于 `settle / abandon`，执行完整确定性 candidate / validation / diff，但不 publish，不需要 LLM 配置。

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

### 7.5 `--llm-config <file>`

适用于需要 AI 的 Draft 驱动 execution。

例如：

```bash
dayloom plan ./world \
  --draft ./plan.md \
  --llm-config ./llm.toml
```

配置解析优先级：

```text
--llm-config <file>
        ↓
DAYLOOM_LLM_CONFIG
        ↓
missing
```

如果当前 execution 需要 AI，但最终无法解析到配置，则返回稳定错误，例如：

```text
LLM_CONFIG_REQUIRED
```

以下 execution 不需要 LLM 配置：

```text
init/plan/play/revise --check
settle
abandon
status
verify
settle/abandon --dry-run
```

以下 execution 需要 LLM 配置：

```text
init
plan
play
revise
init/plan/play/revise --dry-run
```

## 8. 外部 AI 模型配置边界

### 8.1 保留旧实现中 provider/configuration 的分层

旧实现中，Dayloom 自己不实现 OpenAI、DeepSeek、Anthropic 等 provider adapter。调用方通过 Promptpile caller configuration 指定实际外部模型，Promptpile 负责连接模型 API。

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

新 CLI 应继续这一模型：

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

Dayloom 不新增自己的 provider interface，也不在 CLI 中实现 provider-specific client。

### 8.2 配置权与执行权分离

调用方可以决定：

```text
provider / llm_api
model
base_url
API key 来源
temperature 等模型参数
```

但调用方不能决定：

```text
AI 可以访问哪些 World / Draft / Candidate 文件
AI 可以调用哪些工具
Dayloom operation prompt
after hook
workspace 路径
candidate write scope
validation 与 publish policy
```

这些仍由 Dayloom CLI 拥有。

即：

> CLI 决定 AI 做什么以及允许做什么；Promptpile 决定如何调用具体外部模型；调用方只提供模型配置。

### 8.3 caller-owned Promptpile 配置必须受约束

新 CLI 应继续沿用旧实现的安全原则：caller-owned 配置允许指定模型相关字段，但不得覆盖 Dayloom 自己拥有的 runtime 字段。

至少应禁止调用方控制类似：

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

CLI 在每个 AI operation 内生成 operation-local Promptpile / ReAct config，将 caller 的模型配置与 Dayloom 自己控制的 prompt、tools、after-hook、workspace 合并。

### 8.4 CLI 只保留 Submission AI

旧 Core 同时拥有两类 AI：

```text
Conversation AI
  -> response
  -> arbitration
  -> Draft curation

Submission AI
  -> planner
  -> converter
  -> repair
  -> reviewer
```

新架构中职责拆分为：

```text
New TUI
  owns Conversation AI
        ↓
      Draft
        ↓
Dayloom CLI
  owns Submission AI
        ↓
      Archive
```

因此新 CLI 不迁移以下旧 runtime 能力：

```text
AiTurnAgent
Turn Coordinator
Conversation compression
response arbitration
Draft curation
Conversation revision
Session recovery
```

CLI 只保留 submission 所需的 AI 能力：

```text
Planner
Converter
bounded Repair
Reviewer
```

### 8.5 AI 运行时内部结构保持薄层

新 CLI 内部可以保留一个很薄的 AI boundary，例如：

```text
src/
  ai/
    config.ts
    boundaries.ts
    react.ts
    submission/
      planner.ts
      converter.ts
      reviewer.ts
```

职责：

- `config.ts`：读取 caller LLM config、禁止危险字段、生成 operation-local config。
- `boundaries.ts`：解析 packaged Promptpile / Promptpile React / MCP / filesystem runtime 边界。
- `react.ts`：启动 Promptpile React、验证其结构化 process output、返回最终结果。
- `submission/*`：实现 Planner / Converter / Reviewer 等 Dayloom-specific AI operation。

不重新创建 CoreEvent、SessionEvent 或长期 AI runtime。

### 8.6 TUI 与 CLI 可以共享同一份模型配置

推荐使用：

```bash
export DAYLOOM_LLM_CONFIG=~/.config/dayloom/llm.toml
```

这样新 TUI 可以使用它生成 / 修改 Draft，而 CLI 在被 TUI 调用时继承相同环境变量并执行 Draft submission。

逻辑上：

```text
                  llm.toml
                 /        \
                /          \
               ▼            ▼
           New TUI        Dayloom CLI
              │               │
       Conversation AI   Submission AI
              │               │
              ▼               ▼
            Draft --------> Archive
```

二者共享模型配置，但不共享长期 AI runtime 或 Session authority。

### 8.7 模型配置不是 World 数据

以下内容不得写入 World 或作为 Archive authority 的组成部分：

```text
llm.toml
API key
provider credential
base_url secret
环境变量值
```

模型选择属于 execution environment，不属于 World domain state。

如果未来 Audit 需要最低限度的 AI 可追溯信息，可以考虑只记录非敏感标识，例如 runtime 与 model name；不得为了 reproducibility 保存 secret 或完整 caller config。

### 8.8 暂不设计多模型 orchestration

虽然 Promptpile configuration 可以支持多个模型配置，但 v1 不新增：

```text
--planner-model
--converter-model
--repair-model
--reviewer-model
```

也不新增 Dayloom-specific 多模型 routing 配置。

默认由 caller Promptpile config 选择当前模型。只有未来出现明确、稳定的不同 operation 需要不同模型的产品需求时，再单独扩展。

## 9. 配置边界

除 `--llm-config` 外，CLI 不应在每个领域命令上暴露内部 AI pipeline 参数，例如：

```text
--provider
--model
--base-url
--api-key
--planner-model
--converter-model
--repair-model
--reviewer-model
--max-repair
```

这些要么属于 Promptpile caller configuration，要么属于 Dayloom 内部策略，不属于领域命令参数。

未来如有 Dayloom 自身的非 LLM execution 配置需要，可以另行讨论统一：

```text
--config <file>
```

但不得与 `--llm-config` 混为同一个不透明配置入口。

## 10. 明确不提供的绕过选项

不提供：

```text
--force
--skip-validation
--ignore-conflict
--unsafe-publish
```

原则保持不变：调用方和 AI 可以提出变更，但不能绕过程序化领域校验与 Archive publication authority。

## 11. v1 CLI Grammar 汇总

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

## 12. 当前待继续设计的问题

本文件只定义命令面与模型配置边界。下一步需要单独设计：

1. 每个命令的稳定 JSON 输出 schema。
2. CLI exit code 体系。
3. `DRAFT_INVALID`、`WORLD_CONFLICT`、`LLM_CONFIG_REQUIRED`、AI conversion failure、candidate validation failure 等错误分类。
4. 多个 `--draft` 如何形成 submission input，是否允许 command-specific 数量限制。
5. `--draft-dir` 对每种 Draft kind 的精确加载规则。
6. CLI 如何向新 TUI 暴露长时间 submission 的进度，而不重新引入旧 CoreEvent 模型。
7. 新 TUI 如何消费同一份 Promptpile caller config，同时保持 Conversation AI 与 CLI Submission AI 完全解耦。
