# @dayloom/tui 实施 TODO

> **状态（2026-07）**：TUI MVP 已恢复：`view-model`、`session-io`、`argv`、bindtty 根布局、消息区、loading、输入区、确认框与基础测试已落地。本文继续记录第一版踩坑、当前约束与后续打磨清单。
> 上层三包拆分计划见仓库根目录 [TODO.md](../../TODO.md)；`@dayloom/core` 与 `@dayloom/cli` **不受影响**。

---

## 0. 为什么要重做

第一版实现完成了 bindtty 布局、`createTuiSessionIO`、`runGameShell` 接入、自研多行 `Textarea` 等，但在 Windows Terminal 下**输入区默认不会自动获得焦点**（需 Tab 把焦点移到输入框）。经调试日志确认：

| 现象 | 根因（有运行时证据） |
|------|----------------------|
| 输入提示出现后直接打字无效 | bindtty 焦点仍停留在 **MessageList**；字母键在 List 的 `onKey` 返回 `false` 被丢弃 |
| Tab 后 inverse 高亮出现，才能打字 | Tab 触发 `focusNext()`，`onFocusChange` 的 `reason` 为 `"next"`，Textarea 才获得焦点 |
| 获得焦点后中英文、退格均正常 | `handleKey` → `applyChange` 链路正常；**不是** readline 或 `disabled` 问题 |

**当前决策**：TUI 重做不再要求 `BindTTYApp.focus(id)`，也不追求 `beginInput` 后自动聚焦输入框。MVP 接受通过 Tab / Shift+Tab 进入输入区；重点保证焦点进入 Textarea 后输入链路稳定、`readInput` 行为与 CLI 一致。

次要问题（未完全验收）：

- 系统终端光标被 `hideCursor: true` 关闭，需自绘反色 caret（Textarea 已设计，随实现重做）
- 边框与文字重叠 → `padding`、布局 chrome 行数需校准
- Footer 快捷键文案与 Windows（Ctrl+Z）不一致 → i18n 与平台提示需统一
- `onKey: computed(() => disabled ? false : handler)` 在 disabled 时会把 handler 设为 `false`，导致 bindtty **不注册焦点项**——应用函数包装并内部判断 `disabled`

---

## 1. 目标与边界

### 1.1 要做什么

`@dayloom/tui` 是 dayloom 的**游戏主入口**（与 `@dayloom/cli` 并列）：

```bash
dayloom-tui ./world
```

启动后全屏 UI，经 **`runGameShell`** 完成 init / daily / play / settle / revise 全流程。

TUI **只做三件事**：

1. bindtty 布局与渲染  
2. `createTuiSessionIO(vm)` — 把 core 的 `SessionIO` 映射到 UI signal / Promise  
3. 入口编排 — argv、`mountApp`、`runGameShell`

### 1.2 硬约束（不可违反）

| 禁止 | 原因 |
|------|------|
| 直接读写 World 文件 | 业务在 core |
| 根据 `phase` / `NextAction` 分支执行业务 | 仅用 `inspectTuiHeader` **只读**展示 Header |
| 在 `readInput` 里解析 `/revise`、`/next`、`/quit` | 必须经 session loop → `SessionExit.shell-command` |
| 调用 AI / MCP | core 内部 |
| 向真实 stderr 写用户可见内容 | 全屏 UI 会破坏体验；走 `io.warn` / `io.error` |

### 1.3 与 CLI 对比

| | `@dayloom/cli` | `@dayloom/tui` |
|--|----------------|----------------|
| bin | `dayloom` | `dayloom-tui` |
| 编排 | 各子命令 | 仅 `runGameShell` |
| SessionIO | `createCliSessionIO()` | `createTuiSessionIO(vm)` |
| 斜杠路由 | `dayloom shell` 支持 | **默认**即 shell 模式 |

---

## 2. 依赖

### 2.1 npm 包（`package.json` 已声明）

