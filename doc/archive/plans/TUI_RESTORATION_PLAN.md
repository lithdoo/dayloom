# Dayloom TUI 完整恢复计划

> Status: Restored / 自动化验收通过
> Date: 2026-08-14  
> Target: `@dayloom/tui`  
> Recovery baseline: `cd10fb7608c294c119c5a29ffc855172a5a58594`  
> Regression start: `c0d1b5f38c1d67cec62730ccd263c4429a490de1` (`adapt tui to core`)

> Execution record (2026-08-14): recovery safety ref `recovery/pre-tui-restore-20260814` points to pre-restore HEAD `daf71d504040ab97c47c51689e193f8ebfb9e91b`. `packages/tui` matches the recovery baseline exactly; Core and TUI builds, Core tests (139/139), TUI tests (17/17), and automated real-PTY scenarios pass. A live-provider, operator-driven Windows Terminal lifecycle/resize smoke remains an environment-specific release check rather than an automated repository check.

## 1. 目标

本计划只做一件事：

```text
从 Git 历史完整恢复迁移到 Core 之前的 @dayloom/tui 产品能力，
重新接回仍然存在的 @dayloom/core，
在恢复完成前停止任何新的 TUI 架构重构。
```

恢复后的 TUI 必须重新具备原有完整产品生命周期：

```text
uninitialized
  → init
  → idle
  → daily / planning
  → planned
  → play
  → awaiting-settle
  → settle
  → next day idle

idle
  → revise
  → idle

planned / awaiting-settle
  → abandon-day
  → idle
```

Session 交互继续保持原有 TUI 体验：

```text
Hub
  → 选择业务流程
Session
  → 自然语言多轮输入
  → streaming assistant output
  → loading / error projection
  → /submit
  → /exit / cancel
  → Hub
```

## 2. Git 恢复事实基线

`c0d1b5f38c1d67cec62730ccd263c4429a490de1` 是将 `packages/tui` 从 `@dayloom/core` 改接到 `@dayloom/core` 的迁移提交。

它的直接父提交是：

```text
cd10fb7608c294c119c5a29ffc855172a5a58594
```

因此 `cd10fb...` 是本次恢复的权威基线，而不是通过当前代码反向猜测旧行为。

该基线中：

- `packages/tui/package.json` 依赖 `@dayloom/core`；
- `packages/tui/DESIGN.md` 是已经实现并经过 Core driver / real PTY 验收的完整设计；
- Hub 业务动作包含 `init / daily / play / revise / settle / abandon-day`；
- TUI 只负责投影 Core snapshot / commands / events，不拥有业务状态机；
- `packages/tui/src/` 与 `packages/tui/test/` 都是完整的 pre-Core 实现。

恢复时以 Git tree 为事实来源，不以当前 Core TUI 代码作为重构参考。

## 3. 安全原则

### 3.1 不回滚整个 `dev`

禁止：

```text
git reset --hard cd10fb...
git revert 整段 Core 工作
```

因为 Core、Archive Protocol、Conversation Compression 等后续工作需要保留。

本次采用 path-scoped restoration：

```text
只恢复 TUI 所属路径和必要的 launcher / dependency wiring。
```

### 3.2 先保全当前状态

执行恢复前必须记录当前 `dev` HEAD，并创建一个仅用于安全回溯的 branch/tag，例如：

```text
recovery/pre-tui-restore-20260814
```

该 ref 不作为新开发分支，只确保任何当前文件都可被精确取回。

### 3.3 第一阶段追求 exact baseline，不追求优化

第一阶段禁止：

- 改写 Runtime driver API；
- 整理旧代码结构；
- 把 Core abstraction 混回 TUI；
- 顺手升级 BindTTY；
- 修改业务流程；
- 删除看起来“旧”但属于完整 TUI 的能力；
- 在恢复过程中重新设计 provider/config contract。

原则：

```text
先恢复已知可工作的完整产品，
再讨论任何现代化。
```

## 4. 恢复范围

### 4.1 `packages/tui/**` — 精确恢复

以 `cd10fb...` 的 Git tree 为准，完整恢复：

```text
packages/tui/DESIGN.md
packages/tui/README.md
packages/tui/package.json
packages/tui/src/**
packages/tui/test/**
packages/tui/tsconfig.json
```

同时删除只在 Core 迁移后新增、且 baseline 中不存在的 TUI 文件，例如：

```text
packages/tui/scripts/check-architecture.mjs
```

`packages/tui/package.json` 恢复：

```json
"@dayloom/core": "*"
```

并移除 `@dayloom/core` 作为 TUI dependency。

