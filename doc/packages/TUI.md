# @dayloom/tui

> **类型**：package
>
> **状态**：implemented
>
> **最后核对**：2026-08
>
> **代码入口**：`packages/tui/src/index.ts`、`packages/tui/src/main.ts`

## 目标与边界

TUI 是 `@dayloom/core` 的 presentation driver，不是第二个业务引擎。

```text
Terminal / BindTTY → Components → ViewModel → TUI driver → @dayloom/core
```

Core 独占 World/Session truth、capabilities、publication、active-agent cancellation 和 terminal result。TUI 负责 Hub/Session 两页、产品词汇、一个当前 transcript、pending/recent 展示、快捷键、输入历史、滚动、焦点和 resize。

生产 driver 只从 Core package root 导入并创建 concrete `DayloomCore`。测试 seam 位于非 package-root 模块，只接受 exact `DayloomCore`；生产导出中没有 backend/provider/facade。

## 投影规则

- Hub legality 只来自 `CoreState.capabilities`；`daily` 映射 `startSession('planning')`。
- Core event 同步事实，Core call 的 Promise/CoreResult 加最终 `getState()` 决定页面边界。
- startSession 成功前保持 Hub；pending 期间冻结 action topology 和 selection。
- delta 只写入当前 session/request 的一条 assistant streaming message。
- terminal failure 可保留 presentation-only failed transcript；dismiss 不调用 Core。
- running cancel 的 send `CANCELLED` 不建立 failure view，cancel result 独占返回 Hub。
- dispose 停止 emit、释放 transcript/订阅并 await `core.dispose()`。

## 构建与测试

```bash
npm run build -w @dayloom/archive-protocol
npm run test -w @dayloom/core
npm run test -w @dayloom/tui
```

TUI test 包含 architecture guard、unit、scripted public-contract PTY 和 production Core startup PTY。详见 [TUI 使用指南](/guide/TUI) 与 [TUI E2E](/testing/TUI_E2E)。
