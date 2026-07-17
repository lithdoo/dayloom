# @dayloom/tui 实施 TODO

> **状态（2026-07）**：**Phase A–D 完成**（bindtty 基线 + SessionIO + 流式 throttle + i18n/错误边界/stderr 回归）。全流程 AI smoke 见 §11.1 手工清单。
> 上层三包拆分计划见仓库根目录 [TODO.md](../../TODO.md)；`@dayloom/core` 与 `@dayloom/cli` **不受影响**。

---

## 0. 为什么要重做

第一版实现完成了 bindtty 布局、`createTuiSessionIO`、`runGameShell` 接入，并曾在应用内**自研**多行 Textarea（后已废弃）。第二版验证过 `@bindtty/widgets` `Textarea` + `ScrollView` 路径可行；后续已补齐消息区焦点 chrome、Confirm chrome、用户输入回显与输入区自动聚焦。

已完成的历史焦点问题：

- `beginInput` / `beginConfirm` 后自动聚焦 Textarea / Confirm（见根目录 `TODO-autofocus-input.md`）
- MessageList 获焦改为标题反馈，正文不再整区反色（见根目录 `TODO-message-list-focus.md`）
- Confirm 获焦使用标题 chrome，并保留 Y/N/Enter 行为（见根目录 `TODO-confirm-focus-chrome.md`）
- 用户提交后历史显示 `[YOU]`（见根目录 `TODO-user-message-history.md`）
- Ctrl+C / Kitty ctrl+c 路径已由 `isCtrlC` + `main.ts` SIGINT 处理
- 多行提交文案已统一为 Ctrl+Enter / macOS Meta+Enter，不再出现 Ctrl+Z 误导

仍需跟踪的体验项：

- 系统终端光标被 `hideCursor: true` 关闭；反色 caret 由 **`@bindtty/widgets` `Textarea`** 自绘，dayloom 不再维护 `components/textarea/`
- `onKey: computed(() => disabled ? false : handler)` 在 disabled 时会把 handler 设为 `false`，导致 bindtty **不注册焦点项**——应用函数包装并内部判断 `disabled`
- 手动上滚时是否应暂停 stick-to-bottom（见根目录 `TODO-stick-to-bottom-scroll.md`）
- Hub / Session 双页架构是大改动，规格另跟踪（见根目录 `TODO-hub-session-pages.md`）

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
  "bindtty": "^0.1.0-alpha.10",
  "@bindtty/terminal": "^0.1.0-alpha.10",
  "@bindtty/interaction": "^0.1.0-alpha.10",
  "@bindtty/widgets": "^0.1.0-alpha.10"
}
```

> **版本**：使用 **bindtty `0.1.0-alpha.10`** 系列（含 CJK 感知 soft wrap、Textarea flex 软折行 / 空行 caret、ScrollView `focusStyle`、`app.focus` / element `focus()`）。规格见 bindtty `packages/widgets/TEXTAREA.md`。

### 2.2 bindtty 侧**必须先有**的能力

| 能力 | 用途 | 备注 |
|------|------|------|
| `createNodeTerminal({ rawMode, useAltScreen, hideCursor, stdinInputAdapter })` | 全屏 raw 输入 | 建议 `RawStdinInput` + `enhancedKeyboard` |
| `createApp(view, { terminal })` → `start` / `dispose` | 根应用 | |
| `interaction` 焦点遍历 Tab / Shift+Tab | 输入框、列表、确认框之间切换焦点 | MVP 依赖此能力 |
| `@bindtty/widgets` **`Textarea`** | 多行受控输入、软换行、Ctrl+Enter 提交 | **禁止**在 dayloom 内自研 `layout.ts` / `edit.ts` |
| `@bindtty/widgets` **`VScrollView`** | 消息区纵向滚动、`stickToBottom` | `scrollOnArrow` 仅在 `inputMode === 'hidden'` |
| intrinsic：`screen` `vstack` `hstack` `box` `text` `show` `for` | 布局 | |
| `createSignal` / `computed` | ViewModel | 与 widgets 共用 signal 实例 |
| JSX：`jsxImportSource: "bindtty"` | TSX 组件 | `Textarea` 从 `@bindtty/widgets` 导入 |

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
      constants.ts        ← TEXTAREA_ID、CHROME_ROWS
      header.tsx
      message-list.tsx    ← VScrollView 包装消息
      loading-bar.tsx
      text-input.tsx      ← @bindtty/widgets Textarea + confirm 框
      footer.tsx
  test/
    session-io.test.js
    view-model.test.js
    argv.test.js
    key-dispatch.integration.test.js   ← onKey 必须为函数，不能是 false
    e2e-real-terminal.test.js          ← PTY：Tab 聚焦、/status、Ctrl+C
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
  appendStream(chunk): void;            // 首包立即显示，其后 ~50ms 合并；并 stickToBottom=true
  flushStream(): void;                  // 立即冲刷 pending + 将 streamBuffer 落成 output 消息
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
- `beginInput` 只负责显示输入区、重置 `inputValue` / `inputResetToken`、保存 resolver；程序化 focus 由 `mountApp` 订阅 `inputMode` 后调用 `app.focus(TEXTAREA_ID)` 完成
- 用户可通过 Tab / Shift+Tab 手动遍历 MessageList / Textarea / Confirm；Textarea 获得焦点后必须正常处理输入
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
│ prompt > ┌ @bindtty/widgets Textarea ─────────────────┐ │
│          │ 软换行、自绘 caret（widget 内）             │ │
│          └──────────────────────────────────────────┘ │
├─ Footer ───────────────────────────────────────────────┤
│ commandHint                                            │
└────────────────────────────────────────────────────────┘
```

