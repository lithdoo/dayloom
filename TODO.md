# dayloom 改造计划：@dayloom/core + @dayloom/tui

> 目标：将现有 `packages/dayloom` 拆为引擎包 `@dayloom/core` 与 TUI 主入口 `@dayloom/tui`，使玩家通过单一全屏程序完成 init / daily / play / settle / revise 全流程。

---

## 背景与目标

### 现状

- `packages/dayloom` 同时承担引擎逻辑、CLI、终端 I/O（readline / stdout）。
- 交互循环（`init`、`daily`、`play`、`revise`、`settle`）直接写 `process.stdout` 和 `readTerminalInput`。
- `next` 已具备 phase → action 路由，但 `revise` 独立于状态机。
- 无 TUI；examples 通过 shell 脚本调用 CLI。

### 目标架构

```text
dayloom/
  packages/
    core/          @dayloom/core   — 游戏引擎，零 UI 依赖
    tui/           @dayloom/tui    — bindtty 全屏壳，游戏主入口（dayloom 二进制）
  examples/        继续用 @dayloom/core（CLI 或 programmatic API）
```

```text
@dayloom/tui  →  @dayloom/core, bindtty
@dayloom/core →  promptpile, promptpile-mcp
examples      →  @dayloom/core
```

### 用户体验目标

运行 `dayloom [world-dir]` 后：

1. 全屏 TUI 展示 World 状态（day、phase、推荐动作）。
2. 根据 phase 自动进入对应交互（或通过 `/next` 显式推进）。
3. 任意时刻可用 `/revise` 修订 World。
4. 会话内斜杠命令（`/help`、`/exit`、`/end-day` 等）保持现有语义。
5. CLI 保留给脚本 / CI / examples（`@dayloom/core/cli`）。

---

## Phase 1：拆包重命名（行为不变）

**目标**：目录与包名就位，现有测试全绿。

### 1.1 目录迁移

- [ ] `packages/dayloom` → `packages/core`
- [ ] `package.json` 中 `name` 改为 `@dayloom/core`
- [ ] 更新根 `package.json` workspaces：`["packages/*", "examples/*"]`（若 examples 尚未纳入 workspace 则一并加入）
- [ ] 更新 `exports` 字段：
  ```json
  {
    ".": "./dist/index.js",
    "./cli": "./dist/cli/index.js"
  }
  ```

### 1.2 引用更新

- [ ] `examples/dayloom-init-revise` 脚本中的 `dayloom` 包引用
- [ ] `examples/dayloom-daily-play` 脚本中的 `dayloom` 包引用
- [ ] 根 `package.json` 的 `build` / `test` 脚本：`-w dayloom` → `-w @dayloom/core`
- [ ] `packages/core/package.json` 的 `bin` 暂时保留 `dayloom` → `dist/index.js`（兼容期）

### 1.3 验证

- [ ] `npm install && npm run build && npm test` 在 dayloom 根目录通过
- [ ] examples 的 smoke 脚本仍可运行（调用 CLI）

**预估工作量**：0.5–1 天  
**风险**：低。纯重命名，无逻辑变更。

---

## Phase 2：抽取 SessionIO 抽象

**目标**：core 不再直接依赖 `process.stdout` / readline；CLI 与 TUI 通过注入 I/O 适配器工作。

### 2.1 新增 `packages/core/src/session-io/`

- [ ] `types.ts` — 定义接口：

  ```ts
  export interface InputOptions {
    commandHint?: string;
    instruction: string;
    userPrompt: string;
  }

  export interface StreamWriter {
    push(chunk: string): void;
    flush(): void;
  }

  export interface SessionIO {
    write(text: string): void;
    createStreamWriter(options?: { hiddenBlocks?: string[] }): StreamWriter;
    readInput(options: InputOptions): Promise<string | undefined>;
    confirm(question: string): Promise<boolean>;
    withLoading<T>(
      label: string,
      task: (update: (label: string) => void) => Promise<T>
    ): Promise<T>;
  }
  ```

- [ ] `cli-io.ts` — `createCliSessionIO()`：
  - `write` → `process.stdout.write`
  - `createStreamWriter` → 包装现有 `createFilteredStreamOutput`
  - `readInput` → 包装现有 `readTerminalInput` + 空输入草稿逻辑（`readReviseUserInput`）
  - `confirm` → 包装现有 `askYesNo`
  - `withLoading` → 包装现有 `withLoading`（`utils/loading.ts`）

- [ ] `index.ts` — 导出类型与 `createCliSessionIO`

### 2.2 扩展各模块 Options 类型

为以下 options 增加 `io?: SessionIO`（默认 `createCliSessionIO()`）：

