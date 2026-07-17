# dayloom 改造计划：@dayloom/core + @dayloom/cli + @dayloom/tui

> 目标：将现有 `packages/dayloom` 拆为三个包——`@dayloom/core`（纯引擎 API）、`@dayloom/cli`（现有命令行逻辑）、`@dayloom/tui`（bindtty 全屏统一入口）。原 dayloom 可通过 **CLI** 或 **TUI** 两种方式启动，二者均调用 core 完成业务。

---

## 核心决策（定死，不可回退）

### 三包职责

**@dayloom/core**

- 只做：状态机、AI 调用、文件变更、`run*` API、`SessionIO` / `SessionExit` 类型定义。
- 终态（Phase 2 后）没有：`bin`、readline、commander、bindtty、spinner 实现。
- Phase 1 期间允许 legacy terminal I/O 暂存，Phase 2 必须清零。

**@dayloom/cli**

- 负责：现有 `dayloom` 子命令、commander 注册、`createCliSessionIO()`、终端 spinner / readline 实现。
- 业务全部调用 core（见下方「硬约束」允许的入口级分支）。

**@dayloom/tui**

- 负责：bindtty UI、`createTuiSessionIO()`、调用 `core.runGameShell`。
- 业务全部调用 core（见下方「硬约束」允许的入口级分支）。

### 硬约束

> **业务逻辑只能出现在 core；cli / tui 做 I/O 适配与入口编排。**

**cli / tui 允许：**

- 入口路由（子命令选择、参数解析）
- 参数分支（如 `--proposal` → 非交互 API，否则 → 交互 API）
- UI 状态分支（渲染不同组件、loading 展示）

**cli / tui 禁止（出现即视为架构回退）：**

- 直接读写 World 文件
- 判断 dayloom phase 等业务规则
- 调用 AI / MCP
- 实现 init / daily / play / settle / revise 的状态转换

**其他定死规则：**

- TUI **不得**在 `TuiSessionIO.readInput()` 里拦截 `/revise` 等 shell 级命令；必须由 core session loop 结构化返回给 `runGameShell`，防止 TUI 层变成第二套业务状态机。
- core **不得**有 `createCliSessionIO` 或任何默认 `SessionIO` 实现（Phase 2 完成后）。
- 交互 API 与非交互 API **分函数、分 options 类型**，不混在一个模糊 options 里。

### bin 策略

| 阶段 | CLI | TUI |
|------|-----|-----|
| **短期（本改造）** | `@dayloom/cli` → `dayloom` | `@dayloom/tui` → `dayloom-tui` |
| **长期** | 维持 `dayloom` 给脚本 / CI | 是否合并为 `dayloom` 默认 TUI、子命令退居 `--cli`，**另议** |

---

## 背景与目标

### 现状

- `packages/dayloom` 同时承担引擎逻辑、CLI（commander）、终端 I/O（readline / stdout / **stderr**）。
- 交互循环直接写 `process.stdout` / `process.stderr`（warning、preserved session path 等）。
- `next` 已具备 phase → action 路由，但 `revise` 独立于状态机。
- session loop 内部自行解析 slash command；play 阶段输入 `/revise` 会被当未知 session command，无法交还 shell。

### 目标架构

```text
dayloom/
  packages/
    core/          @dayloom/core   — 引擎：状态机、run* API、SessionIO 类型
    cli/           @dayloom/cli    — dayloom 子命令 + CliSessionIO
    tui/           @dayloom/tui    — dayloom-tui + TuiSessionIO + runGameShell
  examples/        依赖 @dayloom/cli
```

```text
@dayloom/cli  →  @dayloom/core
@dayloom/tui  →  @dayloom/core, bindtty
examples      →  @dayloom/cli
```

### 两种启动方式

```bash
# CLI（脚本 / CI / examples）
dayloom init -d ./world
dayloom play -d ./world
dayloom next -d ./world

# TUI（游戏统一入口）
dayloom-tui ./world
```

---

## SessionIO 与 SessionExit（核心契约）

### SessionIO — 完整定义

