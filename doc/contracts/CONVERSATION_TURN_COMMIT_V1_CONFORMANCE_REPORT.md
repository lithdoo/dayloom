# Conversation Turn Commit V1 Conformance Report

**状态**：实施完成  
**最后核对**：2026-08-27  
平台验证：Windows 本地；同一测试集由仓库 CI 的 Ubuntu job 执行

## 实现映射

| 契约边界 | 实现 |
| --- | --- |
| Aggregate Head / CAS | `packages/core/src/session/aggregate-head.ts` |
| Markdown snapshot / evidence | `markdown-draft-snapshot.ts`、`draft-store-v2.ts` |
| Conversation revision / compression | `conversation-revision.ts`、`turn-agent-v2.ts` |
| Turn double commit / pending retry | `turn-coordinator.ts`、`turn-record.ts`、`core.ts` |
| sealed verdict / Change Plan tools | `promptpile/operation-control-server.ts` |
| Change Plan / evidence / assignment | `change-plan-v2.ts`、`change-evidence-v2.ts` |
| Candidate / Audit V2 / publish | `submission-pipeline-v2.ts`、`submission-agent-v2.ts`、`world/builders/audit.ts` |
| Event V2 / speculative TUI | `events.ts`、`presentation-reducer.ts`、`runtime-driver/driver.ts` |

## 验证结论

- Core architecture guard、全量单元/集成测试、TUI architecture guard、TUI PTY/pack、文档与 examples check 通过。
- 测试覆盖 speculative streaming、Arbiter repair、Commit A/B、pending→restart→retry、ready cancel archive、orphan cleanup、Commit B record recovery、strict Change Plan/evidence、bounded Candidate repair、Audit V2、并发 CAS 与 Legacy migration。
- 生产旧路径 `draft-store.ts`、`submission-agent.ts`、`submission-pipeline.ts` 已删除；Legacy 只保留隔离迁移 reader/lint。
- Core package consumer pack 的代码编译成功；一次独立 pack smoke 因第三方 `rust-mcp-filesystem` 安装脚本访问 GitHub 超时/连接重置未完成。TUI pack 在同一环境随后成功安装完整依赖并通过，故该项记录为外部网络波动，不是契约偏差。

## 冻结判断

四份冻结契约与生产实现采用同一 authority 模型：提前展示不等于提交；Response、Draft、World 分别只有一个明确提升边界；失败只丢弃未提升 artifact。后续功能应扩展 Change Plan resource matrix 或领域 validator，不得在 Response/Curator/TUI 周边新增旁路状态或补丁式 authority。
