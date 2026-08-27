# Session Submission V2

**状态**：冻结契约  
**最后核对**：2026-08-27

## 1. 输入

Submission 只能读取 Aggregate Head 指向的固定 `brief.md + evidence.md` snapshot、accepted Conversation revision、Turn records 与 pinned Published World。存在 pending、Head revision/hash 改变或 active Session 不匹配时必须失败关闭。

## 2. Change Plan

Planner 必须且只能调用一次 `declare_change_plan`。Tool 严格校验 exact object、Session action matrix、evidence range/hash、用户确认来源、目标存在性与 base，然后由 Core 确定性分配 ID 并封存 canonical plan/assignment。

Change Plan 与 assignment 仅存在于 transient submission workspace。Converter 和 repair 只读封存结果，不重新解释范围或分配 ID。

## 3. Candidate

- Converter 只能写 Candidate workspace。
- Candidate 路径继续受既有 Session kind policy 约束；Revise 还必须位于 Change Plan 推导的 exact path set。
- validator 是领域结构的唯一硬边界。
- diagnostics 相同则停止 repair；repair 次数受固定上限约束。
- Reviewer 只读，失败降级为 advisory，不绕过 validator。
- 实际 diff 为空时不得发布。

## 4. Publish 与 Audit

发布前必须再次校验 Head revision/hash/pending。Audit V2 固定包含 accepted transcript、Markdown Draft bytes/index、Turn index/records、Change Plan、assignment、实际 conversion transcripts、validation、review 和 candidate diff。Archive current 切换是 World authority 线性化点；writer 只产生 Audit V2，历史 assignment reader兼容 V1/V2。

## 5. 清理

publish 前失败删除整个 submission transient，保留 Draft/Session 可重试。publish 后幂等完成 Draft archive；恢复不得再次 publish。