```json
{
  "@dayloom/core": "*",
  "bindtty": "0.1.0-alpha.3",
  "@bindtty/terminal": "0.1.0-alpha.3",
  "@bindtty/interaction": "0.1.0-alpha.3",
  "@bindtty/text": "0.1.0-alpha.3",
  "@bindtty/widgets": "0.1.0-alpha.3"
}
```

### 2.2 bindtty 侧**必须先有**的能力

| 能力 | 用途 | 备注 |
|------|------|------|
| `createNodeTerminal({ rawMode, useAltScreen, hideCursor })` | 全屏 raw 输入 | |
| `createApp(view, { terminal })` → `start` / `dispose` | 根应用 | |
| `interaction` 焦点遍历 Tab / Shift+Tab | 输入框、列表、确认框之间切换焦点 | MVP 依赖此能力 |
| intrinsic：`screen` `vstack` `hstack` `box` `text` `show` `for` | 布局 | |
| `createSignal` / `computed` | ViewModel | 与 widgets 共用 signal 实例 |
| JSX：`jsxImportSource: "bindtty"` | TSX 组件 | |

### 2.3 core 侧已就绪（无需改即可接 TUI）

- `runGameShell({ worldDir, io, autoStart?, ... })`
- `SessionIO` / `SessionExit` / `InputOptions` / `createFilteredStreamOutput`
- `inspectTuiHeader(worldDir)` — Header 只读数据（day、phase、event、suggested_actions）
- `InitCancelledError` — init 空输入退出

参考：`packages/cli/src/session-io/cli-io.ts`（SessionIO 平行实现范本）

---

## 3. 目标目录结构

```text
packages/tui/
  TODO.md                 ← 本文件
  README.md
  package.json
  tsconfig.json
  src/
    main.ts               ← argv → vm → mountApp → runGameShell
    index.ts              ← 可选导出 mountApp / createViewModel
    argv.ts               ← world-dir、--locale、--no-auto-start、GameShellOptions 透传
    app.tsx               ← bindtty 根布局
    view-model.ts         ← UI signal，无业务
    session-io.ts         ← createTuiSessionIO(vm)
    theme.ts              ← 可选：role 颜色
    components/
      index.ts
      header.tsx
      message-list.tsx
      loading-bar.tsx
      text-input.tsx      ← 包装 Textarea + confirm 框
      footer.tsx
      textarea/
        constants.ts      ← TEXTAREA_ID, CHROME_ROWS, min/max height
        layout.ts         ← 纯函数：软换行、视觉行、viewport clamp
        edit.ts           ← 纯函数：segment 索引、↑↓ 列对齐、插入删除
        textarea.tsx      ← 自绘 caret、onKey、onLayout
  test/
    session-io.test.js
    view-model.test.js
    textarea/layout.test.js
    textarea/edit.test.js
    textarea/viewport.test.js
    key-dispatch.integration.test.js   ← onKey 必须为函数，不能是 false
```

---

## 4. 架构

```text
main.ts
  parseArgv → createViewModel → mountApp(vm) → setFocusHandler → createTuiSessionIO(vm)
  await runGameShell({ worldDir, io, autoStart, t: vm.t, ...shellOptions })
  mounted.dispose()

app.tsx（bindtty 五段纵向布局）
  Header
  MessageList      flex-grow，滚动
  LoadingBar
  TextInputArea    text 模式 + confirm 模式
  Footer

view-model.ts          session-io.ts
  UI signals    ←→     SessionIO Promise 桥接

@dayloom/core.runGameShell
```

**并发模型**：`runGameShell` 在 `main` 里 `await`；`readInput` / `confirm` 挂起 Promise 直到用户提交；同时只允许一个挂起输入。

---

## 5. ViewModel 规格

