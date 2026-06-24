# `day-loom revise` AI + MCP 完整落地方案

## 1. 目标

将 `revise` 实现为一个可持续多轮对话的 World 设定维护命令：

```bash
day-loom revise -d <world_root>
```

用户可以询问当前世界、角色、场景和历史摘要，也可以在对话中提出修改。AI 通过只读 MCP 工具按需检索 World，不需要一次性把完整存档塞入上下文。只有用户显式输入 `/apply` 并确认 diff 后，Day Loom 才会备份和写盘。

核心职责严格分离：

```text
MCP       只读探索 World
AI        回答问题，整理待修改意图，生成领域级 payload
Day Loom  校验、diff、确认、备份、写盘、记录日志
```

---

## 2. 当前实现与目标差距

当前 `src/revise/` 已有安全写盘底座：

```text
proposal JSON
  -> validateRevisePayload
  -> projectRevisePayload
  -> describeChanges
  -> --dry-run 或 --yes
  -> applyChanges
  -> .loom/revisions/<revision_id>/before/
  -> logs/state_changes.jsonl
```

当前只支持：

```json
{
  "op": "replace_canon",
  "section": "style",
  "content": "新的完整文件内容"
}
```

缺少：

- AI 多轮对话。
- MCP 生命周期管理。
- MCP 只读工具过滤。
- 单轮内多次 tool call 执行。
- 待修改意图草稿。
- `/pending`、`/apply`、`/cancel` 命令。
- 真正的 unified diff。
- 应用前文件冲突检测。
- 人物和场景修改操作。

现有 `--proposal <file>` 不删除，保留为测试与自动化旁路。

---

## 3. 用户体验

### 3.1 默认交互模式

```bash
day-loom revise -d ./output/world-interactive
```

示例：

```text
Starting revise session for: ./output/world-interactive
Type /help for commands.

You> 维克托现在是什么设定？
AI> 我读取了角色索引和维克托档案。他目前谨慎、克制，但会主动照顾熟人。

You> 让他说话更简短一些，但不要变得冷漠。
AI> 已记录。建议修改维克托的人物档案，保留他对熟人的关心，只减少主动表达。

You> /pending
Pending changes:
  1. character char_viktor profile: 表达更克制，但不能显得冷漠。

You> /apply
AI is preparing a revision proposal...

--- characters/char_viktor/profile.md
+++ characters/char_viktor/profile.md
@@ ...

Apply this revision? (Y/N): Y
Applied World revision: revision_20260601T120000Z
```

### 3.2 会话命令

| 命令 | 作用 |
|------|------|
| `/help` | 显示可用命令 |
| `/pending` | 展示程序保存的待修改意图 |
| `/apply` | 让 AI 生成最终 payload，展示 diff，进入确认 |
| `/cancel` | 放弃草稿并退出，不写盘 |
| `/exit` | 保存 session 草稿并退出，不写盘 |

普通自然语言输入不会结束会话。AI 返回普通文本仅表示“本轮回答完成，不再需要调用工具”。

### 3.3 自动化旁路

```bash
day-loom revise \
  -d ./output/world-interactive \
  --proposal ./fixtures/revise-style.json \
  --dry-run

day-loom revise \
  -d ./output/world-interactive \
  --proposal ./fixtures/revise-style.json \
  --yes
```

`--proposal` 模式跳过 AI 和 MCP，继续用于底层回归测试。

---

## 4. 三层状态机

不要把“模型返回普通文本”误认为整个 revise 已完成。需要区分三层状态。

### 4.1 会话状态机

```text
starting
  -> chatting
       |-- 普通输入  -> answering -> chatting
       |-- /pending  -> chatting
       |-- /apply    -> finalizing -> reviewing
       |                              |-- N -> chatting
       |                              `-- Y -> applying -> completed
       |-- /cancel   -> cancelled
       `-- /exit     -> saved_draft
```

### 4.2 单轮回答内部状态机

```text
append user message
  -> run promptpile --continue --tools-file readonly.tools.toml
       |-- 模型返回 tool_calls
       |     -> promptpile-mcp exec-calls --input <latest.calls.jsonl>
       |     -> 写入 <latest.result.jsonl>
       |     -> 再次运行 promptpile
       |
       `-- 模型不再返回 tool_calls
             -> 解析 revise-status
             -> 展示自然语言回答
             -> 返回 chatting
