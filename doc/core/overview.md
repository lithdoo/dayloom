# Core2 Runtime Refactor Overview

> 状态：方向已定，core2 v1 实现中  
> 范围：core2 总体背景、非目标、文件结构、阶段计划、测试矩阵  
> 原则：总览文档只放跨模块决策；具体接口以同目录下三份专题文档为准。

## 1. 背景

当前 core 与 CLI/TUI 的连接方式偏“终端文本 IO”。core 会输出 `AI>`、`You >`、`(Y/N)`、空行、标题线等 CLI 展示文本，也会用普通字符串表达 loading、确认、AI 流式回复和错误。

这导致 TUI 只能从字符串里猜测语义。典型问题包括：

- AI 流式回复过程中正文可见，但结束后可能只剩下 `AI>` 前缀。
- provider delta 被 TUI 当成多条消息，出现每个词或每个 chunk 单独成行。
- status/help/loading/正文混在同一个输出通道里，TUI 多页面难以稳定拆分。

本轮重构不应该给 TUI 继续补字符串过滤规则，而是重新建立 core2 与 CLI/TUI 的边界。

## 2. 总体方向

```text
core2 runtime
  读取 world 状态
  读取 Session 状态
  暴露具体命令能力
  接收自然语言输入
  接收具体业务指令
  发出语义事件

CLI / TUI driver
  读取 snapshot
  读取 commands
  订阅 events
  渲染界面
  判断用户操作是指令还是自然语言
  把指令或自然语言交回 runtime
```

CLI/TUI 平等适配 core2 runtime。TUI 不适配 CLI 文本输出，CLI 也不再要求 core2 输出 CLI 装饰文本。

## 3. 三份专题文档

- [global-state-machine.md](./global-state-machine.md)：world/business phase、指令、状态转移、引用有效性。
- [session-manager.md](./session-manager.md)：Session 生命周期、SessionEvent、后台任务、流式消息、AI 失败。
- [runtime.md](./runtime.md)：Runtime public API、snapshot、commands、events、并发、错误、driver 边界。

## 4. Non-Goals

第一版不做：

- 不考虑旧存档兼容。
- 不保留旧 `settling` phase 兼容映射。
- 不保留旧 `SessionIO` 文本协议作为 Runtime 接口。
- 不输出 `AI>`、`You >`、`(Y/N)` 等 CLI 展示文本。
- 不提供 core 级 `next`。
- 不提供 TUI `next`。
- 不提供 core 级 `help/status/exit`。
- 不提供 `save` 或保存草稿。
- 不提供 `confirm`。
- 不恢复跨进程 Session 对象。
- 不设计 `invalid` 自动修复能力。
- 不冻结完整真实业务 Session 的 payload 精确结构；core2-native 已提供 init/planning/revise 的最小 JSON payload。

CLI 可以自行提供 `next`，但必须转换成具体 Runtime command。退出应用、帮助、状态页、选择框、快捷键等属于 driver/app 层。

## 5. 文件结构建议

当前实现目标是 `packages/core2`，不再写入旧 `packages/core/src/runtime`。

当前结构：

```text
packages/core2/src/
  index.ts
  types.ts
  runtime.ts
  transitions.ts
  commands.ts
  errors.ts
  session-manager.ts
  message-store.ts
  world-store.ts
  sessions/
    types.ts
    fake-session.ts
    handler-session.ts
    native-session.ts
```

`settle` / `abandon-day` 第一版作为 Runtime 内部短 operation 接入 `WorldStore`，后续变复杂时再拆到 `operations/`。

## 6. 落地阶段

### 6.1 会话管理器

状态：已实现第一版。

目标：

- 定义 `RuntimeSession`、`SessionStatus`、`SessionEvent`。
- 实现 fake SessionManager。
- 实现后台 task 与 AbortController 规则。
- 实现流式消息事件聚合规则。
- 实现 AI 失败进入 `failed` 的规则。

验收：

- `sendInput` 启动后台 task 后尽快返回。
- streaming/loading 期间 `cancel/dispose` 可以 abort 后台 task。
- assistant delta 聚合为同一条 message。
- Session 不能越权发 world/command RuntimeEvent。

说明：

- 这一阶段不需要真实 world 文件。
- 这一阶段不需要真实 AI provider。
- 这一阶段不需要完整 Runtime command。
- 这一阶段可以先用 fake Session 和 fake clock/task 验证并发、取消、失败、消息聚合。

### 6.2 Runtime 会话外壳

状态：已实现第一版。

目标：

