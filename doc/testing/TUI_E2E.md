# TUI 测试与验收

> **类型**：testing
>
> **状态**：implemented
>
> **最后核对**：2026-08

```bash
npm run build -w @dayloom/archive-protocol
npm run test -w @dayloom/core2
npm run test -w @dayloom/tui
```

TUI 测试串行执行，包含三层证据：

1. Core2 headless suite 验证真实 application lifecycle、publication、compression 和 running-cancel theorem。
2. Scripted PTY 通过非公开入口注入 exact `DayloomCore`，复用 production driver、ViewModel、app 和组件，验证键盘、流式、失败、cancel、resize、focus 与 shutdown。
3. Production PTY smoke 启动真实 `dist/main.js → createDayloomCore()`，使用 empty World 和合法 caller TOML，只访问 Hub，不依赖外部 LLM。

Ubuntu required PTY job 设置 `DAYLOOM_TUI_REQUIRE_PTY=1`；`node-pty` 缺失会失败而不是 skip。其他本地环境缺失 optional dependency 时允许跳过 PTY，但 unit/guard 仍执行。

关键验收包括 capability-only Hub legality、pending topology freeze、stale completion guard、单条 assistant delta 聚合、partial failure transcript、running cancel/反向恢复、history/draft、scroll/stick、autofocus、resize、Ctrl+C、幂等 dispose，以及 empty → day2 planned 的 composed lifecycle。