- [ ] `InitOptions`
- [ ] `DailyOptions`
- [ ] `PlayOptions`
- [ ] `ReviseOptions`
- [ ] `SettlementOptions`
- [ ] `NextOptions`

### 2.3 改造 interactive loop（按依赖顺序）

| 文件 | 需替换的调用 |
|------|-------------|
| `init/interview-loop.ts` | `readUserInput`, `process.stdout.write`, `withLoading` |
| `init/finalize.ts` | `process.stdout.write` |
| `daily/dialogue-loop.ts` | `readDailyUserInput`, `askYesNo`, `withLoading`, `process.stdout.write`, stream output |
| `play/event-loop.ts` | `readDailyUserInput`, `withLoading`, `process.stdout.write`, `callPlayAi` onDelta |
| `revise/dialogue-loop.ts` | 同上 |
| `settle/index.ts` (`settleWithAi`) | `withLoading`, `askYesNo`, `process.stdout.write` |
| `next/index.ts` (`runNext`) | `process.stdout.write`, `askYesNo` |

- [ ] 各 loop 通过 `const io = options.io ?? createCliSessionIO()` 获取 I/O
- [ ] `read-user-input.ts` / `terminal-input.ts` 保留，仅供 `createCliSessionIO` 内部使用
- [ ] `shared/filtered-stream-output.ts` 的 `write` 回调改由 `StreamWriter` 驱动

### 2.4 统一入口函数签名（重命名导出）

在 `packages/core/src/index.ts` 增加清晰命名的 programmatic API：

- [ ] `runInit` ← `initWorldInteractive` / `initWorldQuick`
- [ ] `runDaily` ← `dailyInteractive`
- [ ] `runPlay` ← `playInteractive`
- [ ] `runSettle` ← `settleWithAi` / `settleFromProposal`
- [ ] `runRevise` ← `reviseWorldInteractive` / `reviseWorldFromProposal`
- [ ] `runNext` — 已有，补充 `io` 参数
- [ ] 旧名称保留为 deprecated alias（至少一个版本周期）

### 2.5 CLI 层适配

- [ ] `cli/*.ts` 各 action 传入 `io: createCliSessionIO()`
- [ ] 确认 CLI 行为与改造前一致（靠现有 test + examples smoke）

### 2.6 验证

- [ ] `npm test` 全绿
- [ ] `examples/dayloom-init-revise/run-revise-smoke.*` 通过
- [ ] `examples/dayloom-daily-play/run-interactive.*` + `run-play-interactive.*` + `run-settle-interactive.*` 通过

**预估工作量**：2–3 天  
**风险**：中。触及所有交互路径，需仔细回归。

---

## Phase 3：实现 runGameShell 编排器

**目标**：core 提供无 UI 的「游戏主循环」，TUI 只需实现 `SessionIO` 并调用此函数。

### 3.1 新增 `packages/core/src/shell/`

- [ ] `types.ts`：
  ```ts
  export type ShellMode = 'shell' | 'session';
  export type ShellSession = 'init' | 'daily' | 'play' | 'settle' | 'revise';
  export interface GameShellOptions extends CoreOptions {
    io: SessionIO;
    worldDir: string;
    autoStart?: boolean;  // 启动后自动执行 runNext 推荐动作，默认 true
  }
  ```

- [ ] `commands.ts` — Shell 层斜杠命令定义：
  | 命令 | 行为 |
  |------|------|
  | `/help` | 列出 Shell 命令 + 当前 phase 推荐动作 |
  | `/status` | 调用 `formatNextStatus(inspectNextState(...))` |
  | `/next` | 调用 `runNext` |
  | `/init` | 调用 `runInit`（需确认，仅 uninitialized 或显式强制） |
  | `/daily` | 调用 `runDaily`（phase 须为 idle） |
  | `/play` | 调用 `runPlay`（phase 须为 planned/playing） |
  | `/settle` | 调用 `runSettle`（phase 须为 settling） |
  | `/revise` | 调用 `runRevise`（World 已初始化即可） |
  | `/quit` | 退出主循环 |

- [ ] `index.ts` — `runGameShell(options)` 主循环伪码：
  ```text
  loop:
    state = inspectNextState(worldDir)
    io.write(formatNextStatus(state))
    if autoStart && firstRun:
      await runNext(worldDir, { io, ... })
      continue
    input = await io.readInput({ hint: shellCommands, ... })
    route input → runInit | runDaily | runPlay | runSettle | runRevise | runNext | /quit
  ```

- [ ] phase 守卫：显式命令在 phase 不匹配时通过 `io.write` 提示，不抛未捕获异常

### 3.2 导出

- [ ] `packages/core/src/index.ts` 导出 `runGameShell` 及相关类型

### 3.3 验证