现有方案缺少 `warn` / `error` 与空输入策略。源码中大量用户可见信息写到 **stderr**（warning、preserved session path 等），不纳入 SessionIO 会在 TUI 下漏到真实 stderr，破坏全屏 UI。

```ts
// packages/core/src/session-io/types.ts

export interface InputOptions {
  commandHint?: string;
  instruction: string;
  userPrompt: string;
  /**
   * init:         'ask-exit'        — 空输入询问是否退出
   * daily/revise: 'ask-save-draft' — 空输入询问是否保存草稿
   * play/shell:   'ignore'          — 空输入继续等待（no-op）
   */
  emptyBehavior: 'ask-exit' | 'ask-save-draft' | 'ignore';
}

export interface StreamWriter {
  push(chunk: string): void;
  flush(): void;
}

export interface SessionIO {
  write(text: string): void;
  warn(text: string): void;
  error(text: string): void;
  createStreamWriter(options?: { hiddenBlocks?: string[] }): StreamWriter;
  readInput(options: InputOptions): Promise<string | undefined>;
  confirm(question: string): Promise<boolean>;
  withLoading<T>(
    label: string,
    task: (loading: { update(label: string): void }) => Promise<T> | T
  ): Promise<T>;
}
```

**实现归属：**

| 方法 | core | cli (`CliSessionIO`) | tui (`TuiSessionIO`) |
|------|------|----------------------|----------------------|
| `write` | 类型 only | `stdout.write` | messages signal |
| `warn` | 类型 only | `stderr.write`（TTY 时也可走 stdout 着色） | messages signal, role=warn |
| `error` | 类型 only | `stderr.write` | messages signal, role=error |
| `withLoading` | 类型 only | spinner 写 stdout | `loadingLabel` signal |
| `readInput` | 类型 only | readline + `emptyBehavior` 分支 | TextInput Promise 桥接 |

`withLoading` 是 SessionIO 上的**抽象动作**；真正的 spinner 实现在 **cli**（`loading-spinner.ts`），TUI 用 signal 实现。

### SessionExit — session → shell 返回协议

为实现「/revise 任意时刻可用」，session loop 遇到 **shell 级命令** 时必须结构化返回，而非在 UI 层拦截。

```ts
// packages/core/src/session-io/types.ts

export type ShellCommand = 'revise' | 'next' | 'quit';
// 注意：/status、/help 不在 ShellCommand 中，见下方「斜杠命令优先级」

export type SessionExit<TResult = unknown> =
  | { kind: 'completed'; result?: TResult }
  | { kind: 'saved'; sessionPath?: string }
  | { kind: 'cancelled' }
  | { kind: 'shell-command'; command: ShellCommand; raw: string };
```

第一版迁移用 `TResult = unknown`；后续按模块收紧：

```ts
runInitInteractive(...): Promise<SessionExit<InitResult>>
runSettleInteractive(...): Promise<SessionExit<SettlementResult>>
// daily / play / revise 同理
```

CLI 读取 `exit.result` 时无需到处类型断言。

**斜杠命令优先级（定死）：**

1. **当前 session 已定义的命令优先** — 例如 play 内 `/status` 显示当前 event，由 play loop 内部消化。
2. **未被 session 消化的 shell-level 命令** — 返回 `SessionExit.shell-command`，由 `runGameShell` 路由。
3. **`/revise`、`/next`、`/quit` 永远是 shell-level**，除非某 session 在文档中明确声明覆盖（默认不覆盖）。
4. **`/status` 仅在 shell 等待层处理** — 显示 World 状态（`formatNextStatus`）；session 内的 `/status` 保持各模块原有语义（如 play 显示 event.json）。
5. **`/help` 不打断 session** — session 内 `/help` 由当前 session 消化（显示 session 命令表）；shell 等待层 `/help` 由 `runGameShell` 处理（显示 shell 命令表）。与 `/status` 规则一致，**不**加入 `ShellCommand`。

