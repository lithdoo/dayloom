# Core 产品化实施记录

**状态**：Implemented / release-ready
**最后核对**：2026-08-24

本记录关闭 `CORE2_PRODUCTIZATION_PLAN.md` 的仓库内改造。npm Gate 0 未发现已发布的 `@dayloom/core`、实验 Core 或 TUI 包，仓内也没有产品 workspace 之外的消费者；因此采用直接 beta 晋升，不维护双 Runtime 或兼容 facade。

## 分阶段结果

- P0：Reducer 从最后一次 Check 推导 `expectedStopReason`；`final` 与 `max_step` 均按决策严格验证。步数只通过 `--max-step 1` 传入，派生 TOML 不再重复配置。
- P1：发布 Core Runtime V1 与 World Profile V1 契约；根入口缩减为应用 API，迁移移到 `@dayloom/core/migration`；内部协议错误按 JSONL、schema、sequence、phase、stop reason、Final evidence 与 child exit 分类。
- P2：完整 Runtime 原子晋升为 `@dayloom/core@1.0.0-beta.1`，TUI 与 protocol 同步版本；旧 Core/CLI/TUI 移出 workspace 并保存在 `legacy/packages/`；示例、CI、文档和架构门禁同步切换。
- P3：保留显式、只读源的 legacy filesystem → Archive V2/Profile V1 迁移；Profile V0 以隔离兼容分支延续已有 World，不静默升级；增加 Core/TUI tarball fresh-install 与 CLI 烟测、迁移指南和 release notes。

## 验证证据

- `npm test`：Archive 13、Core 116、TUI 40，全部通过；
- 真实 Promptpile React beta.5 覆盖 Check=false/final 与 Check=true/max_step；
- `npm run test:pack -w @dayloom/core` 与 `npm run test:pack -w @dayloom/tui` 通过；
- `npm run docs:build`、`npm run examples:check`、`git diff --check` 通过；
- `npm audit --omit=dev` 为 0；完整 audit 仍报告 VitePress 1.6.4 开发服务器链的 3 个无可用修复告警，发布产物不包含该链；
- CI 已配置 Linux/Windows × Node 20/22，实际远端结果以提交后的 CI 为准。

npm registry 发布不是仓库改造的一部分，本次没有执行外部 publish。发布者应在 CI 全绿后按 protocol → core → tui 顺序发布 `1.0.0-beta.1`。