### 7.1 `CHROME_ROWS` 与动态高度

`listHeight = terminal.height - CHROME_ROWS - inputViewportRows`

- `CHROME_ROWS`：Header + hints + prompt + footer + loading 等固定占用（曾用 `9`，需按实际渲染校准）
- `@bindtty/widgets` `Textarea` 的 `onViewportRowsChange` → `vm.setInputViewportRows` → 重算 `listHeight`

### 7.2 MessageList 与 Textarea 焦点

**MessageList**（`message-list.tsx`）：

```tsx
import { ScrollView } from '@bindtty/widgets';

const scrollOnArrow = computed(() => vm.inputMode.get() === 'hidden');

<ScrollView
  width={vm.viewportWidth}
  height={vm.listHeight}
  border={false}
  padding={0}
  stickToBottom={vm.stickToBottom}
  scrollOnArrow={scrollOnArrow}
  showScrollbar={{ vertical: true, horizontal: false }}
>
  {/* <for each={vm.visibleMessages}> ... */}
</ScrollView>
```

- `inputMode === 'hidden'`：`scrollOnArrow` 为 true，方向键翻页消息
- `inputMode === 'text'`：`scrollOnArrow` 为 false，避免 ScrollView 与 Textarea 抢键

**Textarea**（`text-input.tsx`）：

- 从 `@bindtty/widgets` 导入 `Textarea`（**不是** `bindtty` 根包、**不是**单行 `TextInput`）
- 注册 `id={TEXTAREA_ID}`（如 `dayloom-textarea`）供 E2E / 调试定位
- Tab 不消费（widget 内 `event.name === 'tab'` → `return false`），交给 bindtty 焦点遍历

---

## 8. `@bindtty/widgets` Textarea 接入

多行、软换行、动态 `minRows`/`maxRows`、viewport 滚动、自绘 caret、grapheme 编辑均由 **`@bindtty/widgets` `Textarea`** 提供。dayloom **不再**维护 `components/textarea/` 或复制 bindtty 的 `layout.ts` / `edit.ts` / `render.ts`。

规格与按键矩阵以 bindtty 为准：`bindtty/packages/widgets/TEXTAREA.md`（代码：`packages/widgets/src/textarea/`）。

### 8.1 为何不用单行 `TextInput`

| 需求 | `TextInput` | `Textarea` |
|------|-------------|------------|
| Enter | 常作提交 | **换行** |
| 多行高度 | 固定单行 | `minRows`–`maxRows` 动态 |
| 软换行 / ↑↓ 视觉行 | 无 | 有 |
| 提交 | Enter | **Ctrl+Enter** / **Meta+Enter**（默认） |

### 8.2 `text-input.tsx` 接线（受控模型）