| 层级 | 示例 | 处理方 |
|------|------|--------|
| session 级 | `/help`（session 命令表）、`/exit`、`/save`、`/end-day`、play 内 `/status` | 当前 session loop 内部消化 |
| shell 等待层级 | `/status`（World 概览）、`/help`（shell 命令表） | `runGameShell` 直接处理 |
| shell 级（可打断 session） | `/revise`、`/next`、`/quit` | session loop 返回 `shell-command` |

- [x] Phase 2：各 loop 在 `parseSessionCommand` 之后、处理 session 命令之前，先检测 shell-level 命令
- [x] `runPlay` / `runDaily` / `runRevise` / `runInit` 等 interactive 函数返回 `Promise<SessionExit>`（而非 `void`）
- [x] `runGameShell` 收到 `shell-command: revise` 时调用 `runRevise`，完成后回到 shell 等待层

---

## API 分层：交互 vs 非交互

**严格分函数、分 options，不混用。**

### 交互 API（`io: SessionIO` 必填）

```ts
runInitInteractive(dir, { io, ... }): Promise<SessionExit<InitResult>>
runDailyInteractive(dir, { io, ... }): Promise<SessionExit<DailyResult>>
runPlayInteractive(dir, { io, ... }): Promise<SessionExit>
runSettleInteractive(dir, { io, ... }): Promise<SessionExit<SettlementResult>>
runReviseInteractive(dir, { io, ... }): Promise<SessionExit<ReviseWorldResult>>
runGameShell({ worldDir, io, ... }): Promise<void>
```

### 非交互 API（无 `io`，返回结构化 result）

```ts
runInitQuick(dir, options): InitResult
runDailyFromProposal(dir, proposalPath, options): DailyResult
runSettleFromProposal(dir, proposalPath, options): SettlementResult
runReviseFromProposal(dir, proposalPath, options): ReviseWorldResult
```

### next 拆层（避免 shell/TUI 重复输出）

当前 `runNext` 既 inspect 又 print 又 execute，TUI 需要更细粒度。

```ts
// 查询层（无副作用，可任意调用）
inspectNextState(worldDir): NextWorldState
formatNextStatus(state): string
describeNextAction(state): string

// 执行层
runRecommendedAction(state, { io, ... }): Promise<SessionExit>
  // runGameShell、TUI /next 调用此函数

export interface NextResult {
  state: NextWorldState;
  action: NextAction;
  executed: boolean;
  exit?: SessionExit;   // runRecommendedAction 的结构化返回，供 CLI 读取 result
}

runNext(worldDir, { io, ... }): Promise<NextResult>
  // 仅给 CLI 兼容：inspect + io.write(format...) + io.write(describe...) + runRecommendedAction
  // NextResult.exit 承载 SessionExit（含 completed.result），兼容现有返回风格
```

- [x] Phase 3 明确：`runGameShell` 调 `runRecommendedAction`，**不**直接调 `runNext`
- [ ] `dayloom next`（cli）继续调 `runNext`（含打印，保持现有 CLI 输出）

---

## 文件归属（分阶段）

> Phase 1 与 Phase 2 的 terminal I/O 归属不同，见各 Phase 说明。勿在 Phase 1 就把 terminal I/O 迁出 core，否则 SessionIO 未落地前会编译失败。

### Phase 1 末 — core 暂存 legacy terminal I/O

```
packages/core/
  init/  daily/  play/  settle/  revise/  next/
  i18n/  session-commands/  prompts/
  shared/  utils/             ← 含 legacy terminal-input、loading spinner 等
  src/index.ts                ← 仅 export，无 parseCli
  （无 cli/、无 bin）
```

### Phase 1 末 — cli 仅含入口

```
packages/cli/
  src/cli/                    ← commander 注册（从 core 迁出）
  src/index.ts                ← export parseCli，无副作用（可测试 / 可 import）
  src/main.ts                 ← #!/usr/bin/env node + parseCli(process.argv)
  （尚无 session-io/，暂通过 core 的 legacy I/O 间接工作）
```

```json
{
  "main": "./dist/index.js",
  "bin": { "dayloom": "./dist/main.js" }
}
```