- 实现 `DayloomRuntime` 中和 Session 直接相关的最小接口。
- 实现 `sendInput`。
- 实现 `subscribe` / event dispatch。
- 实现 session snapshot。
- 实现 operation id。
- 实现短 mutation 串行与 `RUNTIME_BUSY`。

验收：

- `sendInput` 与后台 task 解耦。
- listener 抛错不破坏 Runtime。
- operation id 能匹配 input started/succeeded/failed。
- Runtime 不输出 CLI 文本。

### 6.3 全局状态机

状态：已实现第一版。

目标：

- 定义 `WorldPhase`、world command、session command。
- 实现 transition 表。
- 实现 command availability 规则。
- 实现 invalid 第一版只读禁用策略。
- 明确 core2 v1 文件有效性模型，但阶段内不实现 publish marker / gc。

验收：

- 每个 phase 的可用指令和不可用原因可测。
- 合法 transition / 非法 transition 可测。
- `submit/cancel/abandon-day` 的逻辑目标状态可测。

### 6.4 Runtime + 状态机整合

状态：已实现第一版。

目标：

- 将 `executeCommand` 接到状态机。
- 将 SessionManager 的 submit/cancel 结果交给状态机决定 world phase。
- 暴露完整 `getSnapshot` 与 `getAvailableCommands`。
- 发出 command started/succeeded/failed/rejected。
- 发出携带 previous/current 的 `world-changed`。

验收：

- `sendInput` 与 `executeCommand` 通道严格分离。
- command started/succeeded/failed/rejected 能通过 operation id 匹配。
- `submit` 只在 Session `ready-to-submit` 时启用。
- `world-changed` 携带前后完整 `WorldSnapshot`。

### 6.5 真实业务与 Driver 切换

状态：部分实现。init/planning/revise 已有 core2-native JSON 会话；play 仍是占位实现；CLI/TUI driver 尚未切换。

目标：

- 将 init/daily/play/revise 从旧主动阻塞 loop 中拆出非交互部件。
- 基于拆出的业务步骤实现真实 RuntimeSession。
- 将 settle / abandon-day 包装为短 operation。
- CLI 改为 Runtime driver，可自行提供 `next`。
- TUI Hub 读取 snapshot/commands，TUI Session 读取 session snapshot 与 message store。

验收：

- CLI/TUI 同跑一套 core2 runtime。
- TUI 流式消息不再拆成多行消息。
- TUI 不再出现正文丢失后只剩 CLI 前缀的问题。

## 7. 测试矩阵

| 测试 | 归属 | 覆盖 |
|------|------|------|
| transitions | 全局状态机 | 每个合法 transition、非法 transition。 |
| commands | 全局状态机 / Runtime | 每个 phase 的 enabled/disabled commands 与 reason。 |
| invalid | 全局状态机 / Runtime | `invalid` 可读取但禁用所有 mutation。 |
| runtime-commands | Runtime | `executeCommand` 成功、失败、rejected。 |
| runtime-input | Runtime / SessionManager | 无输入请求时拒绝 input；有 Session 时转发 input。 |
| runtime-busy | Runtime | 并发 `sendInput` / `executeCommand` / `dispose` 返回 `RUNTIME_BUSY`。 |
| operation-id | Runtime | 连续同名 command 的事件可匹配。 |
| listener | Runtime | listener 抛错不破坏 Runtime，也不阻止其它 listener。 |
| world-changed | Runtime | 事件携带 previous/current 完整 snapshot。 |
| submit-availability | Runtime / SessionManager | `submit` 只在 Session `ready-to-submit` 时启用。 |
| session-manager | SessionManager | create / submit / cancel / dispose 生命周期。 |
| background-task-cancel | SessionManager | streaming/loading 时 `cancel/dispose` abort 后台 task。 |
| message-store | SessionManager / driver helper | start/delta/end/error 聚合为同一条 message。 |
| ai-failure | SessionManager | 流式前/流式中失败进入 `failed`，保留已有消息，只允许 cancel。 |
| session-event-scope | SessionManager / Runtime | SessionEvent 不能越权发 world/command 事件。 |

会话管理器首阶段不需要真实 AI，不需要 MCP，不需要 TUI E2E。

## 8. 待细化项

- play Session 的 core2-native 业务设计与实现。
- 更完整的真实业务 Session payload 结构。
- publish marker、复杂 cleanup、state log 与 gc 规则。
- `settle` 的完整文件写入边界。
- 旧 `SessionIO` 拆分成 prompt、AI 调用、parse、validate、apply、MCP gateway 等非交互部件的具体步骤。
- 是否支持跨进程 Session 恢复；第一版明确不支持。
- `invalid` 修复/导入/迁移工具；第一版明确不支持。
