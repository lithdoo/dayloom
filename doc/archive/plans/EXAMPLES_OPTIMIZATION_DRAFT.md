# Dayloom Examples 优化草案（部分结论已失效）

> Status: Superseded where based on Core Play-only replacing Core
> 本文关于“Core Play-only 已完整替代 Core”以及据此要求标准 TUI 示例预置 `planned` Archive V2 World 的结论已失效。标准 `examples/dayloom-tui` 入口应使用 `@dayloom/core`，从空目录和 `uninitialized` Hub 开始；其余历史分析仅供参考，不再作为 TUI 恢复依据。

Original status: Design Draft / 待评审
Date: 2026-08-14
Target: `examples/`

## 1. 背景

当前 `examples/` 同时保留两代 Dayloom 使用方式：

- legacy `@dayloom/cli` / `@dayloom/core-old` / `@dayloom/tui-old`；
- 当前 Archive V2 + `@dayloom/core` + `@dayloom/tui`。

这会产生一个直接问题：用户进入 `examples/` 后无法仅凭目录判断哪一套仍是当前产品路径。旧示例中的 `init`、`daily`、`revise`、`settle`、YAML World、`.loom/`、MCP wiring 与当前 Core application API 并不属于同一个运行模型，但仍以一等示例存在。

Examples 应当只表达当前受支持的 product path，不承担历史实现归档或迁移兼容职责。

## 2. 优化目标

本次优化只做一件事：

```text
examples/
→ 只保留当前可运行、可解释、可维护的 Dayloom 使用方式
```

最终示例应明确表达：

```text
planned Archive V2 World
        +
Promptpile caller LLM TOML
        ↓
@dayloom/core
        ↓
@dayloom/tui
        ↓
Play Session
```

具体目标：

1. 删除所有仅服务 legacy CLI / core-old / tui-old 的示例。
2. 不把 legacy `init` / `daily` / `revise` / `settle` 迁移成 Core 示例。
3. 保留一个最小、真实、当前可执行的 TUI 示例。
4. 示例中的 provider/model/credential policy 与正式 TUI/Core contract 一致。
5. 示例不得重新引入 Core 已禁止的 MCP、provider override、旧 World layout 或兼容层。
6. 示例脚本只做启动和必要 build，不复制 runtime/business logic。

## 3. 非目标

本次不做：

- 为 Core 增加 `init`、`daily`、`revise`、`settle` API；
- 为旧 World 编写 Archive V2 migration；
- 保留 `tui-old` 作为 examples 下的迁移验证入口；
- 新增通用 example framework、fixture manager 或 shell abstraction；
- 把 Archive Protocol conformance fixture 当成可玩的 Dayloom World；
- 修改 Core、TUI 或 Archive Protocol 的 application boundary。

历史实现如果仍需保留，应由 git history、专门 migration test 或独立文档承担，不应继续放在用户可见 examples 中。

## 4. 当前目录判断

当前一级目录：

```text
examples/
├── dayloom-daily-play/
├── dayloom-init-revise/
└── dayloom-tui/
```

### 4.1 `dayloom-init-revise/`

结论：**整体删除**。

原因：

- 入口是 legacy `@dayloom/cli`；
- README 明确引用 `packages/core-old/prompts/spec.md`；
- 示例围绕 `init --quick`、`revise --proposal`、interactive revise；
- 数据模型依赖 `manifest.yaml`、`.loom/revisions/`、`logs/state_changes.jsonl` 等旧布局；
- 与 Core 当前唯一 `play` Session application surface 不一致。

不保留其中的 quick/revise fixture、验证器或 MCP setup。

### 4.2 `dayloom-daily-play/`

结论：**整体删除**。

原因：

- 实际调用 legacy `dayloom daily` / `dayloom play` / `dayloom settle`；
- 状态机使用 `idle → planned → playing → settling → idle`；
- 读取 `manifest.yaml`、`current.yaml`；
- 验证 `plan.current.json`、`play.state.json`、`runtime.state.json`、event/settlement 等旧业务产物；
- 名称中的 `play` 与 Core Play 同名，但 runtime/data contract 完全不同，继续保留反而更易误导。

