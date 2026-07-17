# @dayloom/tui

全屏终端 UI 入口（`dayloom-tui`），基于 [bindtty](https://www.npmjs.com/package/bindtty) `0.1.0-alpha.10` + `@dayloom/core.runGameShell`。

- 多行输入：**`@bindtty/widgets` `Textarea`**（Enter 换行，Ctrl+Enter 提交）
- 消息区：**`@bindtty/widgets` `VScrollView`**

**当前状态：Phase A–D 完成**。详见 **[TODO.md](./TODO.md)**（含 §11.1 手工全流程 smoke）。

```bash
npm run build -w @dayloom/tui
npm test -w @dayloom/tui
dayloom-tui ./world --no-auto-start
```

上层 monorepo 计划见仓库根目录 [TODO.md](../../TODO.md)。

## 开放体验 TODO

- 已完成：[自动聚焦输入区](../../TODO-autofocus-input.md)
- 已完成：[Confirm 获焦 chrome](../../TODO-confirm-focus-chrome.md)
- 已完成：[消息区标题获焦](../../TODO-message-list-focus.md)
- 已完成：[历史消息显示用户输入](../../TODO-user-message-history.md)
- 待做小改：[手动上滚时勿被 stickToBottom 拽回](../../TODO-stick-to-bottom-scroll.md)
- 待做大改：[Hub / Session 双页架构](../../TODO-hub-session-pages.md)