```ts
type TuiMessageRole = 'output' | 'warn' | 'error' | 'system';

interface TuiMessage {
  id: string;
  role: TuiMessageRole;
  text: string;
  ts: number;
}

interface ViewModel {
  worldDir: string;
  t: Translator;

  messages: Signal<readonly TuiMessage[]>;
  streamBuffer: Signal<string>;
  loadingLabel: Signal<string | null>;

  inputMode: Signal<'hidden' | 'text' | 'confirm'>;
  inputInstruction: Signal<string>;
  inputPrompt: Signal<string>;
  inputHint: Signal<string>;
  inputValue: Signal<string>;
  confirmQuestion: Signal<string>;

  headerPrimary: Signal<string>;
  headerSecondary: Signal<string>;
  headerActions: Signal<readonly string[]>;

  listHeight: Signal<number>;           // MessageList 可用行高
  stickToBottom: Signal<boolean>;
  inputViewportRows: Signal<number>;    // Textarea 视觉行数（影响 listHeight）
  inputResetToken: Signal<number>;      // 每次 beginInput 递增，重置光标

  appendMessage(role, text): void;
  appendStream(chunk): void;
  flushStream(): void;
  refreshHeader(): void;               // inspectTuiHeader → header*

  beginInput(options, resolve): void;
  beginConfirm(question, resolve): void;
  clearInput(): void;
  submitTextInput(): void;
  submitConfirm(answer): void;

  setStickToBottom(value): void;
  setInputViewportRows(rows): void;
}
```

**Header 刷新时机**：session 结束、`refreshHeader()` 被 shell 层调用后；**禁止**根据 phase 在 tui 内 `runPlay` 等。

**`resolveTuiInputCaption`**：把 core `instruction` 映射为 TUI 友好 caption（reply / message / shell prompt）。

---

## 6. `createTuiSessionIO(vm)` 规格

| SessionIO | TUI 行为 |
|-----------|----------|
| `write` | `appendMessage('output', text)` |
| `warn` | `appendMessage('warn', text)` |
| `error` | `appendMessage('error', text)` |
| `createStreamWriter` | `createFilteredStreamOutput` → `appendStream`；`flush` → `flushStream` |
| `readInput` | 见下节 |
| `confirm` | `beginConfirm` → Promise |
| `withLoading` | `loadingLabel` 置位 / `update` / `finally` 清空 |

### 6.1 `readInput`（关键）

```ts
async readInput(options: InputOptions): Promise<string | undefined> {
  while (true) {
    const text = await new Promise<string>((resolve) => {
      vm.beginInput(options, resolve);
    });
    const trimmed = text.trim();

    if (trimmed !== '') {
      return trimmed;
    }

    switch (options.emptyBehavior) {
      case 'ask-exit':
        if (await confirm(vm.t('input.emptyExit'))) {
          throw new InitCancelledError();
        }
        break;
      case 'ask-save-draft':
        if (await confirm(vm.t('input.emptySaveDraft'))) {
          return undefined;
        }
        break;
      case 'ignore':
        return undefined;
    }
  }
}
```

- 与 CLI 一致提交 `trim()` 后的文本给 core（含 `/revise` 等），**不得** `parseShellLevelCommand`
- 空输入由 `TuiSessionIO` 按 core 的 `emptyBehavior` 契约处理（与 cli-io 一致）：
  - `ask-exit` → confirm → `InitCancelledError`
  - `ask-save-draft` → confirm → `undefined`
  - `ignore` → `undefined`
- 提交：`Ctrl+Enter` / `Meta+Enter`（**不是**单独 Enter；Enter = 换行）
- `beginInput` 只负责显示输入区、重置 `inputValue` / `inputResetToken`、保存 resolver；不做程序化 focus
- 用户可通过 Tab / Shift+Tab 进入输入框；Textarea 获得焦点后必须正常处理输入
- `confirm(...)` 建议复用 `io.confirm` / `vm.beginConfirm`，避免在 `readInput` 里直接写 UI 分支

### 6.2 `withLoading` 与输入禁用

`loadingLabel !== null` 时 Textarea `disabled`；`onKey` 仍须为**函数**（内部 `if (disabled) return false`），不能绑定 `false`。

