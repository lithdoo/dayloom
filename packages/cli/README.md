# @dayloom/cli（已废弃）

`@dayloom/cli` 是依赖 `@dayloom/core-old` 的旧命令行界面，现仅为迁移和兼容性验证保留，不再承接新功能。

新应用应使用：

- `@dayloom/tui` / `dayloom-tui` 作为正式交互入口；
- `@dayloom/core` Runtime API 进行程序化集成。

旧命令当前仍可运行，但其会话模型、参数和存档格式不应作为新功能的集成基础。