```tsx
import { computed } from 'bindtty';
import { Textarea } from '@bindtty/widgets';
import { TEXTAREA_ID } from './constants.js';

export function TextInputArea(props: { vm: ViewModel }) {
  const disabled = computed(() => props.vm.loadingLabel.get() !== null);

  return (
    <vstack gap={0}>
      <show when={computed(() => props.vm.inputMode.get() === 'text')}>
        <text value={props.vm.inputInstruction} wrap="truncate-end" color="gray" />
        <text value={props.vm.t('tui.input.multilineHint')} wrap="truncate-end" color="gray" />
        <hstack gap={0}>
          <text value={props.vm.inputPrompt} />
          <box flexGrow={1}>
            <Textarea
              id={TEXTAREA_ID}
              value={props.vm.inputValue}
              disabled={disabled}
              minRows={1}
              maxRows={4}
              resetCursorToken={props.vm.inputResetToken}
              onChange={(value) => props.vm.inputValue.set(value)}
              onSubmit={() => props.vm.submitTextInput()}
              onViewportRowsChange={(rows) => props.vm.setInputViewportRows(rows)}
            />
          </box>
        </hstack>
      </show>
      {/* confirm 模式：独立 box + onKey，见 §8.4 */}
    </vstack>
  );
}
```

| Prop | dayloom 用法 |
|------|----------------|
| `value` | `vm.inputValue` signal |
| `onChange` | 写回 `inputValue` |
| `onSubmit` | `vm.submitTextInput()` → resolve `readInput` Promise |
| `disabled` | `loadingLabel !== null`；**必须**传 signal/computed，勿用 `onKey: false` |
| `minRows` / `maxRows` | 默认 1–4 行，与 `CHROME_ROWS` / `listHeight` 联动 |
| `resetCursorToken` | 每次 `beginInput` 递增，光标重置到文末 |
| `onViewportRowsChange` | 驱动 `vm.setInputViewportRows` → `syncLayout` 重算消息区高度 |
| `submitKeys` | 默认 `ctrl-enter` + `meta-enter`；一般无需覆盖 |

### 8.3 ViewModel 与 SessionIO 衔接

```ts
beginInput(options, resolve) {
  this.inputMode.set('text');
  this.inputInstruction.set(resolveTuiInputCaption(options));
  this.inputPrompt.set(options.prompt ?? '> ');
  this.inputValue.set('');
  this.inputResetToken.set(this.inputResetToken.get() + 1);
  this._inputResolver = resolve;
}

submitTextInput() {
  const resolve = this._inputResolver;
  if (!resolve) return;
  this._inputResolver = undefined;
  this.inputMode.set('hidden');
  resolve(this.inputValue.get());
}
```

- `readInput` 仍对 core 返回 `trim()` 后文本（见 §6.1）
- **Enter** = 换行（widget 处理）；**Ctrl+Enter** = 提交（`onSubmit`）
- `beginInput` 不做程序化 `app.focus()`；用户 Tab 进入 Textarea

### 8.4 Confirm 框（非 Textarea）

`inputMode === 'confirm'` 时用带 `onKey` 的 `box`（Y / N / Enter），与 Textarea 并列放在 `text-input.tsx`：

```ts
function onKey(event: TerminalKeyEvent): boolean {
  if (disabled.get()) return false;
  // y / n / return → submitConfirm
  return true;
}
```

`onKey` 必须是**函数**；`disabled` 时在函数内 `return false`。

### 8.5 `disabled` 与焦点环

bindtty `Textarea` 在 `disabled` 时：

- 仍留在焦点环（`onKey` 为函数）
- 编辑键无效；Up/Down/PageUp/PageDown 可滚动查看已有内容

dayloom **禁止**写 `onKey={disabled ? false : handler}` 或 `computed(() => disabled ? false : handler)`——会导致控件从焦点环消失（§0 踩坑）。

### 8.6 测试分工

| 测什么 | 在哪测 |
|--------|--------|
| 软换行、grapheme、↑↓ 列对齐、viewport clamp | **bindtty** `packages/widgets/test/textarea.test.ts` |
| `readInput` / `emptyBehavior` / `withLoading` | dayloom `session-io.test.js` |
| Tab 聚焦、PTY 输入、`/status`、Ctrl+C | dayloom `e2e-real-terminal.test.js` |

---

## 9. `app.tsx` / `main.ts`

### 9.1 `mountApp(vm)`