### Phase 2 末 — core 终态（必须清零 terminal I/O）

```
packages/core/
  init/  daily/  play/  settle/  revise/  next/
  i18n/  session-commands/
  shared/
    filtered-stream-output.ts ← 纯函数，write 回调注入
  utils/                      ← 仅纯函数，无 TTY、无 readline、无 spinner
  prompts/
  session-io/
    types.ts                  ← SessionIO、SessionExit、InputOptions（仅类型）
  shell/                      ← runGameShell（Phase 3）
```

**Phase 2 必须从 core 删除：**

```
terminal-input / read-user-input / askYesNo 的实现
utils/loading.ts 的 spinner 实现
process.stdout / process.stderr 直接调用
readline import
```

### Phase 2 末 — cli 终态

```
packages/cli/
  src/cli/
  src/index.ts                ← export parseCli only
  src/main.ts                 ← bin 入口
  src/session-io/
    cli-io.ts                 ← createCliSessionIO
    terminal-input.ts
    ask-yes-no.ts
    loading-spinner.ts
```

### 新建 tui

```
src/main.ts
src/app.tsx
src/view-model.ts
src/session-io.ts              ← createTuiSessionIO（无业务分支）
```

---

## Phase 1：三包骨架 + CLI 入口拆分

**目标**：`packages/dayloom` → `core` + `cli`，现有 CLI 行为与测试全绿。

> **允许 legacy terminal I/O 暂存 core。** Phase 1 只拆包边界与 CLI 入口，**不**迁出 terminal-input / loading-spinner。Phase 2 SessionIO 落地后再从 core 清零。避免「行为不变」与「core 立刻零终端依赖」互相打架。

### 1.1 拆分 core

- [x] 新建 `packages/core/`，迁入引擎代码 + **暂留** legacy terminal I/O（`terminal-input`、`read-user-input`、`utils/loading` 等）
- [x] **仅迁出** `cli/` 目录（commander 注册）
- [x] `name: "@dayloom/core"`，无 `bin`
- [x] `src/index.ts` 仅 export，无 `parseCli()`

### 1.2 新建 cli 包

- [x] 迁入 `src/cli/*`
- [x] 新建 `src/index.ts`（`export { parseCli }`，无副作用）与 `src/main.ts`（`#!/usr/bin/env node` + `parseCli(process.argv)`）
- [x] `package.json`：`main: "./dist/index.js"`，`bin: { "dayloom": "./dist/main.js" }`
- [x] `import { parseCli } from '@dayloom/cli'` 不会自动执行 CLI，与 core 纯入口原则一致
- [x] 依赖 `@dayloom/core`；各 action 仍调用 core 现有函数（core 内 legacy I/O 照常工作）

### 1.3 根 monorepo + examples

- [x] 删除 `packages/dayloom/`
- [x] workspaces：`["packages/*", "examples/*"]`
- [x] examples 脚本指向 `@dayloom/cli` 的 `dayloom` bin

### 1.4 验证

- [x] `npm install && npm run build && npm test` 全绿
- [x] 全子命令行为与改造前一致
- [x] **允许** core 仍含 readline / stdout / spinner（legacy 暂存）

**预估**：1–2 天 | **风险**：低

---

## Phase 2：SessionIO + SessionExit 落地，core 清零 terminal I/O

**目标**：core 零终端依赖；所有 stdout/stderr/warning 走 `io.write` / `io.warn` / `io.error`；legacy terminal I/O 从 core 迁出至 cli。

### 2.1 core：`session-io/types.ts`

- [x] 定义完整 `SessionIO`、`InputOptions`、`SessionExit`（见上文）
- [x] 仅导出类型，无实现

### 2.2 从 core 迁出 terminal I/O → cli

- [x] `terminal-input.ts`、`read-user-input` / `askYesNo`、`utils/loading` spinner 迁入 `packages/cli/src/session-io/`
- [x] core 删除上述文件及所有 `readline` / `process.stdout` / `process.stderr` 直接调用