### 4.2 `package-lock.json` — 只做 dependency reconciliation

禁止从 `cd10fb...` 整体覆盖当前 lockfile，因为这会丢失后续 Core / compression dependencies。

正确方式：

1. 恢复 `packages/tui/package.json`；
2. 在当前 workspace 上执行 npm install / lock reconciliation；
3. 确认 TUI workspace 重新依赖 `@dayloom/core`；
4. 确认 `@dayloom/core` 自身及其新 dependencies 仍保留。

### 4.3 Root README — 恢复产品入口说明

只恢复与 TUI backend 相关的说明：

```text
@dayloom/tui + @dayloom/core Runtime
```

不要整体回滚 README。

### 4.4 `examples/dayloom-tui` — 恢复标准 TUI launcher，不恢复历史博物馆

这里不做整个目录的机械 rollback，而是恢复 pre-Core **标准 TUI 使用路径**：

恢复/重建：

```text
.env.example
open-world.bat
open-world.sh
scripts/ensure-dayloom.bat
scripts/ensure-dayloom.sh
verify-resize.bat
README.md 中标准 TUI 部分
```

标准 launcher 应重新满足：

```text
空 world 目录
→ 启动 @dayloom/tui
→ @dayloom/core 将其视为 uninitialized
→ Hub 提供 init
```

必须删除当前为了弥补 Core 功能缺口而加入的：

```text
init-world.mjs
```

不得在 example 层预造：

```text
canon
plan
day1
phase=planned
```

这些属于 Core / Session 业务，不属于 launcher。

`llm.example.toml` 是否保留不作为本次恢复核心；第一阶段以 `cd10fb...` 中已验证的 Core/TUI provider wiring 为准。若当前 Promptpile 配置方式确有独立价值，只能在完整 TUI 恢复并通过后单独评审，不能阻塞恢复。

本次不要求恢复：

```text
open-world-old.*
run-quick.*
run-tui.*
tui-old fixture world
```

这些属于 legacy `tui-old` 迁移验证，不是恢复 `@dayloom/tui` 完整产品能力所必需。

## 5. 明确保留的后续工作

以下内容不因 TUI 恢复而回滚：

```text
packages/core/**
@dayloom/archive-protocol
CORE_CONVERSATION_COMPRESSION_DRAFT.md
Core conversation compression implementation
promptpile-compress integration
Core 独立 CI matrix
```

Core 作为独立新实现继续存在，但在达到完整 functional parity 之前：

```text
不得再作为 @dayloom/tui 的默认 backend。
```

## 6. 恢复后必须重新出现的 TUI 能力

以 `cd10fb.../packages/tui/DESIGN.md` 和仍存在的 `@dayloom/core` command registry 为验收来源。

### Hub

必须能展示/执行由 Core availability 决定的业务动作：

```text
init
daily
play
revise
settle
abandon-day
```

并保留本地 UI 动作：

```text
status
help
quit
```

### World lifecycle

必须正确投影：

```text
uninitialized
initializing
idle
planning
planned
playing
awaiting-settle
revising
invalid
```

TUI 不自行推导 phase legality。

### Session

必须支持：

- init Session；
- planning Session；
- play Session；
- revise Session；
- 用户自然语言消息；
- assistant streaming；
- loading；
- structured error projection；
- `/submit`；
- `/exit` / cancel；
- Session 完成/取消后回 Hub。

### Stable Hub operations

必须重新支持不进入对话 Session 的操作：

```text
settle
abandon-day
```

## 7. 执行顺序

### Step 0 — 建立恢复证据与安全 ref

- 记录执行时 `dev` HEAD；
- 创建 recovery safety ref；
- 记录基线 `cd10fb...`；
- 记录破坏性迁移起点 `c0d1b5f...`。

### Step 1 — 精确恢复 `packages/tui/**`

从 `cd10fb...` 恢复整个 `packages/tui` tree。

目标是：

```text
packages/tui tree
≈ cd10fb... baseline
```

除非有当前 TypeScript/workspace 构建所必需的机械调整，否则不做语义改写。

### Step 2 — 恢复 workspace dependency wiring

- TUI dependency：`@dayloom/core`；
- 不再 import `@dayloom/core`；
- reconcile 当前 lockfile；
- 保留 Core package 本身。

### Step 3 — 单独构建 Core + TUI

至少运行：

```text
npm run build -w @dayloom/core
npm run build -w @dayloom/tui
```

任何错误先按 baseline mismatch / dependency drift 排查，不先改架构。

### Step 4 — 恢复 baseline TUI tests

运行 `packages/tui` 自带的完整测试。

需要验证的不只是编译：

