# Core Runtime V1

**状态**：稳定契约
**最后核对**：2026-08-25

本文定义 `@dayloom/core` 1.x 的应用边界。公开入口只暴露 `createDayloomCore`、`CoreInitializationError` 以及对应的结果、状态和事件类型。

## 创建与所有权

`createDayloomCore({ worldRoot, llmConfigPath, runtimeRoot? })` 打开一个 Archive V2 World。调用者拥有配置文件和 World 根目录；Core 拥有会话临时目录、Promptpile 派生配置、子进程和发布事务。调用者必须在结束时调用 `dispose()`。

一个实例同一时刻只允许一个变更操作。并发变更返回 `BUSY`，不会排队或隐式重试。所有 World 发布都以打开会话时固定的 revision 为基线；基线变化返回冲突且不得产生部分发布。

## 状态机

稳定流程为：

`uninitialized → init → planned → play → awaiting-settle → idle → planning → planned`

`revise` 只在状态声明的 capability 可用时进入；`cancel` 只中止正在运行且可取消的操作；`dispose` 是幂等终止操作。调用方必须以 `getState().capabilities` 为动作依据，不能自行推导可用命令。

## 结果与事件

命令以 `CoreResult` 返回业务失败，不以异常表达预期错误。初始化失败使用 `CoreInitializationError`。稳定错误码包括输入无效、World 无效、冲突、忙碌、取消、Conversation 失败和 Agent 失败。

`subscribe(listener)` 发送 `CoreEvent` v1。事件按 operation 线性化；监听器异常被隔离。`work.*` 是透明的工作状态，`output.*` 才是用户可见 Final。终止事件后不得再出现同一 operation 的增量。

## React 适配器约束

Core 固定使用 Promptpile React Process Pile v1，并通过 CLI 唯一传入 `--max-step 10`。十步是所有 Session 共用的硬安全上限而不是目标，派生 TOML 不重复声明步数。

所有 Dayloom 模型提示词由 `session/prompts/` 独立拥有，说明文本统一使用中文，并通过 `@dayloom/core/prompts` 子路径单独导出。协议标记、工具名、枚举值和 JSON Schema 字段名保持机器契约原值；根入口不导出提示词。

终止证据必须与 Check 决策精确耦合：Check 返回 `false` 时只接受 `stop_reason=final`；Check 返回 `true` 且十步预算耗尽时只接受 `stop_reason=max_step`。Check 只有在 Observe 为 `needs-more`、存在具体且非重复的下一 Archive Retrieval、Session 具有 retrieval binding，且新证据会实质提升正确性时才可继续；证据充分、检索阻塞或需要用户澄清时必须停止。两条终止路径都必须包含已完成、非空且与 Final 增量完全一致的内容。事件缺失、乱序、跨 process、步数不一致、非法继续、Final 跳过或证据不匹配均失败关闭。

## 版本边界

Core 只实现当前运行路径，不提供旧格式回退或自动升级。Archive 与 World Profile 的格式边界由 [World Profile V1](./WORLD_PROFILE_V1.md) 定义。深层 `dist/` 导入、内部 Promptpile 适配器和测试构造器不属于公开 API。

## 已冻结的 Session Submission V1 修订

[Session Draft and Submission V1](./SESSION_SUBMISSION_V1.md) 已冻结为下一次 Session 提交实现契约，[指令追踪矩阵](./SESSION_PROMPT_TRACEABILITY_V1.md) 与[冻结报告](./SESSION_SUBMISSION_V1_FREEZE_REPORT.md)构成其验收依据。

该修订只允许一次性全量切换：Init、Planning、Play、Revise 必须同时从 SubmissionV2 Final JSON 切换到持久 Draft 与 Candidate Pipeline，并在同一发布版本中删除旧 parser、builder、submit prompt 与兼容 fixture。实现完成前现行路径保持唯一；实现完成后新路径保持唯一。生产包不得包含可由调用方选择的新旧双轨。
