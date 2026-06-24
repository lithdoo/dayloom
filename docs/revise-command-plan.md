# `day-loom revise` 落地方案

## 1. 目标

新增一个命令，让用户通过 AI 阅读现有 World 存档，并提出受控的设定修改：

```bash
day-loom revise -d <world_root>
```

设定规模较小时，AI 可以直接读取必要的索引与文件。设定规模扩大后，AI 通过 MCP 文件工具按需探索，不需要把整个 World 放进一次上下文窗口。

首版只修改低频世界设定，不修改按天历史与运行指针。

---

## 2. 核心边界

### 2.1 AI 可以做什么

- 列出目录和文件。
- 搜索文件路径。
- 按需读取设定文件。
- 根据用户需求生成结构化修改提案。

### 2.2 AI 不可以直接做什么

- 直接写入 World 存档。
- 修改 `days/**` 历史。
- 修改 `logs/**`。
- 修改 `current.yaml`。
- 修改 `manifest.yaml` 中的 `id`、`protocol_version`、`created_at`。

最终写盘必须由 Day Loom 自己完成：

```text
AI 探索和提案
  -> Day Loom 校验
  -> 展示 diff
  -> 用户确认
  -> Day Loom 备份并写盘
  -> Day Loom 追加状态变更日志
```

---

## 3. 复用现有组件

仓库已经有可直接复用的 MCP 与 ReAct 基础设施。

| 组件 | 位置 | 用途 |
|------|------|------|
| `promptpile` | `promptpile/packages/promptpile/` | 调用模型，维护消息目录 |
| `promptpile-mcp` | `promptpile/packages/promptpile-mcp/` | 启动 MCP 网关、导出工具定义、执行 MCP 调用 |
| `promptpile-react` | `promptpile/packages/promptpile-react/` | 驱动 AI 多轮探索：Thought -> Observe -> Check -> Final |
| 官方 filesystem MCP | `@modelcontextprotocol/server-filesystem` | 限定目录内的文件列表、路径搜索和文本读取 |
| `@agent-tool-lite/search` | `agent-lite-tools/search/` | 后续全文 `Grep` 扩展的现成实现 |

首版不开发新的 MCP Server，也不让 Day Loom 自己实现 ReAct 循环。

官方 filesystem MCP 已提供首版所需只读工具：

```text
list_directory
directory_tree
search_files
read_text_file
read_multiple_files
get_file_info
list_allowed_directories
```

注意：`search_files` 是文件路径模式搜索，不是文件正文全文搜索。首版依赖索引文件和目录结构；正文全文搜索放到后续阶段。

---

## 4. 用户体验

### 4.1 基本命令

```bash
day-loom revise -d ./world-interactive
```

建议支持：

```bash
day-loom revise -d ./world-interactive --dry-run
day-loom revise -d ./world-interactive --yes
day-loom revise -d ./world-interactive --keep-session
day-loom revise -d ./world-interactive --mcp-base-url http://127.0.0.1:8765
```

| 参数 | 作用 |
|------|------|
| `-d, --dir` | World 根目录 |
| `--dry-run` | 生成并展示提案，不写盘 |
| `--yes` | 跳过终端确认，用于自动化 |
| `--keep-session` | 保留本次消息目录，便于调试 |
| `--mcp-base-url` | 已运行的 `promptpile-mcp launch` 网关地址 |

### 4.2 交互示例

```text
$ day-loom revise -d ./world-interactive

Describe the setting change:
> 新增一位文学社成员林雨。她和主角认识，但还不熟。

AI is reading the current World...

Proposed revision:
  create characters/char_lin_yu/profile.md
  create characters/char_lin_yu/relationships.md
  create characters/char_lin_yu/meta.yaml
  update characters/index.yaml

Apply this revision? (Y/N)
```

---

## 5. 总体调用链

```text
day-loom revise
  |
  |-- 校验 World 已初始化
  |-- 校验 MCP 网关可访问
  |-- 创建临时 revise session
  |-- 写入 World 摘要、用户请求和 revise 提示词
  |-- 从网关 export-tools 到 session/.tools.toml
  |-- 调用 promptpile-react
  |     |
  |     |-- AI 使用只读 filesystem MCP 探索 World
  |     |-- after-hook 调用 promptpile-mcp exec-calls
  |     `-- Final 输出 revise-payload JSON
  |
  |-- 解析并校验 revise-payload
  |-- 自动投影索引文件变更
  |-- 生成 diff
  |-- 用户确认
  |-- 归档 before 快照、payload 和 diff
  |-- 写盘
  `-- 追加 logs/state_changes.jsonl
```

MCP 网关作为外部常驻进程运行。Day Loom 首版不负责自动下载、安装或启动 MCP Server，避免把依赖安装和进程生命周期塞进业务命令。