- Hub action projection；
- Runtime driver；
- Session message lifecycle；
- streaming；
- loading；
- slash commands；
- Core command execution；
- real terminal / PTY 路径。

### Step 5 — 恢复 example 标准入口

移除 `init-world.mjs`。

恢复标准 `open-world.*`：

```text
空目录
→ current @dayloom/core + @dayloom/tui
→ uninitialized Hub
→ init
```

先验证 Windows `open-world.bat`，因为本次问题正是在该入口暴露。

### Step 6 — 手工产品生命周期 smoke

必须至少完整走一遍：

```text
空 world
→ init conversation
→ submit
→ idle
→ daily conversation
→ submit
→ planned
→ play conversation
→ submit
→ awaiting-settle
→ settle
→ next day idle
→ revise conversation
→ submit / cancel
→ idle
```

另测：

```text
planned → abandon-day → idle
awaiting-settle → abandon-day → idle
```

### Step 7 — 恢复文档事实

- 恢复 `packages/tui/DESIGN.md` 为完整设计基线；
- README 指向 `@dayloom/core`；
- 将 `TUI_CORE_ADAPTATION_DRAFT.md` 标记为 `Superseded / Functional parity regression`，禁止再作为实施依据；
- `EXAMPLES_OPTIMIZATION_DRAFT.md` 中任何建立在“Core Play-only 已完整替代 Core”的结论都必须标记失效。

### Step 8 — 再审后续 TUI-only 修复

只有 Step 1–7 全部通过后，才审查 `c0d1b5f...` 之后的 TUI 修改。

分类：

```text
A. Core migration coupling
→ 不恢复

B. UI-only bug fix / BindTTY fix / terminal portability fix
→ 单独 cherry-pick 或手工重放

C. 无法证明独立于 Core migration
→ 默认不恢复
```

每一项必须单独测试，禁止批量把当前 `packages/tui` diff 再合回来。

## 8. 测试策略

恢复验收分四层。

### Layer 1 — Static

- `@dayloom/tui` 不 import `@dayloom/core`；
- `@dayloom/tui` 依赖 `@dayloom/core`；
- 不存在 `init-world.mjs` 代替业务 Init；
- Hub action set 与 Core command availability 对齐。

### Layer 2 — Package tests

```text
@dayloom/core tests green
@dayloom/tui tests green
```

### Layer 3 — Real terminal

至少覆盖：

```text
Windows Terminal / ConPTY
Linux/macOS PTY where available
resize
Ctrl+C / shell recovery
streaming output
input focus
```

### Layer 4 — Product lifecycle

完整人工 smoke 必须从真正的 `uninitialized` 开始，禁止 fixture 直接跳到 `planned`。

## 9. Definition of Done

只有以下条件全部满足，才可以说“原 TUI 已完整恢复”：

1. `packages/tui` 已以 `cd10fb...` 为 baseline 恢复，而非根据当前代码重写。
2. TUI 重新依赖仍存在的 `@dayloom/core`，不依赖 Core。
3. 空 World 可以正常进入 Hub，phase 为 `uninitialized`。
4. Hub 提供 `init`。
5. Init Session 可以完成并发布 World。
6. `daily → planned` 可用。
7. `play → awaiting-settle` 可用。
8. `settle → next day idle` 可用。
9. `revise` 可用。
10. `abandon-day` 在合法 phase 可用。
11. Session streaming / loading / error / slash command 行为恢复。
12. TUI baseline tests 全绿。
13. real PTY / Windows terminal 路径通过。
14. `open-world.bat` 不再预造 planned World。
15. Core、compression、Archive Protocol 后续成果没有被回滚。
16. `TUI_CORE_ADAPTATION_DRAFT.md` 不再被视为有效完成标准。
17. 在完整恢复签收前，不开始第二次 Core TUI migration。

## 10. 恢复后的架构状态

短期正确状态应是：

```text
@dayloom/core
  完整 Dayloom lifecycle
        ↓
@dayloom/tui
  完整产品 UI

@dayloom/core
  独立保留
  当前仅完成部分业务 slice
  不作为 TUI 默认 backend
```

之后如果仍要让 Core 最终替代 Core，必须先单独完成 functional parity：

```text
init
daily / planning
play
settle
revise
abandon-day
uninitialized / invalid handling
```

并以完整 TUI 作为 parity consumer 验收；不能再次通过删减 TUI 功能来适配 Core。

## 11. 核心恢复原则

```text
TUI 是产品能力的消费者，不是迁移成本的牺牲品。

Core 可以重新设计内部实现和 public API，
但在被称为 replacement 之前，必须先达到已有产品功能 parity。
```
