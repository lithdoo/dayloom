# Session

> **类型**：concept  
> **状态**：implemented  
> **最后核对**：2026-07

Session 表示一次 init、planning、play 或 revise 对话。它负责自然语言交互和业务产物，但不拥有 World transition 权。

## 为什么不自动提交

AI 回复完成只代表对话任务结束，不代表用户接受其产物。Dayloom 将两者分开：

1. 用户输入启动可取消的后台 AI 任务。
2. Session 聚合消息并准备类型明确的 submission。
3. 用户显式 submit。
4. Runtime 验证、发布 archive，然后完成 Session。

发布失败时 Session 保持 active，可重试错误会恢复到可提交状态。

## 单一 active Session

同一 Runtime 最多有一个 active Session，且同时最多有一个输入后台任务。新输入不会静默中止上一个未完成任务。

## 取消

cancel 会中止并等待 active provider task，然后让 Runtime 将 World 恢复到进入 Session 前的稳定业务边界。Session 本身不直接修改正式 archive。

## 流式消息

assistant 回复使用稳定 message id 和 start/delta/end/error 事件。MessageStore 按 session id 和 message id 聚合，部分 AI 失败时保留已收到文本。

完整内部契约见 [Session Manager](/architecture/SESSION_MANAGER)。

