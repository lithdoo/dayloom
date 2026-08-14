# @dayloom/tui

> **类型**：package  
> **状态**：implemented  
> **最后核对**：2026-07  
> **代码入口**：`packages/tui/src/index.ts`、`packages/tui/src/main.ts`

> **类型**：package  
> **状态**：implemented  
> **最后核对**：2026-07  
> **代码入口**：`packages/tui/src/index.ts`、`packages/tui/src/main.ts`

## 目标与边界

TUI 是 Core Runtime 的交互 driver，而不是另一个业务引擎。

```text
Terminal / BindTTY
        |
      App + Components
        |
      ViewModel
        |
   TuiRuntimeDriver
        |
  @dayloom/core Runtime
        |
 Archive + Sessions + AI
```

TUI 负责：

- Hub/Session 页面和终端布局；
- 快捷键、slash 语法、焦点、滚动和输入历史；
- Runtime snapshot/event 到可渲染状态的投影；
- assistant 消息聚合与本地提示；
- 终端资源和 Runtime 生命周期。

TUI 不负责：

- 判断 world phase 或 command 是否可用；
- 实现 submit/cancel/settle 的业务转移；
- 直接修改 archive；
- 解析 AI 输出文本来推断业务状态；
- 替 Core 选择下一步流程。

## 模块职责

| 模块 | 职责 |
|------|------|
| `main.ts` | argv、路径解析、组装和 shutdown |
| `app.tsx` | 终端创建、布局、resize、Ctrl+C 和 autofocus |
| `runtime-driver/` | Core Runtime 组装、event 投影、Hub action 与 slash 路由 |
| `view-model.ts` | 响应式可见状态、输入历史、滚动和页面衍生值 |
| `hub/actions.ts` | Core availability 到 Hub action 的确定投影 |
| `hub/content.ts` | Hub status/help 文本格式化 |
| `components/` | 纯展示和局部按键处理 |
| `message-history.ts` | RuntimeMessage 到 TUI message 的窄化转换 |
| `theme.ts` | phase/session/command/role 的显示标签和颜色 |
| `types.ts` | TUI 页面、driver state 和 action 合约 |

## 状态所有权

| 状态 | 所有者 |
|------|--------|
| world phase/day/revision/invalid | Core Runtime snapshot |
| active Session kind/status/input/loading | Core Runtime snapshot |
| command availability | Core 状态机 |
| Hub status/help mode | TUI driver |
| Hub 选中项 | TUI driver |
| 最近操作结果 | TUI driver |
| 页面投影 | TUI driver，由 active Session 校正 |
| 输入值与历史 | ViewModel |
| viewport、scroll offset、stick-to-bottom | ViewModel |
| 聚焦节点 | BindTTY app，由 autofocus 协调 |

## 状态流

```text
Core snapshot/event
  → TuiRuntimeDriver 更新 TuiDriverState
  → driver subscriber 更新 ViewModel signal
  → computed 生成 header/messages/loading/input flags
  → BindTTY 组件重绘
```

用户操作反向流动：

```text
key / textarea submit
  → component
  → ViewModel method
  → TuiRuntimeDriver method
  → Runtime sendInput/executeCommand
```

## 布局与可变高度

App 使用 alt screen、raw mode、隐藏终端光标和 enhanced keyboard。窗口变化时，可用消息区高度按以下关系重算：

```text
listHeight = max(3, terminalHeight - CHROME_ROWS - inputViewportRows)
```

Textarea 的 viewport rows 变化会立即触发同一布局同步，保证多行输入不会直接挤出屏幕。

## 扩展原则

- 新业务 action 必须先在 Core command/availability 中存在，再加入 Hub 投影顺序和展示文案。
- 新页面会改变 `TuiPage` union、driver projection、autofocus 和 PTY 验收，需要作为完整垂直切片实现。
- 本地 slash 指令不应透传给 Session AI。
- 新 RuntimeEvent 只在能影响显示状态时才需要 driver 分支；不需要的事件可安全忽略。

## Runtime driver 合约

```ts
interface TuiRuntimeDriver {
  getState(): TuiDriverState;
  subscribe(listener: (state: TuiDriverState) => void): () => void;
  runHubAction(actionId: string): Promise<'continue' | 'exit'>;
  submitSessionText(text: string): Promise<void>;
  setHubMode(mode: HubMode): void;
  selectHubAction(actionId: string): void;
  dispose(): Promise<void>;
}
```

driver 默认组装 ArchiveRepository、Archive Session read model、Promptpile conversation client、natural-language Session factory 和 DayloomRuntime。测试可注入现成 Runtime 或 SessionFactory。

RuntimeEvent 到 UI 的主要投影：

- message/assistant 事件进入 MessageStore；
- loading 事件更新 Hub/Session loading；
- command failure/rejection 更新 recent result；
- Session 结束后记录 completed/cancelled 并回到 Hub；
- 每个 RuntimeEvent 后重新读取 snapshot 和 availability，避免本地页面与 Core 漂移。

## 构建与测试

```bash
npm run build -w @dayloom/core -w @dayloom/tui
npm run test -w @dayloom/tui
```

用户行为见 [TUI 使用指南](/guide/TUI)，真实终端验收见 [TUI E2E](/testing/TUI_E2E)。

## Runtime driver 合约

```ts
interface TuiRuntimeDriver {
  getState(): TuiDriverState;
  subscribe(listener: (state: TuiDriverState) => void): () => void;
  runHubAction(actionId: string): Promise<'continue' | 'exit'>;
  submitSessionText(text: string): Promise<void>;
  setHubMode(mode: HubMode): void;
  selectHubAction(actionId: string): void;
  dispose(): Promise<void>;
}
```

driver 默认组装 ArchiveRepository、Archive Session read model、Promptpile conversation client、natural-language Session factory 和 DayloomRuntime。测试可注入现成 Runtime 或 SessionFactory。

RuntimeEvent 到 UI 的主要投影：

- message/assistant 事件进入 MessageStore；
- loading 事件更新 Hub/Session loading；
- command failure/rejection 更新 recent result；
- Session 结束后记录 completed/cancelled 并回到 Hub；
- 每个 RuntimeEvent 后重新读取 snapshot 和 availability，避免本地页面与 Core 漂移。

## 构建与测试

```bash
npm run build -w @dayloom/core -w @dayloom/tui
npm run test -w @dayloom/tui
```

用户行为见 [TUI 使用指南](/guide/TUI)，真实终端验收见 [TUI E2E](/testing/TUI_E2E)。