---

## 6. MCP 配置

为当前 World 启动只读用途的 filesystem MCP。官方 filesystem server 本身包含写工具，但 `revise` 导出工具后必须过滤，只保留只读工具。

示例 `mcp.toml`：

```toml
version = 1

[gateway]
port = 8765

[behavior]
failure_policy = "strict"
flat_names = false

[servers.world]
command = "npx"
args = [
  "-y",
  "@modelcontextprotocol/server-filesystem",
  "/absolute/path/to/world-interactive"
]
```

启动：

```bash
npx --prefix promptpile/packages/promptpile-mcp promptpile-mcp launch \
  --config /path/to/mcp.toml
```

Day Loom 调用 `export-tools` 后，对生成的工具列表执行 allowlist 过滤：

```text
mcp__world__list_directory
mcp__world__directory_tree
mcp__world__search_files
mcp__world__read_text_file
mcp__world__read_multiple_files
mcp__world__get_file_info
mcp__world__list_allowed_directories
```

禁止向模型暴露：

```text
write_file
edit_file
create_directory
move_file
```

执行探索前，Day Loom 还要调用 `list_allowed_directories`，确认 `-d` 指向的 World 位于 MCP allowed root 内。若网关绑定了错误目录，命令立即退出，不启动 AI 会话。

---

## 7. `revise-payload` 协议

AI 只返回领域操作，不直接返回任意文件写入操作。

```json
{
  "summary": "新增文学社成员林雨，并补充她与主角的初始关系。",
  "operations": [
    {
      "op": "replace_canon",
      "section": "style",
      "content": "# 风格\n\n轻松、克制、生活化。\n"
    },
    {
      "op": "upsert_character",
      "id": "char_lin_yu",
      "profileMd": "# 林雨\n\n## 身份\n文学社成员。\n",
      "relationshipsMd": "# Relationships\n\n## char_protagonist\n认识，但还不熟。\n",
      "meta": {
        "status": "active",
        "tags": ["literature_club"]
      }
    }
  ]
}
```

首版允许的操作：

| 操作 | 作用 |
|------|------|
| `replace_canon` | 替换 `canon/premise.md`、`rules.md`、`style.md`、`user_role.md` |
| `upsert_character` | 新增或更新人物语义设定 |
| `upsert_scene` | 新增或更新场景语义设定 |

第二阶段再考虑：

```text
archive_character
archive_scene
update_world_state
```

不允许模型提交任意 `path`。程序根据领域操作投影文件路径，统一更新 `characters/index.yaml` 与 `scenes/index.yaml`。

---

## 8. Day Loom 新增代码

建议目录：

```text
packages/day-loom/src/
  cli/
    revise.ts
  revise/
    index.ts
    constants.ts
    guard.ts
    session.ts
    mcp-tools.ts
    promptpile-react-run.ts
    parse-assistant.ts
    validate-payload.ts
    project-payload.ts
    diff.ts
    confirm.ts
    archive.ts
    apply-payload.ts
    append-log.ts
    types.ts

packages/day-loom/prompts/
  revise-react.core.md
  revise-react.observe.md
  revise-react.check.md
  revise-react.final.md
```

职责划分：

| 文件 | 职责 |
|------|------|
| `cli/revise.ts` | 注册 Commander 子命令 |
| `revise/index.ts` | 编排完整流程 |
| `guard.ts` | 校验 World、网关、参数组合 |
| `session.ts` | 创建临时消息目录，写用户请求与轻量摘要 |
| `mcp-tools.ts` | 调用 `export-tools`，按 allowlist 过滤工具 |
| `promptpile-react-run.ts` | 启动现有 `promptpile-react` 子进程 |
| `parse-assistant.ts` | 提取 `revise-payload` JSON 块 |
| `validate-payload.ts` | 校验领域操作、snake_case id、内容非空 |
| `project-payload.ts` | 将领域操作转换为文件变更 |
| `diff.ts` | 生成展示用 unified diff |
| `archive.ts` | 保存修改前快照、payload、diff、transcript |
| `apply-payload.ts` | 在确认后写盘 |
| `append-log.ts` | 追加 `logs/state_changes.jsonl` |

可复用现有 init 代码的模式：

```text
init/promptpile-run.ts
init/session.ts
init/parse-assistant.ts
init/project-payload.ts
```

首版可以复制少量通用逻辑。等 `init` 与 `revise` 都稳定后，再提取共享模块，避免过早抽象。

---

## 9. 上下文策略

每次 `revise` 只主动注入轻量信息：

```text
manifest.yaml
current.yaml
characters/index.yaml
scenes/index.yaml
arcs/index.yaml
用户修改请求
工具使用说明
```

AI 再按需读取：

```text
canon/*.md
characters/<id>/*.md
scenes/<id>/*.md
memory/*.md
days/day_NNNN/summary.md
```

