# dayloom

dayloom 是一个以“天”为推进单位的 AI 生活模拟与日记生成工具。

这个仓库采用 monorepo 布局（Phase 1：`@dayloom/core` + `@dayloom/cli`；`@dayloom/tui` 见 [TODO.md](TODO.md)）：

- [`packages/core`](packages/core/)：引擎 API、prompts、测试（`@dayloom/core`）
- [`packages/cli`](packages/cli/)：`dayloom` CLI（`@dayloom/cli`）
- [`examples/dayloom-init-revise`](examples/dayloom-init-revise/)：初始化与设定修订示例
- [`examples/dayloom-daily-play`](examples/dayloom-daily-play/)：每日推进、事件游玩与结算示例

常用命令（在 monorepo 根目录）：

```bash
npm install
npm run build
npm test
```

CLI 由 `@dayloom/cli` 提供；根目录 `npm install` 后可用 `npx dayloom`。