### 2.3 cli：`createCliSessionIO()`

- [x] 实现 `write` / `warn` / `error`（warn/error 写 stderr，与现行为一致）
- [x] `readInput` 按 `emptyBehavior` 分支：
  - `ask-exit` → init 逻辑
  - `ask-save-draft` → daily/revise 逻辑
  - `ignore` → play / shell 逻辑（空输入 no-op，继续等待）
- [x] `withLoading` → `loading-spinner.ts`

### 2.4 改造 core interactive loop

| 文件 | 改造 |
|------|------|
| `init/interview-loop.ts` | `io` + `emptyBehavior: 'ask-exit'` + 返回 `SessionExit` |
| `daily/dialogue-loop.ts` | `io` + `emptyBehavior: 'ask-save-draft'` + shell 命令返回 |
| `play/event-loop.ts` | `io` + `emptyBehavior: 'ignore'` + `/revise` → `shell-command` |
| `revise/dialogue-loop.ts` | 同上 |
| `settle/index.ts` | `io.warn` / `io.error` 替换 `process.stderr.write` |
| `next/index.ts` | 拆层准备（Phase 3 完成拆分） |

- [x] 所有 `process.stderr.write`（warning、session path）→ `io.warn` 或 `io.write`
- [x] 各 loop 识别 shell 级命令并返回 `SessionExit`，不吞掉 `/revise`

### 2.5 API 重命名

- [x] 交互函数加 `Interactive` 后缀，`io` 必填，返回 `Promise<SessionExit<TResult>>`（分模块收紧泛型）
- [x] 非交互函数保持 `FromProposal` / `Quick` 命名，无 `io`
- [x] deprecated alias 保留一个版本周期

### 2.6 cli 适配

- [x] 各 action：`const io = createCliSessionIO(); await runPlayInteractive(dir, { io, ... })`

### 2.7 验证

- [x] `npm test` 全绿
- [x] examples smoke 通过
- [x] **core 必须无** readline / stdout / stderr / spinner / commander import
- [x] cli 提供完整 `createCliSessionIO`

**预估**：2–3 天 | **风险**：中

---

## Phase 3：runGameShell + next 拆层

### 3.1 core：`shell/`

- [x] `runGameShell({ worldDir, io, autoStart? })` 主循环
- [x] shell 等待层直接处理：`/status`、`/help`（不进 `ShellCommand`，不打断 session）
- [x] 收到 `SessionExit.shell-command` 时路由：
  - `revise` → `runReviseInteractive`
  - `next` → `runRecommendedAction`
  - `quit` → 退出
- [x] `SessionExit.completed` → 读取可选 `result` 供 CLI 打印（如 worldRoot、day/nextDay），再回 shell 等待层
- [x] `SessionExit.saved | cancelled` → 刷新状态，回 shell 等待层

### 3.2 core：`next/` 拆层

- [x] 提取 `runRecommendedAction(state, { io, ... })`
- [x] `runNext` 改为：`inspect` + `io.write(format...)` + `io.write(describe...)` + `runRecommendedAction`，将 `exit` 填入 `NextResult`
- [x] `runGameShell` **只**调 `runRecommendedAction`，不重复 print

### 3.3 cli 可选

- [x] `dayloom shell -d <dir>` → `runGameShell({ io: createCliSessionIO() })`

### 3.4 验证

- [x] `test/shell/*.test.js`：mock `SessionIO` 验证路由与 `SessionExit`
- [x] play 中输入 `/revise` 能交还 shell 并进入 revise session（`handleShellCommand` 路由已实现；完整 play 路径需手工 smoke）

**预估**：1–2 天 | **风险**：低–中

---

## Phase 4：新建 @dayloom/tui

> **2026-07**：Phase A–D 已完成（见 [`packages/tui/TODO.md`](packages/tui/TODO.md)）。输入区使用 **`@bindtty/widgets` `Textarea`**（非自研、非单行 `TextInput`）；bindtty **`0.1.0-alpha.10`**。自动聚焦、Confirm chrome、消息区标题获焦与用户历史回显已落地，剩余体验小改见独立 TODO。

