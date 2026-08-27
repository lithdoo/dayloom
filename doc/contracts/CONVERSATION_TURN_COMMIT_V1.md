# Conversation Turn Commit V1

**状态**：冻结契约  
**最后核对**：2026-08-27

## 1. Turn 状态机

一个 Turn 最多生成两个 Response attempts。每个 attempt 在私有 Conversation revision 中追加同一个 user turn；rejected attempt 不得进入下一次 attempt、压缩输入或 accepted Conversation。

固定流程：

```text
Response Candidate -> Arbiter -> Commit A -> Curator -> Commit B
```

- Arbiter 必须且只能通过一次 `turn_verdict` tool 封存 `ACCEPT/KEEP`、`ACCEPT/UPDATE` 或带固定 code/evidence 的 `REJECT/DEFER`。模型侧工具参数使用无 union 的必填扁平 DTO；control server 负责唯一一次 DTO→嵌套领域 verdict 映射和领域 schema 复核，Turn record 不保存 transport DTO。
- Arbiter 与 Change Plan 共用 sealed-control lifecycle；Final Gate 在自然语言 Final 前验证一次完整 ToolCall/ToolResult、sealed state 和严格 schema。缺失结果不得默认接受或从 Final 文本解析。
- Final Gate 所需的 ReAct 工作目录由 Core 按 Operation 持有：固定使用 operation-local `react-work` root 与 `work_lifecycle=caller`，拒绝 root 外的 `work_path`，并只在 Process Pile 终止或失败后清理。
- 第一次 REJECT 触发一次 Response repair；第二次 REJECT 终止为 `policy-rejected`。
- Response attempt 的 Conversation 在 ACCEPT 前只存在于 operation-local staging；ACCEPT 后才 prepare 不可变 Conversation revision，再用 Head CAS 执行 Commit A。prepare 或 CAS 失败必须 rollback，Head 保持不变。
- KEEP 在 Commit A 后完成 Turn，不启动 Curator。
- UPDATE 在 Commit A 中写入唯一 `pendingDraftSync`，随后启动 Curator。

## 2. Draft commit

Curator 只获得 operation-scoped `brief.md` 写权；`evidence.md` 不可写。UPDATE 时 Core 先把最新 user 原文以自然 Markdown 引用块确定性锚定到 staging `brief.md`，Curator 再做归纳整理且不得丢失该语义。Core 以 accepted user/response 原始 UTF-8 bytes 和 curator note 渲染 append-only evidence block，执行 byte-level technical check并物化 content-addressed snapshot。Commit B 只通过 Head CAS 切换 `draftHash` 并清空 pending。

## 3. Pending 与 retry

Commit A 后 Curator 失败时 Turn 终止为 `draft-sync-pending`：accepted Conversation 保留，Draft 仍指向 base hash。此时 send/submit 禁止，仅开放 `retryDraftSync` 与 cancel。retry 只重新执行 Curator，不重新生成或仲裁回答；成功后执行 Commit B。

## 4. Conversation compression

压缩只作用于当前 Response attempt 的 Conversation。只有 ACCEPT 后产生的 immutable Conversation revision可成为下一轮 base。强制终止前未完成的 partial delta 只属于当前 presentation，不承诺跨进程恢复。

## 5. Turn Audit

Turn record 保存 user input、至多两个完整 generation、verdict、accepted generation、curation attempts、base/result Draft hash 与 terminal status。记录必须严格拒绝额外字段、无效 ID/hash、超限文本和不满足 pending/committed 不变量的组合。

只有 Response Operation 的 Final delta 可以作为 speculative assistant message 投影。`discarded`、`cancelled`、`superseded`、`failed` 与 `committed` 是不同终态，不得在 TUI 中互相冒充。