```

这个循环只负责取得一次完整回答。它不决定整个会话何时结束。

### 4.3 应用状态机

```text
/apply
  -> finalize payload
  -> validate payload
  -> project controlled file changes
  -> generate unified diff
  -> capture target file hashes
  -> ask user confirmation
       |-- N -> chatting
       `-- Y -> verify target hashes unchanged
                 |-- conflict -> refuse and return chatting
                 `-- clean -> archive -> write -> log -> completed
```

---

## 5. 为什么不用 `promptpile-react`

仓库里的 `promptpile-react` 适用于任务型 Agent：

```text
Thought -> Observe -> Check -> Final
```

`revise` 更像一个持续聊天会话：用户可以问问题、补充修改、撤销意图，最后显式 `/apply`。因此推荐：

- 复用 `promptpile` 的消息目录、`--continue` 和工具历史格式。
- 复用 `promptpile-mcp` 的 `launch`、`export-tools`、`exec-calls`。
- 在 `src/revise/dialogue-loop.ts` 自己实现薄状态机。
- 不依赖 `promptpile-react`。

这样对话结束条件由 Day Loom 控制，不会被通用 Agent 编排误判。

---

## 6. MCP 生命周期

### 6.1 默认：由 Day Loom 管理临时网关

执行 `day-loom revise -d <world>` 时：

1. 解析并校验 World 根目录。
2. 从本机选取一个空闲 TCP 端口。
3. 创建临时 `mcp.toml`。
4. 子进程启动 `promptpile-mcp launch --config <temp>/mcp.toml`。
5. 轮询 `GET /health`，直到成功或超时。
6. 请求 `GET /v1/tools/export`。
7. 过滤只读工具并写出 `<session>/readonly.tools.toml`。
8. 对话结束后向网关子进程发送终止信号并等待退出。

托管模式下即使网关只监听 `127.0.0.1`，也应默认启用随机 Bearer token。

注意：当前 `promptpile-mcp launch` 要求端口在 `1..65535`，不支持直接传 `0`。Day Loom 必须先挑选空闲端口，再写入配置。

临时配置：

```toml
version = 1

[gateway]
port = 49152
token = "<random-session-token>"

[behavior]
failure_policy = "strict"
flat_names = false

[servers.world]
command = "npx"
args = [
  "-y",
  "@modelcontextprotocol/server-filesystem",
  "/absolute/path/to/current-world"
]
```

### 6.2 可选：连接外部网关

为调试和高级用户保留：

```bash
day-loom revise \
  -d <world> \
  --mcp-base-url http://127.0.0.1:8765
```

此时 Day Loom 不启动和关闭网关，但仍必须：

- 导出工具。
- 过滤只读 allowlist。
- 调用 `list_allowed_directories`。
- 确认 `-d` World 位于 allowed root 中。

无论使用托管网关还是外部网关，启动会话前的 allowed-root 校验由 Day Loom 主动构造一次 `mcp__world__list_allowed_directories` 调用，经 `POST /v1/calls/exec` 执行；不能只依赖模型自行调用。

### 6.3 默认只读工具 allowlist

只向模型暴露：

```text
mcp__world__list_allowed_directories
mcp__world__list_directory
mcp__world__directory_tree
mcp__world__search_files
mcp__world__read_text_file
mcp__world__read_multiple_files
mcp__world__get_file_info
```

绝不暴露：

```text
write_file
edit_file
move_file
create_directory
```

即使官方 filesystem MCP 具备写工具，AI 也看不到它们。

### 6.4 全文检索限制

filesystem MCP 的 `search_files` 更偏路径搜索，不等价于正文 `grep`。首版使用：

```text
characters/index.yaml
scenes/index.yaml
arcs/index.yaml
memory/*.md
days/*/summary.md
```

作为导航入口。

后续将仓库已有的 `agent-lite-tools/search` 包装为只读 MCP Server，只暴露：

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

---

## 7. revise session 目录

每次执行创建临时目录：

```text
/tmp/day-loom-revise-XXXXXX/
  promptpile.toml
  mcp.toml
  readonly.tools.toml
  draft.json
  transcript.md
  messages/
    [0]system.md
    [1]assistant.md
    [2]user.md
    [3]assistant.calls.jsonl
    [3]assistant.result.jsonl
    [4]assistant.md
    ...
```

说明：

- `messages/` 由 `promptpile --continue` 维护工具调用历史。
- `draft.json` 由 Day Loom 维护，不依赖模型记忆。
- `transcript.md` 可以在退出或应用时生成。
- 默认成功后清理临时目录。
- `--keep-session` 时保留路径并输出到终端。

---

## 8. promptpile 调用方式

### 8.1 配置

session 内写入：

```toml
[[llm_api]]
name = "deepseek"
model = "deepseek-chat"
base_url = "https://api.deepseek.com/v1"
api_key_env = "DEEPSEEK_API_KEY"

