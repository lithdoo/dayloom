# @dayloom/tui

全屏终端 UI 入口（`dayloom-tui`），基于 [bindtty](https://www.npmjs.com/package/bindtty) `0.1.0-alpha.6` + `@dayloom/core.runGameShell`。

- 多行输入：**`@bindtty/widgets` `Textarea`**（Enter 换行，Ctrl+Enter 提交）
- 消息区：**`@bindtty/widgets` `ScrollView`**

**当前状态：Phase A–D 完成**。详见 **[TODO.md](./TODO.md)**（含 §11.1 手工全流程 smoke）。

```bash
npm run build -w @dayloom/tui
npm test -w @dayloom/tui
dayloom-tui ./world --no-auto-start
```

上层 monorepo 计划见仓库根目录 [TODO.md](../../TODO.md)。
