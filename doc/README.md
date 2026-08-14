# Dayloom 文档

> **类型**：index  
> **状态**：implemented  
> **最后核对**：2026-07

本站只描述当前的 `@dayloom/core` 和 `@dayloom/tui`。已弃用实现、尚未完成的迁移及其应用入口不属于发布范围。

## 按阅读目标选择

| 目标 | 入口 |
|------|------|
| 第一次运行 Dayloom | [快速开始](/guide/GETTING_STARTED) |
| 理解每日流程 | [World 生命周期](/guide/WORLD_LIFECYCLE) |
| 使用全屏终端界面 | [TUI 使用指南](/guide/TUI) |
| 排查启动、AI 或存档问题 | [故障排查](/guide/TROUBLESHOOTING) |
| 理解 World、Day、Phase | [World 与 Day](/concepts/WORLD_AND_DAY) |
| 理解 Session 和显式提交 | [Session](/concepts/SESSION) |
| 查 command 和状态转移 | [Command 参考](/reference/COMMANDS) |
| 查环境变量 | [环境变量](/reference/ENVIRONMENT_VARIABLES) |
| 集成 Core Runtime | [@dayloom/core](/packages/CORE) |
| 维护 TUI | [@dayloom/tui](/packages/TUI) |

## guide/

- [GETTING_STARTED](/guide/GETTING_STARTED) — 安装、构建、启动和第一个 World。
- [WORLD_LIFECYCLE](/guide/WORLD_LIFECYCLE) — init、daily、play、settle、revise 和 abandon-day。
- [TUI](/guide/TUI) — Hub/Session、键盘、slash 指令、焦点与滚动。
- [TROUBLESHOOTING](/guide/TROUBLESHOOTING) — 常见错误与恢复路径。

## concepts/

- [WORLD_AND_DAY](/concepts/WORLD_AND_DAY) — World、Day 和稳定业务边界。
- [PHASE_AND_COMMAND](/concepts/PHASE_AND_COMMAND) — 两层状态与 command availability。
- [SESSION](/concepts/SESSION) — Session 生命周期和显式 submit/cancel。
- [ARCHIVE_AND_REVISION](/concepts/ARCHIVE_AND_REVISION) — pointer、commit、revision 与 operation workspace。

## reference/

- [COMMANDS](/reference/COMMANDS) — phase/command 矩阵、availability 和转移。
- [CONFIGURATION](/reference/CONFIGURATION) — 运行时配置与默认值。
- [ENVIRONMENT_VARIABLES](/reference/ENVIRONMENT_VARIABLES) — AI provider 环境变量。
- [ARCHIVE_FORMAT](/reference/ARCHIVE_FORMAT) — 存档目录、schema、发布和恢复规范。

## packages/

- [CORE](/packages/CORE) — `@dayloom/core` 公共入口、依赖和错误语义。
- [TUI](/packages/TUI) — `@dayloom/tui` 分层、Runtime driver 和 UI 状态。

## architecture/

- [DESIGN](/architecture/DESIGN) — 系统分层和核心不变量。
- [RUNTIME](/architecture/RUNTIME) — Runtime API、编排、并发和事件顺序。
- [SESSION_MANAGER](/architecture/SESSION_MANAGER) — Session 契约、后台任务与消息聚合。
- [ROADMAP](/architecture/ROADMAP) — 当前结论和后续方向。

## testing/

- [OVERVIEW](/testing/OVERVIEW) — Core/TUI 测试层次和命令。
- [TUI_E2E](/testing/TUI_E2E) — Runtime driver、ViewModel 和真实 PTY 验收。

## 维护

- [文档规范](/CONVENTIONS)
- 已完成的长期实施计划保存在 GitHub 的 `doc/archive/plans/`，不进入发布站点导航。