不原地改造成 Core 示例。若未来需要 direct Core API example，应新建一个语义明确的独立目录。

### 4.3 `dayloom-tui/`

结论：**保留，但做彻底去 legacy 化**。

当前 `open-world.*` 已符合新架构：

```text
Archive V2 planned World
+ llm.toml
→ build archive-protocol/core/tui
→ packages/tui/dist/main.js <world> --llm-config <config>
```

但同一目录仍混有 `tui-old`、旧 World 和旧 provider/MCP setup，需要删除。

## 5. 目标目录

建议最终收敛为：

```text
examples/
└── dayloom-tui/
    ├── README.md
    ├── llm.example.toml
    ├── open-world.sh
    ├── open-world.bat
    └── verify-resize.bat
```

如果清理后没有本地生成文件需要忽略，则删除 `.gitignore`；否则仅保留真正需要的最小规则。

不保留 `scripts/` helper 目录，除非实施时发现 Windows/macOS/Linux 启动逻辑出现不可接受的重复。当前优先直接在 3 个入口脚本中写清楚必要 build，避免再引入一层 indirection。

## 6. 精确文件动作

### 6.1 整体删除

```text
examples/dayloom-init-revise/**
examples/dayloom-daily-play/**
```

### 6.2 `examples/dayloom-tui/` 删除

```text
open-world-old.sh
open-world-old.bat
run-quick.sh
run-quick.bat
run-tui.sh
run-tui.bat
scripts/ensure-dayloom-old.sh
scripts/ensure-dayloom-old.bat
world/**
```

如果 `scripts/ensure-dayloom.*` 仅被 resize smoke 使用，则一并删除：

```text
scripts/ensure-dayloom.sh
scripts/ensure-dayloom.bat
```

目标是最终不保留 `scripts/`。

### 6.3 保留并调整

```text
README.md
open-world.sh
open-world.bat
verify-resize.bat
```

### 6.4 替换

```text
.env.example
→ llm.example.toml
```

如仍希望给 API key 一个提示，可以在 README 中写环境变量示例，不再维护 Dayloom-specific provider override `.env`。

## 7. `README.md` 新语义

README 只说明当前路径，不再出现“旧示例仍保留用于迁移验证”。

建议结构：

1. 这是当前 `@dayloom/tui` + `@dayloom/core` 示例。
2. 前置条件：Node 20+、一个有效 planned Archive V2 World、Promptpile caller LLM TOML。
3. 复制 `llm.example.toml` 并配置 provider/profile/credential。
4. 运行：

```bash
./open-world.sh /absolute/path/to/world /absolute/path/to/llm.toml
```

或：

```bat
open-world.bat C:\path\to\world C:\path\to\llm.toml
```

5. 第二参数可以由 `DAYLOOM_LLM_CONFIG` 提供。
6. Session 中自然语言多轮输入，`/submit` 提交，`/exit` / `/cancel` 取消。
7. `verify-resize.bat` 仅用于 Windows TUI resize 人工 smoke。

README 不介绍：

```text
init
daily
revise
settle
MCP
DAYLOOM_LLM_MODEL
DAYLOOM_LLM_BASE_URL
core-old
tui-old
YAML World
.loom
```

## 8. `llm.example.toml`

示例 config 的职责只有一个：展示 Promptpile caller config 的最小合法形状。

原则：

- provider/profile/model/API semantics 由 Promptpile 拥有；
- 凭证优先引用环境变量，不把 secret 写入文件；
- 不包含 `[promptpile-react]`；
- `[promptpile]` 不包含 Core 已禁止 caller 拥有的 Conversation/runtime topology 字段；
- 不包含 compression policy；
- 不包含 MCP/tool/hook 配置。

