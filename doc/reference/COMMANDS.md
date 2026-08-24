# Commands 与状态

**状态**：Implemented
**最后核对**：2026-08-24

Core 的稳定动作是 `startSession('init' | 'planning' | 'play' | 'revise')`、`send(text)`、`submit()`、`cancel()`、`settle()` 与 `abandon()`。TUI 可把 planning 展示为 `daily`，但这只是界面词汇。

```text
uninitialized -- init/submit --> planned
idle -- planning/submit ------> planned
planned -- play/submit -------> awaiting-settle
awaiting-settle -- settle ----> idle
idle -- revise/submit --------> idle
planned | awaiting-settle -- abandon --> idle
```

实际可用性只读取 `CoreState.capabilities`。调用方不能仅根据 phase 猜测，也不能在 running/submitting 时自行启用控制。Session 内 `/submit`、`/cancel` 和 `/exit` 由 TUI 映射到上述 API；未知 slash 命令不进入 Core。