```ts
import { createApp } from 'bindtty';
import { createNodeTerminal, RawStdinInput } from '@bindtty/terminal';

const terminal = createNodeTerminal({
  stdout: process.stdout,
  stdin: process.stdin,
  useAltScreen: true,
  hideCursor: true,
  rawMode: true,
  exitOnCtrlC: false,
  enhancedKeyboard: true,
  stdinInputAdapter: new RawStdinInput(),
});

function syncLayout(): void {
  vm.viewportWidth.set(terminal.viewport.width);
  vm.listHeight.set(
    Math.max(3, terminal.viewport.height - CHROME_ROWS - vm.inputViewportRows.get()),
  );
}

const unsubscribeExitKey = terminal.onKey((event) => {
  if (isCtrlC(event)) {
    options.onExitRequest?.();
  }
});

const app = createApp(
  <screen gap={0} alignItems="stretch">
    <Header vm={vm} />
    <MessageList vm={vm} />
    <LoadingBar vm={vm} />
    <TextInputArea vm={vm} />
    <Footer vm={vm} />
  </screen>,
  { terminal },
);

app.start();

return {
  dispose() {
    unsubscribeExitKey();
    app.dispose();
  },
};

/** Kitty 协议下 Ctrl+C 可能无 name，仅 input:'c' + ctrl */
function isCtrlC(event: TerminalKeyEvent): boolean {
  return Boolean(
    event.ctrl &&
      (event.name === 'c' || event.input === '\x03' || event.input === 'c'),
  );
}
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
- [x] 验证：Shift+Tab 焦点遍历可用（PTY E2E）
- [x] 手工验证：Textarea 获得焦点后中英文、退格、方向键、提交链路正常（PTY：Enter 换行 + Ctrl+Enter `/status`）
- [x] 代码约束：MessageList 在 `inputMode === 'text'` 时不消费普通字母键（`scrollOnArrow` 单测）

### Phase B — MVP（Phase 4）

- [x] 恢复 `view-model.ts`、`session-io.ts`、`argv.ts`
- [x] 恢复五组件 + `app.tsx` + `main.ts`
- [x] 接入 `@bindtty/widgets` `Textarea`（Enter 换行 / Ctrl+Enter 提交）
- [x] `createTuiSessionIO` 单测：readInput Promise 循环、emptyBehavior 三分支、confirm、withLoading
- [x] Header：`inspectTuiHeader` + session 后 `refreshHeader`
- [x] 自动 smoke：真实 PTY 启动 `dayloom-tui <tmp-world> --no-auto-start` 并执行 `/status`

### Phase C — 体验（Phase 5）

- [x] 消息区 `@bindtty/widgets` `VScrollView` + `stickToBottom`
- [x] `Textarea`：`minRows`/`maxRows` 与 `onViewportRowsChange` 驱动 `listHeight`
- [x] 流式 `appendStream` throttle（~50ms）+ `stickToBottom`
- [x] confirm 框样式与 Y/N 键
- [x] Ctrl+C / SIGINT → `dispose` 全屏（`isCtrlC` 兼容 Kitty 序列，见 §9.1）

### Phase D — 打磨

- [x] Windows Terminal 全流程：init → daily → play → settle；play 中 `/revise`（架构 + 自动回归已覆盖；含 API 的端到端见 §11.1）
- [x] i18n：`tui.input.multilineHint`（Win/Linux vs darwin）+ `tui.footer.*`
- [x] 全局错误边界：单 session 失败不崩 app（`runGameShell` 循环 catch + routing；TUI 经 `io.error`）
- [x] 零 stderr 泄漏回归（SessionIO / `/revise` 失败路径单测）

### 11.1 手工全流程 smoke（需 `DEEPSEEK_API_KEY`）

在 Windows Terminal 中：

```bash
npm run build -w @dayloom/tui
npx dayloom-tui ./world
```

1. 输入提示出现后无需 Tab，直接输入 `/status`；确认 multiline hint **无 Ctrl+Z**（TUI 用 Ctrl+Enter 发送）
2. `/status` → 顶栏与消息区更新
3. `/next` 走 init → daily → play → settle（按推荐操作确认）
4. play 中输入 `/revise` → 进入修订会话；`/exit` 或完成后回到 shell（经 `SessionExit`，非 TuiSessionIO 拦截）
5. 故意触发错误（如临时去掉 API key 再 `/revise`）→ 错误出现在消息区 **ERR**，shell 仍可 `/status`
6. Ctrl+C 干净退出；真实 stderr 无用户可见泄漏

---

## 12. 测试策略

| 层级 | 内容 |
|------|------|
| **bindtty widgets 单测** | `Textarea` 编辑/软换行/grapheme（`@bindtty/widgets`，非 dayloom） |
| **session-io / view-model 单测** | mock VM |
| **key-dispatch 集成** | 证明 `onKey: false` 导致控件不进焦点环；必须为函数 |
| **真实 PTY E2E** | `dayloom-tui <tmp-world> --no-auto-start`，自动聚焦 Textarea 后输入 `/status`，Confirm 直接 y/n，Ctrl+C 退出 |
| **不测** | 像素级渲染、真实 AI |

### 12.1 关键回归用例（第一版曾失败）

1. `beginInput` 后无需 Tab，直接按 `a` → `inputValue === 'a'`
2. Backspace 清空
3. 中文 IME 连续输入
4. `onKey` 始终为函数；`disabled` 时内部返回 `false`，不从焦点环消失
5. `loadingLabel` 非空时按键无效，结束后恢复

---

## 13. 验收标准

- [x] `npm run build` / `npm test` 在 `@dayloom/tui` 通过（含 PTY / SessionIO / throttle / stderr）
- [x] 运行期用户可见错误走 `io.error`，不写真实 stderr（bootstrap 除外）
- [x] `runGameShell` 驱动全流程；tui 无 World 读写、phase 分支、AI import
- [x] play `/revise` 经 `SessionExit` / `handleShellCommand`，非 TuiSessionIO 拦截（`shell-recovery.test.js`）
- [x] 自动聚焦可进入 `@bindtty/widgets` Textarea / Confirm；Tab / Shift+Tab 手动遍历仍可用；caret / 软折行 / ScrollView `focusStyle` / CJK wrap 依赖 bindtty `0.1.0-alpha.10`
- [x] Shift+Tab 与连续 shell 命令后的焦点恢复已由 PTY E2E 覆盖（见 `TODO-autofocus-input.md`）
- [x] code review 通过硬约束（见 §1.2）

---

## 14. 已删除代码摘要（供复现时对照）

实现曾达到的状态（**已从仓库删除**，可参考 git 历史 `5c637b9` 及更早提交）：

- 第二版：`@bindtty/widgets` `Textarea` + `ScrollView`，约 12 个单测
- 第一版：应用内自研 `components/textarea/`（**已废弃**，勿复刻）
- `@dayloom/tui@0.1.0-beta.5`
- examples：`examples/dayloom-tui/`（`run-tui.bat/sh`、`run-quick.*`）仍指向 `dayloom-tui`，可继续作 smoke 入口
- 调试曾用 `debug-log.ts` → `dayloom/debug-3f5de9.log`（NDJSON）；结论见 §0

**历史 bindtty 补丁**：曾规划 `interaction.focus(id)` + `app.focus(target)` 来自动聚焦输入框；该能力已在 bindtty `0.1.0-alpha.10` 发布，dayloom 已接入。

---

## 15. 参考文件（仍在仓库）

| 路径 | 说明 |
|------|------|
| `packages/cli/src/session-io/cli-io.ts` | SessionIO 参考实现 |
| `packages/core/src/shell/index.ts` | `runGameShell` |
| `packages/core/src/session-io/types.ts` | 契约 |
| `packages/core/src/next/inspect-header.ts` | Header 数据 |
| `bindtty/packages/widgets/TEXTAREA.md` | **Textarea** widget 规格与按键矩阵 |
| `bindtty/packages/widgets/src/textarea/` | Textarea 实现（layout / edit / render） |
| `examples/dayloom-tui/README.md` | 示例启动方式 |
| 仓库根 `TODO.md` | Phase 4–6 总览 |

---

## 16. 开放问题

1. **bin 长期策略**：是否合并为 `dayloom` 默认 TUI — 另议  
2. **bindtty 版本**：使用 **`0.1.0-alpha.10`** 系列（含 CJK soft wrap、Textarea flex 软折行、空行 caret、ScrollView `focusStyle`、程序化 focus）；本地开发可用 `file:../../../bindtty/packages/*`（sibling 仓库须保持兼容版本）
3. **Windows 非 Windows Terminal**：是否官方支持 classic conhost  
4. **VScrollView vs widgets List**：消息区已选 `VScrollView`；勿再引入 List 与 Textarea 焦点冲突
5. **locale**：复用 core `detectLocale`；argv `--locale` 覆盖

---

*文档版本：Phase A–D 完成；输入区以 `@bindtty/widgets` Textarea 为准。含 API 的全流程手工 smoke 见 §11.1。*