---

## 7. UI 布局

```text
┌─ Header ─────────────────────────────────────────────┐
│ World: ./world · day_0001 · playing                    │
│ Event title · [suggested actions]                      │
├─ MessageList (flex-grow, scroll) ──────────────────────┤
│ [output] narrative...                                  │
│ [warn]  preserved session path...                      │
├─ LoadingBar ───────────────────────────────────────────┤
│ ◐ label...                                             │
├─ TextInputArea ────────────────────────────────────────┤
│ instruction + multiline hint                           │
│ prompt > ┌ textarea (border, padding:1) ─────────────┐ │
│          │ 自绘反色 caret                             │ │
│          └──────────────────────────────────────────┘ │
├─ Footer ───────────────────────────────────────────────┤
│ commandHint                                            │
└────────────────────────────────────────────────────────┘
```

### 7.1 `CHROME_ROWS` 与动态高度

`listHeight = terminal.height - CHROME_ROWS - inputViewportRows`

- `CHROME_ROWS`：Header + hints + prompt + footer + loading + 边框等固定占用（曾用 `9`，需按实际渲染校准）
- Textarea `onViewportRowsChange` → `vm.setInputViewportRows` → 重算 `listHeight`

### 7.2 MessageList 焦点与按键

- `inputMode === 'hidden'` 时：`scrollOnArrow` 等 List 快捷键生效
- `inputMode === 'text'` 时：**不要**让 List 消费字母键；List `onKey` 仅在 hidden 模式处理方向键翻页
- Textarea 注册 `id="dayloom-textarea"`、`onKey`、`onFocusChange`

---

## 8. 自研 Textarea（不用 `@bindtty/widgets` TextInput 的原因）

多行、软换行、min/max 视觉行、滚动 viewport、自绘 caret 需求超出 widgets 单行 `TextInput`；第一版在 `components/textarea/` 用纯函数 + TSX 实现。

### 8.1 `layout.ts`（纯函数，可单测）

- `wordWrapLine(text, width)` — 按显示宽度软换行（东亚宽字符）
- `buildVisualLines(value, width)` — 全文视觉行数组
- `clampScrollRow(scroll, cursorRow, viewportRows, totalRows)` — 滚动窗口
- `splitCursorLine` — caret 同行 before / cursorChar / after（反色 `█` 或单字符反色）

### 8.2 `edit.ts`（纯函数，可单测）

- 逻辑行 / segment 索引与 UTF-16 偏移互转
- `insertText` / `deleteBackward` / `deleteForward`
- `moveCursorVertical` — ↑↓ 保持列宽对齐
- `insertNewline` — Enter 插入 `\n`

### 8.3 `textarea.tsx`（bindtty 组件）

| 属性 | 说明 |
|------|------|
| `value` / `onChange` | 受控文本 |
| `disabled` | loading 时 true |
| `minHeight` / `maxHeight` | 视觉行数 1–4 |
| `resetCursorToken` | beginInput 时重置光标到文末 |
| `onSubmit` | Ctrl+Enter |
| `onViewportRowsChange` | 高度变化回调 |
| `id` | 默认 `dayloom-textarea` |

**按键**：

| 键 | 行为 |
|----|------|
| 可打印字符 / IME | 插入（`acceptsTextInput`：有 `input` 或 readline `name==='a'` 等） |
| Enter | 换行 |
| Ctrl+Enter / Meta+Enter | `onSubmit` |
| Backspace / Delete | 删除 |
| ↑↓←→ | 移动光标（含软换行视觉行） |
| Tab | **不消费**（交给 bindtty 焦点遍历） |

**光标**：仅 `focused.get()` 时绘制反色块；`hideCursor: true` 下依赖此自绘。

**`onKey` 实现模式**：

```ts
function onKey(event: TerminalKeyEvent): boolean {
  if (props.disabled.get()) return false;
  return handleKey(event);
}
```

