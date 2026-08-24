# 1.0.0-beta.1 发布说明

**状态**：发布候选
**最后核对**：2026-08-24

这是完整 Dayloom Runtime 的首个 beta 产品化版本：

- `@dayloom/core` 覆盖 Init、Planning、Play、Settle、Revise、Abandon 与取消；
- 新建 World 使用 Archive V2 + World Profile V1；现有 Profile V0 通过隔离兼容分支运行；
- Promptpile React 固定为 beta.5，一步预算仅由 `--max-step 1` 传递；
- `max_step` 终止仅在 Check 请求继续且预算耗尽时接受；
- 迁移 API 移到 `@dayloom/core/migration`，CLI 更名为 `dayloom-core`；
- TUI、示例和 CI 已切换到唯一正式 Core；旧实现不再属于产品 workspace。

协议、Core 与 TUI 版本统一为 `1.0.0-beta.1`，内部 Promptpile 依赖保持 exact pin。发布前门禁包括 Node 20/22、Linux/Windows CI，全生命周期测试、真实 beta.5 测试、PTY 测试、文档构建和 tarball fresh-install 烟测。