- [ ] 新增 `test/shell/*.test.js`：用 mock `SessionIO` 验证路由逻辑（不依赖 TTY）
- [ ] CLI 可选增加 `dayloom shell -d <dir>` 子命令，内部调用 `runGameShell` + `createCliSessionIO`（方便无 TUI 环境调试）

**预估工作量**：1–2 天  
**风险**：低–中。逻辑集中，可单测。

---

## Phase 4：新建 @dayloom/tui

**目标**：bindtty 全屏应用，作为玩家主入口。

### 4.1 脚手架

- [ ] 新建 `packages/tui/`
- [ ] `package.json`：
  ```json
  {
    "name": "@dayloom/tui",
    "bin": { "dayloom": "dist/main.js" },
    "dependencies": {
      "@dayloom/core": "workspace:*",
      "@bindtty/signal": "...",
      "@bindtty/terminal": "...",
      "bindtty": "..."
    }
  }
  ```
- [ ] `tsconfig.json`：`jsx: react-jsx`, `jsxImportSource: bindtty`, `module: NodeNext`
- [ ] bindtty 依赖来源：lithdoo-lab 兄弟子模块 `file:../../../bindtty/packages/...` 或 workspace 协议（与 lithdoo-lab 根协调）

### 4.2 TuiSessionIO 实现

- [ ] `src/session-io.ts` — 实现 `SessionIO`：
  - `write` → append 到 `messages` signal（role: `system`）
  - `createStreamWriter` → 追加到当前 `assistant` 消息（流式更新，50ms throttle）
  - `readInput` → 等待 `TextInput.onSubmit`（Promise 桥接）
  - `confirm` → 弹出确认行或 `[Y/n]` 快捷输入
  - `withLoading` → 设置 `loadingLabel` signal，不直接写 stdout

### 4.3 ViewModel

- [ ] `src/view-model.ts`：
  ```ts
  class GameShellVM {
    worldDir: Signal<string>
    worldState: Signal<NextWorldState | null>
    messages: Signal<Message[]>
    input: Signal<string>
    loading: Signal<boolean>
    loadingLabel: Signal<string>
    mode: Signal<'shell' | 'session'>
    scrollOffset: Signal<number>
    // submit(), refreshState(), startGameShell()
  }
  ```

### 4.4 View 布局

- [ ] `src/app.tsx` — bindtty 布局（参考 `bindtty/examples/log-viewer` + `form`）：
  ```text
  ┌─ Header: world · day · phase · event ─┐
  ├─ List/ScrollView: messages            ┤
  ├─ Loading indicator                    ┤
  ├─ TextInput: user input                ┤
  └─ Footer: available commands hint      ┘
  ```
- [ ] `createNodeTerminal` + alt screen + raw mode

### 4.5 入口

- [ ] `src/main.ts`：
  ```ts
  const worldDir = process.argv[2] ?? '.';
  const io = createTuiSessionIO(vm);
  await runGameShell({ worldDir, io, autoStart: true });
  ```
- [ ] 环境变量检查：`DEEPSEEK_API_KEY`（与 core 一致）

### 4.6 验证

- [ ] 手动测试完整流程：init → daily → play → settle
- [ ] `/revise` 在 playing 阶段可打断
- [ ] `/exit` 在 session 内保存进度；`/quit` 退出程序
- [ ] Ctrl+C 优雅退出（restore terminal）

**预估工作量**：3–5 天  
**风险**：中。bindtty 多行输入、流式性能需调优。

---

## Phase 5：TUI 体验补齐

### 5.1 多行输入

- [ ] 评估 `TextInput` 是否满足需求；不足则实现 `MultilineInput` widget
- [ ] Enter 换行，Ctrl+Enter（或 Alt+Enter）提交 — 对齐 dayloom 自由行动语义

### 5.2 顶栏与状态面板

- [ ] `/status` 时在对话区插入结构化状态块（day、phase、lastCommittedDay、active event）
- [ ] play 阶段显示 `event.title`、`suggested_actions`

### 5.3 settle 两阶段 UI

- [ ] AI 生成 proposal 后展示摘要 / diff
- [ ] `io.confirm('应用此结算？')` 代替 `--yes`

### 5.4 流式输出优化

- [ ] assistant 消息 delta 批量更新（避免每 token 触发全量 layout）
- [ ] 新消息时自动滚到底部

### 5.5 错误展示

- [ ] core 抛错时 TUI 显示错误消息而非 crash 整个 app（catch + 写入 messages）

**预估工作量**：2–3 天  
**风险**：低–中。

---

## Phase 6：收尾与文档

### 6.1 二进制与包名

