# Speculative Operation and Authority V1

**状态**：冻结契约  
**最后核对**：2026-08-27  
实现基线：Conversation Turn Commit V1

## 1. 原则

- AI 输出、Thought、工具结果与流式文本默认都是 speculative artifact。
- `operation.delta` 可以立即展示，但不授予 Conversation、Draft 或 World authority。
- Operation 由 Core 分配唯一 `operationId`；同一业务尝试共享 `groupId`。
- 每个 Operation 恰好一次 `operation.started`，并以恰好一次 `operation.finished` 终止。
- `operation.finished` 后的同 operation 事件必须被丢弃。

## 2. 提升边界

- Response Candidate 仅在 Arbiter ACCEPT 且 Aggregate Head Commit A 成功后成为 accepted response。
- Markdown Draft Candidate 仅在 technical check、canonical hash 与 Aggregate Head Commit B 成功后成为 accepted Draft。
- Candidate World 仅在 validator 成功且 Archive publisher 切换 current 后成为 Published World。
- 提升失败只丢弃未引用 artifact；不得修改既有 authority 来模拟回滚。

## 3. Operation 种类

固定种类为 `response`、`arbitration`、`draft-curation`、`submission-conversion`、`submission-repair`、`submission-review`。Response repair 使用同一 `groupId` 的第二个 `response` Operation；Submission repair 每轮使用新的 `submission-repair` Operation。

## 4. 取消

- 取消只终止 active process/resources，并把尚未提升的 artifact 标为 abandoned。
- Commit A 前取消不得改变 Head。
- Commit A 后取消不得抹除 accepted response；pending 只能由 retry、ready cancel 或 Commit B 消解。
- ready cancel 先 CAS 清空 `activeSession`，再移动 Session；CAS 是 authority 线性化点。

## 5. 可观察性

TUI 可以展示未验证回答，并必须明确区分 streaming、verifying、accepted、superseded、abandoned 和 error。正式 transcript 只读取 Aggregate Head 指向的 accepted Conversation revision。
