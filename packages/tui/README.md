# @dayloom/tui

全屏终端 UI 入口（`dayloom-tui`），基于 [bindtty](https://www.npmjs.com/package/bindtty) + `@dayloom/core.runGameShell`。

当前状态：MVP 已恢复。TUI 负责全屏布局、消息区、loading、文本输入、确认框与 `SessionIO` 适配；业务流程仍全部由 `@dayloom/core.runGameShell` 驱动。

```bash
# 构建
npm run build -w @dayloom/tui

# 测试
npm test -w @dayloom/tui

# 启动
dayloom-tui ./world
```

测试包含真实 PTY E2E：自动启动 `dayloom-tui`、Tab 聚焦输入区、输入 `/status`、验证 shell 输出，并用 Ctrl+C 退出。

输入区不依赖程序化自动聚焦；使用 Tab / Shift+Tab 在消息区、输入区、确认框之间移动焦点。文本输入中 Enter 换行，Ctrl+Enter 或 Meta+Enter 提交。单行斜杠命令也可用 Enter 提交，便于终端兼容与自动化测试。

完整设计、已知问题与后续实施计划见 **[TODO.md](./TODO.md)**。

上层 monorepo 计划见仓库根目录 [TODO.md](../../TODO.md)。