[promptpile]
llm_api = "deepseek"
dir = "./messages"
tools_file = "../readonly.tools.toml"
quiet = true
```

### 8.2 单次模型请求

Day Loom 启动 bundled `promptpile/dist/index.js`：

```bash
promptpile \
  --config promptpile.toml \
  -d messages \
  --tools-file readonly.tools.toml \
  --continue
```

### 8.3 工具执行

执行任何调用前，Day Loom 必须解析最新 `.calls.jsonl`，逐条验证 `function.name` 位于只读 allowlist。过滤发给模型的 schema 只是第一层保护；执行前校验是第二层强制边界。发现未知或写入型工具时立即拒绝，不得转发给网关。

如果最新 assistant turn 生成：

```text
[N]assistant.calls.jsonl
```

则执行：

```bash
promptpile-mcp exec-calls \
  --base-url http://127.0.0.1:<port> \
  --input messages/[N]assistant.calls.jsonl
```

它会写入：

```text
messages/[N]assistant.result.jsonl
```

随后再次调用 promptpile。promptpile 会按照已有格式把 tool call 和 tool result 重放给模型。

### 8.4 循环保护

每条用户输入最多允许：

```text
MAX_TOOL_ROUNDS_PER_USER_MESSAGE = 8
```

超过上限时停止本轮并提示：

```text
AI exceeded the tool-call limit for this turn. Refine the question or inspect the session.
```

还应校验：

- 只执行最新 turn 的 `.calls.jsonl`。
- 执行前逐条验证 `function.name` 位于只读 allowlist。
- 已存在对应 `.result.jsonl` 时不重复执行。
- 工具调用失败时保留 session，输出可诊断路径。

Day Loom 可以直接 spawn `promptpile-mcp exec-calls --input`，不需要 after-hook 脚本。这样 Windows、Linux 和 macOS 的行为一致。

---

## 9. 对话协议

### 9.1 初始 system prompt

新增：

```text
prompts/revise-dialogue.system.md
```

核心规则：

- 使用中文与用户交流，除非用户切换语言。
- 回答世界事实前优先读取相关文件。
- 不得编造未读取的设定。
- MCP 工具只用于读取。
- 普通问题可以直接回答。
- 用户提出修改时，将修改意图写入 `revise-status`。
- 不直接输出完整文件替换内容，除非进入 finalize。
- 不声称修改已应用。

### 9.2 每轮回复格式

自然语言正文后附状态块：

````text
维克托目前谨慎克制，但仍会主动照顾熟人。
我已记录：减少主动表达，但保留他对熟人的关心。

```revise-status
{
  "pending_changes": [
    {
      "target": {
        "kind": "character",
        "id": "char_viktor",
        "field": "profile"
      },
      "instruction": "表达更克制，但不能显得冷漠。"
    }
  ]
}
```
````

### 9.3 `draft.json`

Day Loom 解析状态块后，将完整 `pending_changes` 覆盖写入：

```json
{
  "pending_changes": [
    {
      "target": {
        "kind": "character",
        "id": "char_viktor",
        "field": "profile"
      },
      "instruction": "表达更克制，但不能显得冷漠。"
    }
  ]
}
```

采用“完整列表覆盖”而不是增量 patch，避免合并语义不明确。若状态块缺失或非法：

- 自然语言回答仍可展示。
- `draft.json` 不更新。
- stderr 输出警告。

### 9.4 用户命令不交给模型

这些命令由 Day Loom 截获：

```text
/help
/pending
/cancel
/exit
/apply
```

只有普通文本进入对话消息目录。

---

## 10. Finalize 协议

### 10.1 触发

用户输入：

```text
/apply
```

Day Loom 读取：

```text
draft.json
transcript.md
World 轻量索引
```

创建独立 finalize session，并使用：

```text
prompts/revise-finalize.system.md
```

finalize 仍允许使用同一套只读 MCP 工具。模型可以在生成最终 payload 前重新读取目标文件，避免依赖陈旧上下文。

### 10.2 最终 payload

模型只输出：

````text
```revise-payload
{
  "summary": "调整维克托的表达风格。",
  "operations": [
    {
      "op": "upsert_character",
      "id": "char_viktor",
      "profileMd": "# 维克托\n\n...完整新档案...\n",
      "relationshipsMd": "# Relationships\n\n...\n",
      "meta": {
        "status": "active",
        "tags": ["student"]
      }
    }
  ]
}
```
````

禁止任意 `path` 字段。路径由 Day Loom 投影。

### 10.3 领域操作

第一阶段：

```text
replace_canon
```

第二阶段：

```text
upsert_character
upsert_scene
```

后续再考虑：

```text
archive_character
archive_scene
update_world_state
```

不允许修改：

```text
days/**
logs/**
current.yaml
manifest.yaml 中的 id / protocol_version / created_at
```

---

## 11. Diff、冲突检查与应用

### 11.1 文件投影

模型输出领域操作，程序转换为受控文件集合。例如：

```text
upsert_character(char_viktor)
  -> characters/char_viktor/profile.md
  -> characters/char_viktor/relationships.md
  -> characters/char_viktor/meta.yaml
  -> characters/index.yaml
```

新人物还应创建：

```text
characters/char_viktor/memory.md
characters/char_viktor/timeline.md
```

### 11.2 unified diff

现有 `changes.txt` 只有：

```text
update canon/style.md
```

应新增 `diff.ts` 生成真实 unified diff：

```diff
--- canon/style.md
+++ canon/style.md
@@ ...
-旧内容
+新内容
```

用户确认前必须展示真实 diff。

### 11.3 文件 hash 冲突检查

生成 diff 时对每个目标文件记录：

```text
relativePath
exists
sha256
```

用户确认后、真正写盘前再次计算 hash。若任意文件变化：

```text
Refusing to apply revision: files changed during review.
```

返回 `chatting`，要求重新 `/apply`。

### 11.4 归档

成功写盘前创建：

```text
.loom/revisions/revision_20260601T120000Z/
  payload.json
  diff.patch
  draft.json
  transcript/
    dialogue.md
    messages/
  before/
    canon/style.md
    characters/char_viktor/profile.md
```

只备份受影响旧文件。新文件记录在 `payload.json.created_files`。

### 11.5 日志

追加：

```text
logs/state_changes.jsonl
```

示例：

```json
{"type":"world_revision","revision":"revision_20260601T120000Z","summary":"调整维克托的表达风格。","changed_files":["characters/char_viktor/profile.md"]}
```

---

## 12. 代码目录

继续在现有 `src/revise/` 内扩展：

```text
packages/day-loom/src/
  cli/
    revise.ts
  revise/
    index.ts                    # 总入口：proposal 旁路或 AI 模式
    types.ts
    constants.ts
    guard.ts

    dialogue-loop.ts            # 会话状态机与 /commands
    read-user-input.ts          # 终端多行输入
    session.ts                  # revise / finalize session
    transcript.ts               # 生成 transcript.md
    draft.ts                    # draft.json 读写
    parse-assistant.ts          # revise-status / revise-payload

    promptpile-run.ts           # 启动 bundled promptpile
    promptpile-loop.ts          # 单轮内部 tool call 循环
    mcp-gateway.ts              # 挑端口、启停临时网关、health check
    mcp-tools.ts                # export tools、allowlist、allowed root 校验
    mcp-exec.ts                 # 调用 exec-calls --input

    finalize.ts                 # draft + transcript -> payload
    validate-payload.ts         # 已有，逐步扩展
    project-payload.ts          # 已有，逐步扩展
    diff.ts                     # unified diff
    file-hash.ts                # sha256 冲突检查
    confirm.ts                  # Y/N 确认
    archive.ts                  # revision 归档
    apply-payload.ts            # 已有，拆分后复用
```

新增 prompts：

```text
packages/day-loom/prompts/
  revise-dialogue.system.md
  revise-finalize.system.md
```

---

## 13. CLI 设计

```bash
day-loom revise -d <world>
```

建议参数：

| 参数 | 作用 |
|------|------|
| `-d, --dir <path>` | 必填，World 根目录 |
| `--keep-session` | 退出后保留临时 session |
| `--max-tool-rounds <n>` | 每条用户输入的工具循环上限，默认 `8` |
| `--mcp-base-url <url>` | 使用外部 MCP 网关，不自动启动 |
| `--mcp-token <token>` | 外部网关 Bearer token，优先从环境变量读取 |
| `--proposal <path>` | 测试旁路：跳过 AI/MCP |
| `--dry-run` | proposal 模式或 `/apply` 后只展示 diff，不写盘 |
| `--yes` | 自动确认，主要用于自动化测试 |

默认行为：

```text
无 --proposal -> AI 多轮对话模式
有 --proposal -> 现有 fixture 执行模式
```

---

## 14. 依赖与可执行文件解析

Day Loom 需要像现有 `init/promptpile-run.ts` 一样优先解析 bundled 脚本：

```text
promptpile/package.json -> dist/index.js
```

对于 `promptpile-mcp`，建议将其加入 Day Loom 依赖后解析：

```text
promptpile-mcp/package.json -> dist/src/index.js
```

如果暂时不调整 workspace 依赖，可支持环境变量覆盖：

```text
PROMPTPILE_BIN
PROMPTPILE_MCP_BIN
```

解析优先级：

```text
环境变量覆盖
  -> bundled dist script
  -> PATH 中命令名
```

默认 filesystem MCP 使用：

```text
npx -y @modelcontextprotocol/server-filesystem <world_root>
```

这意味着首次运行可能需要联网下载。失败时错误信息应明确提示用户预安装或检查网络。

---

## 15. 测试计划

### 15.1 纯单元测试

```text
test/revise/parse-assistant.test.js
test/revise/draft.test.js
test/revise/validate-payload.test.js
test/revise/project-payload.test.js
test/revise/diff.test.js
test/revise/file-hash.test.js
test/revise/apply-payload.test.js
```

覆盖：

- 合法与非法 `revise-status`。
- 合法与非法 `revise-payload`。
- 未知操作拒绝。
- 任意 path 无表达方式。
- `--dry-run` 不写盘。
- 未确认不写盘。
- hash 变化时拒绝覆盖。
- 成功归档与 JSONL 日志。

### 15.2 promptpile 循环测试

使用 fake CLI 脚本，不调用真实模型：

1. 第一次输出 `[N]assistant.calls.jsonl`。
2. fake MCP exec 写 `[N]assistant.result.jsonl`。
3. 第二次输出普通回答与 `revise-status`。
4. 验证循环停止并更新 `draft.json`。
5. 验证超过 `maxToolRounds` 时失败。

### 15.3 MCP 集成测试

使用 stub 网关：

- `/health` 成功与超时。
- `/v1/tools/export` 中包含写工具时，过滤后只保留 allowlist。
- `list_allowed_directories` 不包含当前 World 时拒绝启动会话。
- `.calls.jsonl` 伪造写工具名时必须在 Day Loom 层拒绝，不能发送到网关。
- `exec-calls --input` 失败时保留 session。

### 15.4 手工 E2E

真实 DeepSeek + 官方 filesystem MCP：

```text
用户询问角色列表
  -> AI 调用 list_directory / read_text_file
  -> 返回基于存档的回答

用户提出人物修改
  -> draft.json 更新

用户 /apply
  -> AI 读取人物文件
  -> 生成 payload
  -> 展示 diff
  -> 确认后归档并写盘
```

---

## 16. 分阶段开发顺序

### PR 1：保留现有安全写盘底座

已有基础：

```text
--proposal
validate
project
--dry-run / --yes
archive before
JSONL log
```

补充：

```text
真实 unified diff
sha256 冲突检查
```

### PR 2：AI 对话，不接 MCP

- 新增 `dialogue-loop.ts`。
- 新增 `/pending`、`/apply`、`/cancel`、`/exit`。
- 新增 `revise-status` 与 `draft.json`。
- 暂时主动注入轻量索引和小型 World 文件。
- finalize 输出 `replace_canon`。

### PR 3：临时 filesystem MCP

- 新增 `mcp-gateway.ts`。
- 自动挑选端口，启动 `promptpile-mcp launch`。
- health check。
- export tools + allowlist。
- `list_allowed_directories` 二次校验。
- 单轮 tool call 循环。

### PR 4：人物和场景操作

- `upsert_character`。
- `upsert_scene`。
- 自动维护索引与默认文件。
- 增加实体相关测试。

### PR 5：正文全文检索

- 将 `agent-lite-tools/search` 包装成只读 MCP Server。
- 暴露 `Glob` 与 `Grep`。
- 默认优先搜索 `days/*/summary.md`。

### PR 6：增强维护能力

- `revise rollback <revision_id>`。
- archive 操作。
- 更细的结构化状态更新。

---

## 17. 完成标准

首个 AI + MCP 可用版本需要满足：

1. `day-loom revise -d <world>` 启动多轮对话。
2. AI 能通过只读 MCP 回答角色和场景问题。
3. 普通回答后会话继续，不会误判完成。
4. 用户修改意图会写入 `draft.json`。
5. 只有 `/apply` 会生成最终 payload。
6. 只有用户确认后才写盘。
7. AI 看不到 MCP 写工具。
8. 目标文件在确认期间变化时拒绝覆盖。
9. 成功修改会生成 revision 归档和 JSONL 日志。
10. `--proposal` 旁路仍可用于自动化测试。