历史读取顺序：

```text
memory/short_term.md
  -> memory/long_term.md
  -> days/*/summary.md
  -> days/*/events/** 仅在需要核实细节时读取
```

这样可以控制 token 消耗，并利用现有存档规范中 `summary.md` 的检索职责。

---

## 10. 备份与日志

每次成功应用修改后创建：

```text
.loom/revisions/revision_20260601T120000Z/
  payload.json
  diff.patch
  transcript/
  before/
    canon/style.md
    characters/index.yaml
```

`before/` 只保存本次实际改动的旧文件，不复制完整 World。

追加 `logs/state_changes.jsonl`：

```json
{"type":"world_revision","revision":"revision_20260601T120000Z","summary":"新增文学社成员林雨","changed_files":["characters/index.yaml","characters/char_lin_yu/profile.md","characters/char_lin_yu/relationships.md","characters/char_lin_yu/meta.yaml"]}
```

新文件在 `before/` 中记录为不存在，可在 `payload.json` 中增加：

```json
{
  "created_files": ["characters/char_lin_yu/profile.md"]
}
```

---

## 11. 分阶段实施

### 阶段 0：验证现有 MCP 链路

目标：不改 Day Loom 代码，确认组件可用。

1. 以 `world-interactive` 为 allowed root 启动 filesystem MCP。
2. 使用 `promptpile-mcp export-tools` 导出工具。
3. 使用 `promptpile-react` 让模型读取 `characters/index.yaml`。
4. 确认模型可以按需读取人物 `profile.md`。

验收：模型可以回答“当前有哪些角色”，且答案来自工具结果。

### 阶段 1：只支持 Canon 修改

目标：最小闭环。

1. 新增 `day-loom revise`。
2. AI 只读探索 World。
3. Payload 只允许 `replace_canon`。
4. 展示 diff。
5. 用户确认后备份并写盘。
6. 追加 `state_changes.jsonl`。

验收：

```bash
day-loom revise -d <world> --dry-run
```

可以生成 `canon/style.md` 的 diff，但不改文件。

### 阶段 2：人物与场景

目标：支持常见设定维护。

1. 增加 `upsert_character`。
2. 增加 `upsert_scene`。
3. 程序自动维护索引。
4. 为新实体创建规范要求的默认文件。

验收：新增人物后，`characters/index.yaml` 与人物目录保持一致。

### 阶段 3：正文全文搜索

目标：World 历史变大后仍能定位相关内容。

复用 `agent-lite-tools/search` 的 `Grep`，增加一个薄 MCP Server，仅暴露：

```text
Glob
Grep
```

默认忽略：

```text
.loom/**
logs/**
exports/**
```

对于 `days/**`，优先检索 `summary.md`，用户明确要求核实细节时才扩大搜索范围。

### 阶段 4：回滚与结构化状态修改

目标：提升可维护性。

1. 新增 `day-loom revise rollback <revision_id>`。
2. 增加更细的状态变更操作。
3. 对修改后 World 执行完整一致性检查。

---

## 12. 测试计划

新增测试：

```text
test/revise/parse-assistant.test.js
test/revise/validate-payload.test.js
test/revise/project-payload.test.js
test/revise/apply-payload.test.js
test/revise/append-log.test.js
```

核心测试场景：

| 场景 | 预期 |
|------|------|
| Payload 包含未知操作 | 拒绝 |
| `replace_canon.section` 非白名单 | 拒绝 |
| 人物 id 非 snake_case | 拒绝 |
| 尝试修改 `days/**` | 协议层无表达方式 |
| `--dry-run` | 不写盘，不追加日志 |
| 用户拒绝确认 | 不写盘 |
| 新增人物 | 自动创建默认文件并更新索引 |
| 修改成功 | 生成 revision 归档并追加 JSONL |

MCP 集成测试单独处理，不依赖真实模型：

1. 使用 stub MCP 网关验证工具 allowlist。
2. 使用固定 `revise-payload` fixture 验证后半段写盘。
3. 将真实 filesystem MCP + 模型作为手工 E2E。

---

## 13. 首个可提交版本的范围

建议第一个 PR 只做：

```text
day-loom revise -d <world> --proposal <fixture.json> [--dry-run] [--yes]
```

其中 `--proposal` 先跳过 AI 探索，直接读取 fixture。这样可以先稳定：

```text
payload 协议
  -> 校验
  -> 文件投影
  -> diff
  -> 确认
  -> 备份
  -> 写盘
  -> JSONL 日志
```

第二个 PR 再接入 `promptpile-mcp` 与 `promptpile-react`：

```text
AI 探索
  -> revise-payload
  -> 已验证的写盘链路
```

这个拆分能把文件安全问题与模型编排问题分开验证。
