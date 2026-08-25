# Session Draft and Submission V1 Freeze Report

**状态**：通过，设计冻结，可进入实现  
**最后核对**：2026-08-25

## 1. 冻结包

| 文档/证据 | 角色 |
|---|---|
| `SESSION_MARKDOWN_DRAFT_SUBMIT_DESIGN_DRAFT.md` | 架构动机、整体流程与完成定义 |
| `doc/contracts/SESSION_SUBMISSION_V1.md` | 规范性格式、工具、策略、数值、API 和时序 |
| `doc/contracts/SESSION_PROMPT_TRACEABILITY_V1.md` | 旧指令与 SubmissionV2 语义迁移证明 |
| `SESSION_ARCHIVE_RETRIEVAL_MCP_DRAFT.md` | pinned Archive 只读能力及显式兼容修订 |
| `packages/core/scripts/spike-session-file-runtime.mjs` | 固定依赖多 server 读写边界的可重复证据 |

## 2. Gate 结果

### Gate 0：架构冲突关闭——通过

- Archive Retrieval 仍是 pinned、只读、五工具、Final 无工具。
- Draft/Candidate 写能力属于独立 workspace server，不能放宽 Archive server。
- 一个 World 同时只允许一个 Core writer。
- 程序 validator 是唯一发布门槛；AI review 只产生 advisory。
- Settle/abandon 保持确定性无 AI。

### Gate 1：可执行契约——通过

已冻结：

- 持久根、临时根、锁和失效锁回收；
- Draft Format V1、stable key、confirmed/proposed；
- model-visible 精确工具集合；
- 所有资源数值；
- Init/Planning/Play/Revise 文件矩阵；
- 只允许 Candidate put，不允许 AI 物理 delete；
- ID 分配和 assignment 失效规则；
- pipeline 顺序、修复次数和重复错误提前终止；
- ValidationIssue、错误码、状态、事件和 cancel 时序；
- 一次性切换和旧路径退役要求。

### Gate 2：固定依赖 Spike——通过

运行命令：

```text
node packages/core/scripts/spike-session-file-runtime.mjs
```

2026-08-25 Windows x64 实测结果：

- `@rustmcp/rust-mcp-filesystem@0.4.3`
- `promptpile-mcp@0.1.0-beta.3`
- 一个 gateway 同时挂载只读 Archive 和可写 Draft server；
- `flat_names=false` 精确导出 8 个 namespaced 工具；
- Archive 不导出 `write_file`；
- Draft `write_file` schema 精确要求 `path`、`content`；
- 经 `promptpile-mcp exec-calls` 写入 `world.md` 成功；
- Archive 原文件保持不变；
- gateway 退出和临时目录清理完成。

Candidate server 使用与 Draft 相同的固定 provider/写工具，只改变独立 root 与 exact allowlist，不引入新的外部能力假设。Candidate 合成、validator、diff、锁和恢复均为 Core-owned 本地逻辑，由实现 Gate 验收。

### Gate 3：指令可追踪——通过

- 通用权威、用户能动性、Observe、Check、Final 指令均有稳定 ID。
- Init/Planning/Play/Revise 全部角色指令均映射到新提示词、程序守卫和验收测试。
- 四类 SubmissionV2 的字段、引用、前置值和 ID 语义均有新载体。
- 旧 JSON 输出格式明确退役，不存在兼容回退。

## 3. 冻结检查表

- [x] 不存在未决技术选型。
- [x] 不存在“调用方自行选择”的发布语义。
- [x] 不存在可写 Archive 路径。
- [x] 不存在 Candidate 全量目录 diff 或未投影文件误删。
- [x] 不存在模型分配持久 ID。
- [x] 不存在 AI review 绕过或替代程序 validator。
- [x] 不存在未给数值的资源边界。
- [x] 不存在未定义的提交失败恢复状态。
- [x] 不存在长期新旧双轨提交路径。
- [x] 所有旧提示词与 SubmissionV2 业务语义可追踪。
- [x] 固定外部写能力已用真实进程验证。

## 4. 实现 Gate

设计冻结不等于实现完成。生产实现必须按以下 Gate 前进：

1. `DocumentSource`、结构化 validator、operation policy 和 CandidateAssembler 单元测试全部通过。
2. DraftStore 的原子写、单写者、失效锁、恢复、stale 和归档测试通过。
3. SessionFileRuntime 的真实 gateway、hook、写闭合、配额、取消和进程清理测试通过。
4. Planning 内部纵向实现通过，但不发布单 Session 产品切换。
5. 四类 Session 全部完成后一次性切换，随后同一提交删除 SubmissionV2、旧 builders 和旧 submit prompts。
6. 完整 Init → Planning → Play → Settle → Revise、失败修复、重启恢复、冲突和 Windows `.bat` DeepSeek 实测通过。

任何实现 Gate 发现冻结依赖、工具 Schema、权限模型或行为契约不成立时，必须先修订设计和本报告；不得在代码中静默偏离。