### 4.1 脚手架

- [x] `packages/tui/`，`bin: { "dayloom-tui": "dist/main.js" }`
- [x] 依赖 `@dayloom/core`、bindtty **`0.1.0-alpha.10`**

### 4.2 `createTuiSessionIO(vm)`

- [x] `write` / `warn` / `error` → messages signal（不同 role/样式）
- [x] **不**在 `readInput` 拦截 shell 命令；空输入行为由 core 传入的 `emptyBehavior` 驱动
- [x] `withLoading` → `loadingLabel` signal
- [x] SessionIO 单测：readInput / emptyBehavior / confirm / withLoading

### 4.3 UI + 入口

- [x] bindtty 布局：Header + ScrollView 消息区 + Loading + `@bindtty/widgets` Textarea + Footer
- [x] `main.ts`：`runGameShell({ worldDir, io: createTuiSessionIO(vm) })`
- [x] view-model / session-io 遵守硬约束（仅 UI 状态分支，无 World/phase/AI 逻辑）

### 4.4 验证

- [x] PTY smoke：`dayloom-tui <tmp-world> --no-auto-start` + 自动聚焦 + `/status` + Ctrl+C
- [ ] init → daily → play → settle 全流程（需 API key 手工 smoke；属 Phase D）
- [ ] play 中 `/revise` 可打断并返回（需 API key 手工 smoke；属 Phase D）
- [x] warning / error 显示在 TUI 内（SessionIO 契约 + 单测）

**预估**：3–5 天 | **风险**：中（真实 AI 全流程仍需手工 smoke；体验缺口见独立 TODO）

---

## Phase 5：TUI 体验补齐

> 规格见 [`packages/tui/TODO.md`](packages/tui/TODO.md) §11。Phase C/D 体验与打磨项已落地；含 API 的全流程见 tui TODO §11.1。

- [x] 多行输入（`@bindtty/widgets` Textarea：Enter 换行，Ctrl+Enter 提交）
- [x] 顶栏：day、phase、event、suggested_actions
- [x] confirm 框 Y/N
- [x] 输入区 / Confirm 自动聚焦，Tab / Shift+Tab 手动遍历仍可用
- [x] 用户提交后历史显示 `[YOU]`
- [x] 流式 `appendStream` throttle（~50ms）+ 自动滚底
- [x] i18n / Windows 提交键文案（无 Ctrl+Z 误导）
- [x] 单 session 失败不崩 shell + 零 stderr 泄漏回归
- [ ] settle proposal 审阅 UX 打磨（依赖真实 AI smoke）
- [ ] Windows Terminal 含 API 全流程手工验收（清单见 tui TODO §11.1）

**预估**：2–3 天

---

## Phase 6：收尾与文档

### 6.1 bin（短期策略）

| 包 | bin | 说明 |
|----|-----|------|
| `@dayloom/core` | 无 | programmatic only |
| `@dayloom/cli` | `dayloom` | 现有子命令，examples 依赖 |
| `@dayloom/tui` | `dayloom-tui` | 游戏主入口 |

- [ ] 长期是否让 `dayloom` 默认启动 TUI：**另议**，本改造不阻塞

### 6.2 文档

- [ ] 根 README：三包、CLI vs TUI、架构硬约束
- [ ] core README：`SessionIO` / `SessionExit` 契约、API 分层
- [ ] cli README：子命令列表
- [ ] tui README：快捷键、斜杠命令（shell 级 vs session 级）

### 6.3 验收标准

**Phase 1 完成时：**

- [x] 三包可 build / test；CLI 行为与改造前一致
- [x] core **允许** legacy terminal I/O 暂存

**全部 Phase 完成时：**

