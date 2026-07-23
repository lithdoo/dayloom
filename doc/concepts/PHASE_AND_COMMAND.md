# Phase 与 Command

> **类型**：concept  
> **状态**：implemented  
> **最后核对**：2026-07

Dayloom 将业务状态和会话活动分开建模：

- `WorldPhase` 回答 World 处在哪个业务阶段。
- `SessionStatus` 回答 active Session 当前是等待输入、流式回复还是正在提交。

Command availability 同时检查 World phase、Session kind 和 Session status。因此，处在 `planning` 不代表任意 Session 都可以 submit；必须是匹配的 planning Session，并且状态可提交。

## World command

- `init`：建立第一个 canon 和 World。
- `daily`：开始当日计划 Session。
- `play`：开始当日行动 Session。
- `revise`：开始 canon 修订 Session。
- `settle`：结算当日并推进 Day。
- `abandon-day`：放弃当日产物并回到上一业务边界。

## Session command

- `submit`：验证 Session submission，发布 archive 并结束 Session。
- `cancel`：中止后台任务，发布稳定恢复 commit 并结束 Session。

Core 不解析 slash 语法。`/submit` 和 `/cancel` 是 TUI 将用户输入转换为 Core command 的应用层语法。

## 单一规则来源

availability 和 transition 共用同一 command registry。如果 command 显示为 enabled，相同 snapshot 上必须存在合法转移。

精确 phase 矩阵、reason code 和转移见 [Command 参考](/reference/COMMANDS)。

