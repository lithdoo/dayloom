# @dayloom/tui-old

> **Deprecated:** 该包仅用于迁移验证，不再承接新功能。正式 TUI 位于 [`packages/tui`](../tui/)。

全屏终端 UI 入口（`dayloom-tui-old`），基于 [bindtty](https://www.npmjs.com/package/bindtty) `0.1.0-alpha.10` + `@dayloom/core-old.runGameShell`。

- 多行输入：**`@bindtty/widgets` `Textarea`**（Enter 换行，Ctrl+Enter 提交）
- 消息区：**`@bindtty/widgets` `VScrollView`**

**当前状态：Phase A–D 完成**。详见 **[TODO.md](./TODO.md)**（含 §11.1 手工全流程 smoke）。

```bash
npm run build -w @dayloom/tui-old
npm test -w @dayloom/tui-old
dayloom-tui-old ./world --no-auto-start
```

旧拆包与体验改造计划保留在 Git 历史中。该包已经废弃，不再继续开放体验改造；正式设计以仓库根目录的 `AI_SESSION_REACT_DESIGN.md` 和 `@dayloom/tui` 文档为准。
