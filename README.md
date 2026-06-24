# dayloom

dayloom 是一个以“天”为推进单位的 AI 生活模拟与日记生成工具。

这个仓库采用与 promptpile 类似的 monorepo 布局：

- [`packages/dayloom`](packages/dayloom/)：npm 包源码与 CLI。
- [`examples/dayloom-init-revise`](examples/dayloom-init-revise/)：初始化与设定修订示例。
- [`examples/dayloom-daily-play`](examples/dayloom-daily-play/)：每日推进、事件游玩与结算示例。

常用命令：

```bash
npm install
npm run build
npm test
```