- [ ] `npm test` 全绿；examples smoke 通过（cli）
- [ ] `dayloom` 全子命令与改造前一致
- [ ] `dayloom-tui ./world` 全流程可玩
- [ ] play 中 `/revise` 经 `SessionExit` 交还 shell，**非** TuiSessionIO 拦截
- [ ] play 中 `/status` 显示 event；shell 等待层 `/status` 显示 World 概览
- [ ] session 内 `/help` 显示 session 命令；shell 等待层 `/help` 显示 shell 命令表
- [ ] TUI 下无 stderr 泄漏（warning/session path 走 `io.warn`）
- [ ] core 无 commander / readline / bindtty / spinner 实现
- [ ] cli / tui 遵守硬约束（code review：无 World 读写、phase 判断、AI/MCP 调用）

**预估**：1 天

---

## 命令映射总表

| 现有 CLI | core 交互 API | core 非交互 API | cli bin | tui shell |
|----------|---------------|-----------------|---------|-----------|
| `init` | `runInitInteractive` | `runInitQuick` | `dayloom init` | `/init` |
| `daily` | `runDailyInteractive` | `runDailyFromProposal` | `dayloom daily` | `/daily` |
| `play` | `runPlayInteractive` | — | `dayloom play` | `/play` |
| `settle` | `runSettleInteractive` | `runSettleFromProposal` | `dayloom settle` | `/settle` |
| `revise` | `runReviseInteractive` | `runReviseFromProposal` | `dayloom revise` | `/revise` |
| `next` | `runRecommendedAction`（经 shell） | — | `dayloom next`（= `runNext`） | `/next` |
| `next --status` | `inspectNextState` + `formatNextStatus` | — | `dayloom next --status` | shell 层 `/status` |
| play 内 `/status` | play session 内部 | — | — | 显示 event（session 级） |
| session 内 `/help` | 各 session 内部 | — | — | session 命令表 |
| shell 层 `/help` | — | — | — | shell 命令表 |
| — | `runGameShell` | — | `dayloom shell`（可选） | TUI 主循环 |

---

## 方案评审备忘

| 项 | 原方案不足 | 本版处理 |
|----|-----------|----------|
| SessionIO | 缺 warn/error/emptyBehavior | 已补全 |
| /revise 任意可用 | session loop 吞掉 shell 命令 | `SessionExit.shell-command` |
| /status 歧义 | shell 与 play 内语义冲突 | `/status` 移出 ShellCommand；优先级规则定死 |
| Phase 1/2 冲突 | 拆包与清零 terminal I/O 同时要求 | Phase 1 允许 legacy 暂存；Phase 2 清零 |
| SessionExit.completed | CLI 缺 result 信息 | 泛型 `SessionExit<TResult>` + 分模块收紧 |
| /help 歧义 | 与 /status 类似双层语义 | 不打断 session；shell 层单独处理 |
| NextResult vs SessionExit | 二者关系不清 | `NextResult.exit?: SessionExit` |
| cli index/main | bin 与 export 耦合 | `index.ts` export + `main.ts` bin |
| emptyBehavior | `allow` 易误用 | 移除；shell/play 用 `ignore` |
| cli/tui 硬约束 | 「无业务分支」过绝对 | 改为允许/禁止清单 |
| utils/ 归属 | core/cli 边界模糊 | 分阶段文件表 |
| runNext | inspect+print+execute 耦合 | 拆 `runRecommendedAction` |
| API 类型 | interactive/non-interactive 混用 | 分函数、分 options |
| bin | 长期策略不清 | 短期 `dayloom` / `dayloom-tui`，长期另议 |

**评级**：9.5/10，**定稿可执行**。

---

## 里程碑（定稿）

| 里程碑 | 内容 | 预估 |
|--------|------|------|
| M1 | Phase 1：拆 core/cli，legacy I/O 暂存 core，CLI 不坏 | 第 1–2 周 |
| M2 | Phase 2：SessionIO + SessionExit 落地，core 清零终端依赖 | 第 2–3 周 |
| M3 | Phase 3：runGameShell + runRecommendedAction，TUI 编排就绪 | 第 3 周 |
| M4 | Phase 4：TUI MVP | 第 4–5 周 |
| M5 | Phase 5–6：体验补齐 + 文档 | 第 6 周 |