### 8.4 `text-input.tsx`

- `show when={inputMode==='text'}` 包裹 Textarea + instruction / hint / prompt
- `show when={inputMode==='confirm'}` 包裹带 `onKey` 的 confirm `box`（Y/N/Enter）
- `disabled = loadingLabel !== null`

---

## 9. `app.tsx` / `main.ts`

### 9.1 `mountApp(vm)`

```ts
const terminal = createNodeTerminal({
  stdout: process.stdout,
  stdin: process.stdin,
  useAltScreen: true,
  hideCursor: true,
  rawMode: true,
});

const app = createApp(
  <screen>
    <Header vm={vm} />
    <MessageList vm={vm} />
    <LoadingBar vm={vm} />
    <TextInputArea vm={vm} />
    <Footer vm={vm} />
  </screen>,
  { terminal },
);

app.start();

return { app, terminal, dispose: () => app.dispose() };
```

### 9.2 `main.ts` 启动序列

1. `parseArgv(process.argv)` — world-dir、help、`--locale`、`--no-auto-start`、dry-run 等透传 `GameShellOptions`
2. `createViewModel({ worldDir, locale })`
3. `mountApp(vm)`
4. `createTuiSessionIO(vm)`
5. `await runGameShell({ worldDir, io, autoStart: !noAutoStart, t: vm.t, ... })`
6. catch `InitCancelledError` → `io.error`（不 exit）
7. `dispose()` → `exit 0`

### 9.3 argv 建议

```
dayloom-tui <world-dir> [options]

  --locale <code>
  --no-auto-start
  --quick / --dry-run / --yes / ...（与 cli shell 对齐，透传 core）
  --help
```

---

## 10. 斜杠命令 UX（TUI 不新增命令）

| 场景 | core 处理 | TUI 表现 |
|------|-----------|----------|
| shell `/status` | runGameShell | 消息区追加概览 |
| shell `/help` | runGameShell | 命令表 |
| shell `/next` | runRecommendedAction | 进入 session |
| play `/revise` | SessionExit.shell-command | session 切换 |
| session `/help` | 各 loop | session 命令表 |
| 未知命令 | core 格式化 | 消息区提示 |

Footer 显示 `inputHint`（shell 或 session 的 `commandHint`）。

---

## 11. 实施分期（建议顺序）

### Phase A — bindtty 基线

- [x] 确认 `createNodeTerminal`、`createApp({ terminal })` 可构建接入
- [x] 真实 PTY E2E：Tab 聚焦输入区、输入 `/status`、验证 shell 输出、Ctrl+C 退出
- [ ] 验证：Shift+Tab 焦点遍历可用
- [ ] 手工验证：Textarea 获得焦点后中英文、退格、方向键、提交链路正常
- [x] 代码约束：MessageList 在 `inputMode === 'text'` 时不消费普通字母键

### Phase B — MVP（Phase 4）

- [x] 恢复 `view-model.ts`、`session-io.ts`、`argv.ts`
- [x] 恢复五组件 + `app.tsx` + `main.ts`
- [x] 落地简易自研多行 Textarea（Enter 换行 / Ctrl+Enter 提交）
- [x] `createTuiSessionIO` 单测：readInput Promise 循环、emptyBehavior 三分支、confirm、withLoading
- [x] Header：`inspectTuiHeader` + session 后 `refreshHeader`
- [x] 自动 smoke：真实 PTY 启动 `dayloom-tui <tmp-world> --no-auto-start` 并执行 `/status`

### Phase C — 多行 Textarea（Phase 5）

- [x] 恢复 `textarea/{layout,edit,textarea}.ts`
- [x] Enter 换行 / Ctrl+Enter 提交
- [ ] Textarea 软换行、视觉行光标移动、viewport clamp 完整单测
- [ ] 流式 `appendStream` throttle（~50ms）+ `stickToBottom`
- [ ] `inputViewportRows` 动态撑高 MessageList
- [ ] confirm 框样式与 Y/N 键