示例内容应以当前 Promptpile public TOML contract 为准，例如保留一个 `[[llm_api]]` profile 和 `[promptpile].llm_api` selection；具体字段在实施时从当前 Promptpile 文档/测试核对后写入。

本草案不冻结某一家 provider 为 Dayloom 默认 provider。

## 9. `open-world.*`

`open-world.sh` / `.bat` 保持极小职责：

```text
resolve repo root
→ require world path
→ resolve llm config from argv or DAYLOOM_LLM_CONFIG
→ build archive-protocol + core + tui
→ launch current TUI
```

固定调用形状：

```text
node packages/tui/dist/main.js <worldRoot> --llm-config <llmConfigPath>
```

禁止：

- 创建 World；
- 修改 World；
- 生成 TOML；
- 从 `DEEPSEEK_API_KEY` 推导 Dayloom provider config；
- 设置 `DAYLOOM_LLM_MODEL` / `DAYLOOM_LLM_BASE_URL`；
- 启动 MCP；
- 调用 legacy CLI；
- 调用 `core-old` / `tui-old`。

## 10. `verify-resize.bat`

Resize smoke 的产品价值仍然存在，但启动契约必须改成当前 TUI contract。

新接口：

```text
verify-resize.bat <planned-archive-v2-world> [llm-config]
```

其中 `llm-config` 缺省时读取：

```text
DAYLOOM_LLM_CONFIG
```

行为：

```text
validate args
→ build archive-protocol + core + tui
→ 设置 diagnostic log paths
→ 打印 Windows Terminal / Console Host resize checklist
→ 启动 current TUI with --llm-config
→ 回显 exit code 与 diagnostic paths
```

不得再：

- 创建 `world2-resize-test` 空目录作为 World；
- 从 `.env` 读取 Dayloom provider override；
- 依赖 `scripts/ensure-dayloom.*` legacy build；
- 无 `--llm-config` 启动 TUI。

Resize checklist 本身可以原样保留，只调整启动和环境准备部分。

## 11. World fixture 策略

本次不在 `examples/dayloom-tui/` 提交一个手工复制的 Archive V2 World。

原因：

1. Archive V2 是 graph + immutable object identity，手工复制一个演示 World 容易随协议或 profile 演进变 stale。
2. `fixtures/archive-protocol/v2` 是 protocol conformance fixture，不是 Dayloom product World，不应混用。
3. 当前 TUI 示例的核心价值是展示正确 consumer entrypoint，而不是演示 World authoring。

因此 v1 example 明确要求调用者提供一个现有 planned Archive V2 World。

如果未来确实需要“一键体验”，应单独设计一个由受支持 producer 生成、并被 CI 验证的 `planned-world` fixture；不要重新引入 legacy `init --quick`。

## 12. Direct Core example

本次不新建，但预留清晰方向：

```text
examples/core-play/
```

只有当需要对 library consumer 展示 application API 时再增加：

```ts
createDayloomCore(...)
→ startSession('play')
→ send(...)
→ subscribe(output.delta)
→ submit()
→ dispose()
```

它不得复制 TUI driver，也不得承担 World 初始化。

当前没有实际 consumer 需求时，不为了“examples 看起来丰富”而新增该目录。

## 13. Architecture guard

建议增加一个很小的 examples guard 或现有 repository check，扫描 `examples/`，禁止重新出现以下 legacy references：

```text
@dayloom/core-old
@dayloom/tui-old
packages/core-old
packages/tui-old
npx ... dayloom init
npx ... dayloom daily
npx ... dayloom revise
npx ... dayloom settle
manifest.yaml
current.yaml
.loom/
```

是否将 `@dayloom/core` 整体列为 examples 禁止项，可在实施时根据仓库仍保留 legacy core 的其他用途决定；对于最终 `dayloom-tui` 示例，它不应出现。

优先使用简单静态扫描，不新增 example test framework。

## 14. 实施步骤

