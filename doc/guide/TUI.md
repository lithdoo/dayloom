# TUI 使用指南

> **类型**：guide  
> **状态**：implemented  
> **最后核对**：2026-07

## 页面模型

TUI 只有两类页面：

```ts
type TuiPage =
  | { kind: 'hub'; mode: 'status' | 'help'; busy: TuiBusyState | null }
  | { kind: 'session'; sessionId: string; sessionKind: SessionKind };
```

Hub 是稳定边界页，Session 是对话页。Core snapshot 中存在 active Session 时，driver 投影为 Session 页；Session 结束后回到 Hub status。

## 页面布局

Hub：

```text
Header
MessageList (status/help)
LoadingBar
HubSelect
Footer
```

Session：

```text
Header
MessageList (conversation)
LoadingBar
TextInputArea
Footer
```

Header 与 Footer 只显示单行并截断过长文本，不因 world 路径、phase 或 loading 文本改变 chrome 高度。

## Hub

Hub 消息区有两个本地 mode：

- `status`：展示 world 路径、phase、day、初始化状态、最近结果和 command availability。
- `help`：展示 Hub 按键、Session 输入说明和当前不可用指令。

Hub action 分为：

- Core action：`init`、`daily`、`revise`、`play`、`settle`、`abandon-day`，只展示 Core 当前允许的项。
- Local action：`status`、`help`、`quit`，不调用 Core command。

Core action 稳定排序为 `init → daily → revise → play → settle → abandon-day`。默认推荐项由 phase 决定：

| Phase | 推荐 action |
|-------|-------------|
| `uninitialized` | `init` |
| `idle` | `daily` |
| `planned` | `play` |
| `awaiting-settle` | `settle` |

Hub 按键：

| 按键 | 行为 |
|------|------|
| `↑` / `↓` | 移动选中项 |
| `Enter` | 执行选中项 |
| `i` / `d` / `r` / `p` / `t` | 执行当前可用的 init/daily/revise/play/settle |
| `s` | 打开状态 |
| `?` | 打开帮助 |
| `q` | 退出 |

`abandon-day` 当前没有单字符快捷键。

## Session

普通非空文本会被 trim 后传给 `runtime.sendInput()`。AI 回复可以流式更新，但不会自动提交业务产物。

Session slash 指令：

| 指令 | 行为 |
|------|------|
| `/submit` | 执行 Core `submit` |
| `/exit` / `/cancel` | 执行 Core `cancel` 并回 Hub |
| `/status` / `/help` | 提示先回 Hub，不切换页面 |
| `/revise` | 提示回 Hub 选择修订流程 |
| 其它 `/...` | 追加本地未知指令提示 |

指令名不区分大小写；参数当前不解析。

## 输入和历史

- Textarea 最少 1 行、最多显示 4 行。
- `Ctrl+P` 访问上一条历史，`Ctrl+N` 访问下一条。
- 记忆最近 100 条非空输入，相邻重复项不重复保存。
- 从当前草稿进入历史后，回到历史尾部会恢复草稿。
- Session `submitting/completed/cancelled` 时禁用输入控件。
- streaming/loading/failed 期间仍保留高优先级取消指令的输入能力，但普通自然语言只在 `waiting-input` 时可接受。

## 焦点和滚动

- 进入 Hub 时自动聚焦 HubSelect。
- 进入 Session 时自动聚焦 Textarea。
- busy Hub 暂不尝试聚焦隐藏的 HubSelect。
- MessageList 可聚焦并使用滚动视图的方向键行为。
- 用户手动改变滚动 offset 后会关闭 stick-to-bottom。
- Hub mode 或 Session id 变化时，滚动 offset 归零并重新开启 stick-to-bottom。
