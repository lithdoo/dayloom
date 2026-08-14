# TUI 使用指南

> **类型**：guide  
> **状态**：implemented  
> **最后核对**：2026-08

## 页面模型

TUI 只有两类页面：

```ts
type TuiPage =
  | { kind: 'hub'; mode: 'status' | 'help'; busy: TuiBusyState | null }
  | { kind: 'session'; sessionId: string; sessionKind: CoreSessionKind };
```

Hub 是稳定边界页，Session 是对话页。Core event 只同步事实；调用 Core2 API 的 Promise/CoreResult 与最终 `getState()` 决定页面切换，避免 transient event 提前切页。

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

- `status`：展示 world status/path、published title/revision/phase/day/lastSettledDay、最近结果和当前业务动作。
- `help`：展示可见快捷键、Session 输入和 running/submitting 行为。

Hub action 分为：

- Business action：`init`、`daily`、`revise`、`play`、`settle`、`abandon-day`，只展示 Core2 capabilities 当前允许的项。
- Local action：`status`、`help`、`quit`，不调用 Core2。

Business action 稳定排序为 `init → daily → revise → play → settle → abandon-day`。合法性只来自 capabilities；默认推荐按可见 action 的以下优先级决定：

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

普通非空文本会被 trim 后传给 `core.send()`，且只调用一次。AI 回复聚合在同一条 streaming message 中，但不会自动提交业务产物。

Session slash 指令：

| 指令 | 行为 |
|------|------|
| `/submit` | 执行 Core `submit` |
| `/exit` / `/cancel` | 执行 Core2 `cancel`；running 时中断 AI，并由 cancel 结果决定是否回 Hub |
| `/status` / `/help` | 提示先回 Hub，不切换页面 |
| `/revise` | 提示回 Hub 选择修订流程 |
| 其它 `/...` | 追加本地未知指令提示 |

指令名不区分大小写；参数当前不解析。

## 输入和历史

- Textarea 最少 1 行、最多显示 4 行。
- `Ctrl+P` 访问上一条历史，`Ctrl+N` 访问下一条。
- 记忆最近 100 条非空输入，相邻重复项不重复保存。
- 从当前草稿进入历史后，回到历史尾部会恢复草稿。
- Session `submitting/cancelling` 时禁用输入控件。
- `running` 时只保留高优先级 `/exit`、`/cancel`；普通文本和 `/submit` 仅产生本地提示。
- terminal failure 保留 failed transcript；此时 `/exit`、`/cancel` 只关闭展示，不调用 Core2，也不把最近结果改写为取消。

## 焦点和滚动

- 进入 Hub 时自动聚焦 HubSelect。
- 进入 Session 时自动聚焦 Textarea。
- busy Hub 暂不尝试聚焦隐藏的 HubSelect。
- MessageList 可聚焦并使用滚动视图的方向键行为。
- 用户手动改变滚动 offset 后会关闭 stick-to-bottom。
- Hub mode 或 Session id 变化时，滚动 offset 归零并重新开启 stick-to-bottom。