### Step 0 — 删除明确 legacy 目录

删除：

```text
examples/dayloom-init-revise/
examples/dayloom-daily-play/
```

### Step 1 — 清理 `dayloom-tui`

删除 old launchers、old helpers、旧 World、旧 `.env.example`。

### Step 2 — 收口当前入口

确认并统一 `open-world.sh` / `.bat`：

```text
archive-protocol → core → tui build
world + llm config → current TUI
```

### Step 3 — 新增 `llm.example.toml`

从当前 Promptpile public config contract 生成最小 example。

### Step 4 — 调整 resize smoke

改成显式 planned World + llm config，不再制造空 World 或 provider override。

### Step 5 — 更新 README

README 只描述当前 architecture，不再解释 legacy 示例。

### Step 6 — 增加最小 examples guard

防止 legacy references 回流。

### Step 7 — 验证

在 Linux/macOS shell path 与 Windows bat path 上至少做静态/构建验证；Windows resize 仍作为人工 smoke。

## 15. 验收标准

### 15.1 目录

- `examples/dayloom-init-revise` 不存在。
- `examples/dayloom-daily-play` 不存在。
- `examples/dayloom-tui` 中不存在 `*-old*`。
- `examples/dayloom-tui/world` 不存在。
- `examples/dayloom-tui/scripts` 不存在，除非有明确且必要的 current-only helper；若保留，需单独说明理由。

### 15.2 Legacy reference

`examples/` 中不存在：

```text
core-old
tui-old
@dayloom/cli legacy commands
manifest.yaml
current.yaml
.loom/
DAYLOOM_LLM_MODEL
DAYLOOM_LLM_BASE_URL
PROMPTPILE_MCP_*
```

### 15.3 Current entrypoint

`open-world.sh` / `.bat`：

- 接受 World path；
- 接受 llm config path 或 `DAYLOOM_LLM_CONFIG`；
- build `@dayloom/archive-protocol`、`@dayloom/core`、`@dayloom/tui`；
- 只启动 current TUI；
- 不写 World。

### 15.4 LLM config

`llm.example.toml`：

- 是当前 Promptpile 可解析 caller config；
- 不含 `[promptpile-react]`；
- 不含 Core-owned topology/runtime fields；
- 不含 tools/hooks/MCP/compression policy；
- secret 通过环境变量引用。

### 15.5 Resize smoke

`verify-resize.bat`：

- 要求已有 planned Archive V2 World；
- 要求 llm config；
- 使用当前 TUI；
- 保留 diagnostic logging 与 resize checklist；
- 不创建 legacy/empty World。

### 15.6 Architecture

- Examples 不新增 application abstraction。
- Examples 不复制 Core/TUI business legality。
- Examples 不解释 Archive graph internals。
- Examples 不承担 World migration。

## 16. Definition of Done

本优化完成的定义：

1. `examples/` 只剩当前受支持的 consumer path。
2. 两个 legacy business examples 已删除。
3. `dayloom-tui` 不再包含 `tui-old` / `core-old` 路径。
4. 旧 YAML World 与 `.loom` fixture 已删除。
5. provider/model policy 只通过 Promptpile caller TOML 表达。
6. `open-world.*` 可以明确启动当前 Core TUI。
7. resize smoke 使用相同启动 contract。
8. examples 不依赖 MCP。
9. examples 不生成或修改 World。
10. examples 不新增 compatibility layer、manager、fixture framework 或通用 launcher abstraction。
11. 最小静态 guard 阻止 legacy references 回流。
12. README 与实际脚本完全一致。

## 17. 核心原则

最终 examples 应满足：

```text
Examples are current product documentation expressed as runnable code.
They are not a museum of retired runtime models.
```

对应 Dayloom 当前边界：

```text
Archive Protocol owns persisted correctness.
Core owns Play application semantics.
TUI owns presentation.
Promptpile owns provider/profile semantics.
Examples only show how a consumer connects those supported boundaries.
```