### Phase D — 打磨

- [ ] Windows Terminal 全流程：init → daily → play → settle；play 中 `/revise`
- [ ] i18n：`tui.input.multilineHint` 等；Windows 提交键文案
- [ ] SIGINT → dispose 全屏
- [ ] 全局错误边界：单 session 失败不崩 app
- [ ] 零 stderr 泄漏回归

---

## 12. 测试策略

| 层级 | 内容 |
|------|------|
| **layout / edit 单测** | 纯函数，无 bindtty |
| **session-io / view-model 单测** | mock VM |
| **key-dispatch 集成** | 证明 `onKey: false` 导致控件不进焦点环；必须为函数 |
| **真实 PTY E2E** | `dayloom-tui <tmp-world> --no-auto-start`，Tab 进入输入区后输入 `/status`，验证输出并 Ctrl+C 退出 |
| **不测** | 像素级渲染、真实 AI |

### 12.1 关键回归用例（第一版曾失败）

1. `beginInput` 后 Tab 进入 Textarea，再按 `a` → `inputValue === 'a'`
2. Backspace 清空
3. 中文 IME 连续输入
4. `onKey` 始终为函数；`disabled` 时内部返回 `false`，不从焦点环消失
5. `loadingLabel` 非空时按键无效，结束后恢复

---

## 13. 验收标准

- [x] `npm run build` / `npm test` 在 monorepo 根通过
- [ ] `dayloom-tui ./world` 全屏启动，stderr 无用户可见泄漏
- [ ] `runGameShell` 驱动全流程；tui 无 World 读写、phase 分支、AI import
- [ ] play `/revise` 经 `SessionExit`，非 TuiSessionIO 拦截
- [x] Tab 可进入输入区；自绘 caret 可见；边框不压字
- [ ] Shift+Tab 与连续 shell 命令后的焦点恢复仍需补强
- [ ] code review 通过硬约束（见 §1.2）

---

## 14. 第一版已删除代码摘要（供复现时对照）

实现曾达到的状态（**已从仓库删除**，勿指望 git 历史外残留）：

- `packages/tui/src/` 约 20+ 文件，39 个单测通过
- `@dayloom/tui@0.1.0-beta.5`
- examples：`examples/dayloom-tui/`（`run-tui.bat/sh`、`run-quick.*`）仍指向 `dayloom-tui`，可继续作 smoke 入口
- 调试曾用 `debug-log.ts` → `dayloom/debug-3f5de9.log`（NDJSON）；结论见 §0

**历史 bindtty 补丁（未发版）**：曾规划 `interaction.focus(id)` + `app.focus(target)` 来自动聚焦输入框；当前重做不再依赖此补丁。

---

## 15. 参考文件（仍在仓库）

| 路径 | 说明 |
|------|------|
| `packages/cli/src/session-io/cli-io.ts` | SessionIO 参考实现 |
| `packages/core/src/shell/index.ts` | `runGameShell` |
| `packages/core/src/session-io/types.ts` | 契约 |
| `packages/core/src/next/inspect-header.ts` | Header 数据 |
| `examples/dayloom-tui/README.md` | 示例启动方式 |
| 仓库根 `TODO.md` | Phase 4–6 总览 |

---

## 16. 开放问题

1. **bin 长期策略**：是否合并为 `dayloom` 默认 TUI — 另议  
2. **bindtty 版本锁定**：重做前确认当前锁定版本是否满足 terminal / interaction / widgets 基线能力
3. **Windows 非 Windows Terminal**：是否官方支持 classic conhost  
4. **是否复用 `@bindtty/widgets` List**：MessageList 曾用 widgets `List`；需确认滚动与焦点 coexist  
5. **locale**：复用 core `detectLocale`；argv `--locale` 覆盖

---

*文档版本：与实现删除同步。下一步从 §11 Phase A 开始。*
