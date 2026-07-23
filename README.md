# dayloom

dayloom 是一个以“天”为推进单位的 AI 生活模拟与日记生成工具。

这个仓库采用 monorepo 布局：

- [`packages/core`](packages/core/)：正式状态机、Runtime 与 Session 引擎（`@dayloom/core`）
- [`packages/tui`](packages/tui/)：正式全屏 TUI（`@dayloom/tui`，`dayloom-tui`）
- [`packages/cli`](packages/cli/)：现有 `dayloom` CLI；迁移期间仍依赖 `@dayloom/core-old`
- [`packages/core-old`](packages/core-old/)：旧引擎，仅为 CLI 和迁移验证保留，准备弃用
- [`packages/tui-old`](packages/tui-old/)：旧全屏 TUI（`dayloom-tui-old`），准备弃用
- [`examples/dayloom-tui`](examples/dayloom-tui/)：新旧 TUI 启动示例

`core-old` 与 `tui-old` 不再承接新功能；后续应先迁移 CLI，再删除这两个旧包。

常用命令（在 monorepo 根目录）：

```bash
npm install
npm run build
npm test
```

CLI 由 `@dayloom/cli` 提供；交互命令通过 `createCliSessionIO()` 注入 `SessionIO`。根目录 `npm install` 后可用 `npx dayloom`。

统一 shell 入口（支持 `/status`、`/next`、`/revise` 等斜杠命令路由）：

```bash
npx dayloom shell -d ./world
```