- [ ] `@dayloom/tui` 提供主 `dayloom` 二进制
- [ ] `@dayloom/core` 的 `bin.dayloom` 改为 `dayloom-cli` 或移除（仅保留 `@dayloom/core/cli` programmatic 入口）
- [ ] 在 `@dayloom/core` README 注明：玩家请安装 `@dayloom/tui`

### 6.2 文档更新

- [ ] 根 `README.md`：新 monorepo 结构、快速开始改为 `npx @dayloom/tui` 或 `dayloom ./world`
- [ ] `packages/core/README.md`：programmatic API、SessionIO 契约
- [ ] `packages/tui/README.md`：快捷键、斜杠命令表
- [ ] examples README：说明 CLI 与 TUI 两种入口

### 6.3 lithdoo-lab 集成

- [ ] 更新 `lithdoo-lab/README.md` 子模块说明
- [ ] 确认 `lithdoo-lab` 根 workspace 能一并 build dayloom + bindtty

### 6.4 发布（可选）

- [ ] `@dayloom/core` 与 `@dayloom/tui` 版本号策略（建议同步 semver）
- [ ] `files` 字段包含 `prompts/` 等资源

**预估工作量**：1 天

---

## 文件级改造清单（Phase 2 参考）

以下文件包含直接终端 I/O，Phase 2 必须逐一改造：

```
packages/core/src/
  init/interview-loop.ts      ← readUserInput, stdout, withLoading
  init/finalize.ts            ← stdout
  daily/dialogue-loop.ts      ← readDailyUserInput, askYesNo, stdout, stream
  play/event-loop.ts          ← readDailyUserInput, stdout, withLoading, onDelta
  revise/dialogue-loop.ts     ← 同上
  settle/index.ts             ← withLoading, askYesNo, stdout
  next/index.ts               ← stdout, askYesNo
  cli/*.ts                    ← 传入 io
  shared/terminal-input.ts    ← 仅 CliSessionIO 使用
  revise/read-user-input.ts   ← 仅 CliSessionIO 使用
  utils/loading.ts            ← 仅 CliSessionIO 使用
  shared/filtered-stream-output.ts ← StreamWriter 底层
```

---

## 命令映射总表

| 现有 CLI | core 函数 | Shell 命令 | 触发条件 |
|----------|-----------|-----------|----------|
| `init` | `runInit` | `/init` | 未初始化，或显式 |
| `daily` | `runDaily` | `/daily` | phase = idle |
| `play` | `runPlay` | `/play` | phase = planned \| playing |
| `settle` | `runSettle` | `/settle` | phase = settling |
| `revise` | `runRevise` | `/revise` | 已初始化 |
| `next` | `runNext` | `/next`、启动 autoStart | 按 phase 推荐 |
| `next --status` | `inspectNextState` | `/status` | 任意 |

会话内命令（`session-commands`）在各 `run*` session 中保持不变，由 `SessionIO.readInput` + `parseSessionCommand` 处理。

---

## 风险与决策记录

| 议题 | 决策 | 理由 |
|------|------|------|
| CLI 是否保留 | 保留为 `@dayloom/core/cli` | examples / CI 需要非 TUI 入口 |
| `dayloom` 二进制归谁 | `@dayloom/tui` | 玩家主入口 |
| play 是否每 event 回 shell | 否，一次 `runPlay` 跑完 | 与现 CLI 一致，改动最小 |
| revise 入状态机否 | 否，Shell 层 meta 命令 | 现有设计即如此 |
| bindtty 多行输入 MVP | 先单行，Phase 5 补 | 降低 Phase 4 阻塞 |
| `SessionIO` 默认值 | `createCliSessionIO()` | 避免破坏现有调用方 |

---

## 里程碑与时间线（估算）

| 里程碑 | 内容 | 预估 |
|--------|------|------|
| M1 | Phase 1 拆包完成，测试全绿 | 第 1 周 |
| M2 | Phase 2 SessionIO 落地，CLI 无回归 | 第 2–3 周 |
| M3 | Phase 3 runGameShell + 单测 | 第 3 周 |
| M4 | Phase 4 TUI MVP（完整流程可玩） | 第 4–5 周 |
| M5 | Phase 5–6 体验补齐 + 文档 | 第 6 周 |

---

## 验收标准

- [ ] `npm test` 在 dayloom monorepo 全绿
- [ ] examples smoke 脚本通过（CLI 路径）
- [ ] `dayloom ./world` 启动 TUI，从未初始化 World 走完 init → daily → play → settle 全流程
- [ ] playing 阶段 `/revise` 可修订 World 并返回
- [ ] `/exit` 保存 session 后可重新进入并恢复
- [ ] core 包无 bindtty / readline 的直接业务依赖（readline 仅存在于 `cli-io.ts`）
