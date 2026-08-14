# Core Implementation Checklist

> **类型**：plan · **状态**：archived · **现行架构**：[DESIGN](../../architecture/DESIGN.md)  
> 范围：Stage 0 至 Stage 9 的文件改造顺序和验收记录。

## 1. 文档定位

现行专题文档定义最终契约，[CORE_REFACTOR](./CORE_REFACTOR.md) 保留通用阶段和质量要求。本文只记录：

- 当前代码已经具备什么；
- 当前代码与目标契约差在哪里；
- 每一步具体修改哪些文件；
- 哪些当前入口在何时完成切换；
- 每个阶段如何验证可以继续。

本文只涉及新 Core 包自身，不包含其它包的适配工作。

## 2. 当前实现基线

### 2.1 已有可复用能力

- [x] `WorldPhase` 和八个 Core command 已定义；
- [x] 输入与 command 使用不同 Runtime 方法；
- [x] command availability 已有基础实现；
- [x] submit 已校验 Session kind 和可提交 status；
- [x] Runtime 已有 operation id 和单 mutation lock；
- [x] 输入后台 task 已使用 AbortController；
- [x] SessionEvent 已限制为消息、输入、loading 和 status；
- [x] assistant start/delta/end/error 事件已存在；
- [x] MessageStore 已支持按 message id 聚合和保留上限；
- [x] Runtime listener 异常已隔离；
- [x] init、planning、play、revise、settle、abandon-day 已有最小业务行为；
- [x] Promptpile client 和自然语言 Session 已能运行；
- [x] Core 基础测试可以验证当前行为。

这些能力应迁入目标模块或保持语义，不应无理由重写。

### 2.2 需要替换的核心结构

- [x] 新 Runtime 的正式写入已全部替换为 ArchiveRepository/ArchiveTransaction；
- [x] `current.json` 的 `phase/day` 结构，替换为 `revision/commitId` pointer；
- [x] 可变 canon/day 文件，替换为不可变 revision；
- [x] 单步 `RuntimeSession.submit()`，替换为 prepare/complete/fail submit；
- [x] `SessionManager.createSession(beforePublish)` 已替换为 prepare/activate/discard；
- [x] SessionContext 的 `worldRoot/day`，替换为只读 snapshot 和 SessionWorkspace；
- [x] `{ kind, payload: unknown }` 已替换为明确 submission union；
- [x] 同步 `new CoreRuntime()` 已替换为异步 Runtime factory；
- [x] 新 Runtime 使用注入或默认创建的 ArchiveRepository；
- [x] 字符串 availability reason，增加稳定 `reasonCode`；
- [x] RuntimeEvent 中缺失的 operation id 和结构化 rejected error；
- [x] 只在内存回退 Session phase，替换为 archive recovery operation；
- [x] 不可重复 Runtime dispose，改为幂等释放；
- [x] SessionManager listener 直接抛错，改为隔离并记录诊断。

## 3. 总体实施顺序

```text
Stage 0  锁定基线与测试拆分
Stage 1  公共类型和业务 Schema
Stage 2  SessionManager 改造
Stage 3  ArchiveRepository
Stage 4  纯状态机
Stage 5  Runtime 重组
Stage 6  业务 Operations
Stage 7  真实 Sessions
Stage 8  恢复、GC 和诊断
Stage 9  删除过渡实现并完成系统验收
```

约束：

- 每个 Stage 在同一阶段内修复全部受影响调用点，主分支不能长期处于无法构建状态；
- 新模块通过本阶段测试后才从 package 根入口导出；
- 只实现新存档格式，不增加双格式读取分支；
- 不同时维护两套公开 Runtime；
- 目标接口一旦在对应专题文档冻结，代码调整优先服从专题文档。

## 4. Stage 0：锁定基线与测试拆分

### 目标

在结构变化前建立可比较的行为基线，并把单文件测试拆成模块测试。

### 修改清单

- [x] 记录当前 `npm run build -w @dayloom/core` 结果；
- [x] 记录当前 `npm run test -w @dayloom/core` 用例数和结果；
- [x] 将 `test/index.test.js` 按模块拆分：
  - `test/domain/state-machine.test.js`；
  - `test/sessions/session-manager.test.js`；
  - `test/sessions/message-store.test.js`；
  - `test/runtime/runtime.test.js`；
  - `test/archive/archive.test.js`；
  - `test/operations/*.test.js`；
- [x] 建立 fake clock、deterministic id 和 deferred task helper；
- [x] 建立 failure-injection filesystem helper；
- [x] 建立 archive 临时目录和 JSON fixture helper；
- [x] 给当前公开导出增加类型编译 smoke test；
- [x] 删除依赖固定 `/tmp/world` 的测试，改用每次唯一的测试 world 路径。

### 文件

```text
packages/core/test/
  helpers/
    archive-fixture.js
    deferred-task.js
    deterministic-id.js
    failure-filesystem.js
  domain/
  sessions/
  archive/
  runtime/
  operations/
```

### 退出门槛

- [x] 原有 37 个行为测试全部保留；另新增 4 个 helper 自测；
- [x] 测试无悬空 timer、Promise 和临时目录；
- [x] build、类型 smoke check 和 41 个测试均通过；
- [x] 尚未改变正式行为。

## 5. Stage 1：公共类型与业务 Schema

### 目标

先建立后续所有模块依赖的稳定类型，不立即切换 Runtime 行为。

### 新增文件

```text
packages/core/src/
  domain/
    types.ts
    commands.ts
  schemas/
    common.ts
    submissions.ts
    archive.ts
    validators.ts
  infrastructure/
    clock.ts
    ids.ts
    logger.ts
    filesystem.ts
```

### 修改清单

- [x] 从 `src/types.ts` 拆出 domain、command、公共 schema 和 archive 类型；Session/Runtime 类型分别在 Stage 2、5 迁移；
- [x] 保留根入口统一导出，不要求使用者了解内部目录；
- [x] 定义经过 validator 校验的 WorldId/DayId/CommitId/RevisionId/OperationId；
- [x] 定义 `RuntimeErrorCode` union；
- [x] 定义 `CommandUnavailableReason`；
- [x] 给 `CommandAvailability` 增加 `reasonCode`；
- [x] 定义 `CanonDocuments`；
- [x] 定义 `PlanBeat/ResolvedPlanBeat/PlayEvent/TranscriptEntry`；
- [x] 定义 `InitSubmission/PlanningSubmission/PlaySubmission/ReviseSubmission`；
- [x] 定义 manifest/current/commit/canon/day/operation schema；
- [x] 为全部目标持久化 schema 和 Session submission 实现 runtime validator；
- [x] 确保公共结构均可 JSON 序列化；
- [x] 为每个 schema 添加 valid/invalid fixture。

### 当前文件处理

- [x] `src/types.ts`：作为 Session/Runtime 过渡聚合层，并 re-export 已拆分类型；
- [x] `src/world-store.ts` 中的 `Core*Payload`：迁入 submission schema，保留过渡 re-export；
- [x] `src/errors.ts`：改用 `RuntimeErrorCode`，保持 `toRuntimeError` 能力。

### 退出门槛

- [x] 公共 Session submission 不再使用 `payload: unknown`；
- [x] 目标持久化结构和 Session submission 均有 validator；ArchiveRepository 在 Stage 3 强制调用；
- [x] availability 有稳定机器 reason；
- [x] 根入口已导出本阶段冻结的 schema、基础设施和 submission 契约；
- [x] build、类型 smoke 和 77 个测试通过。

## 6. Stage 2：SessionManager 改造

### 目标

先完成不依赖正式 archive 的 Session 生命周期，使用 fake workspace 验证。

### 修改文件

```text
packages/core/src/
  sessions/types.ts
  sessions/session-manager.ts
  sessions/session-workspace.ts
  sessions/fake-session.ts
  sessions/handler-session.ts
  sessions/message-store.ts
```

当前 `src/session-manager.ts` 和 `src/message-store.ts` 在完成后迁入 `sessions/`。

### 接口改造

- [x] `RuntimeSession.submit()` 改为：
  - `prepareSubmit()`；
  - `completeSubmit()`；
  - `failSubmit(error)`；
- [x] SessionContext 改为：
  - `sessionId`；
  - readonly `world`；
  - `SessionWorkspace`；
  - `emit()`；
- [x] 删除 SessionContext 的任意正式路径写入能力；
- [x] `createSession(beforePublish)` 改为：
  - `prepareSession()`；
  - `activateSession()`；
  - `discardPreparedSession()`；
- [x] start 事件只保存在 PreparedSession；
- [x] active Session 同时最多一个；
- [x] 输入后台 task 同时最多一个；
- [x] 新输入不得静默 abort 尚未结束的旧输入；
- [x] cancel/dispose abort 并等待后台 task；
- [x] complete/fail submit 前保持 active Session；
- [x] listener 异常隔离并交给 CoreLogger；
- [x] dispose 幂等；
- [x] 后台 Promise 全部被跟踪。

### 业务 Session 临时处理

本阶段先更新 FakeSession 和 HandlerSession 满足新接口。NaturalLanguageSession 暂时只做类型适配，不接正式业务写入；真实业务在 Stage 7 完成。

### 必测

- [x] prepare/start/activate/discard；
- [x] start 失败和缓冲事件丢弃；
- [x] input task 成功、失败和 abort；
- [x] 重叠 input；
- [x] prepare submit 成功/失败；
- [x] fail submit 后可重试与不可重试分支；
- [x] complete submit 后清理；
- [x] cancel/dispose；
- [x] listener 抛错；
- [x] MessageStore 重复 start/delta/end/error。

### 退出门槛

- [x] SessionManager 测试不创建正式 world 文件；
- [x] Session 不能发 Runtime/world/command 事件；
- [x] Session 不持有 ArchiveRepository；
- [x] 所有后台任务有明确 owner 和终止路径；
- [x] session tests/build 通过。

## 7. Stage 3：ArchiveRepository

### 目标

用独立模块完整实现新存档规范，此阶段不接 Runtime。

### 新增文件

```text
packages/core/src/archive/
  types.ts
  paths.ts
  validators.ts
  archive-reader.ts
  archive-inspection.ts
  archive-transaction.ts
  archive-repository.ts
  publish-lock.ts
  atomic-file.ts
  recovery.ts
  garbage-collector.ts
```

### 修改清单

- [x] 实现 `current.json` pointer reader；
- [x] 实现 manifest/current/commit/reference 完整校验；
- [x] current 不存在时稳定返回 uninitialized；
- [x] 实现 operation workspace；
- [x] 实现不可变 canon revision；
- [x] 实现不可变 day revision；
- [x] 实现不可变 commit；
- [x] 实现 target commit staging；
- [x] 实现 publish lock owner token；
- [x] 实现 base revision/base commit 冲突检测；
- [x] 实现临时 current、flush 和原子 rename；
- [x] 实现 publish 后 operation 状态校正；
- [x] 实现结构化 invalid 诊断；
- [x] 实现只读 inspection；
- [x] 实现引用图，删除仍由显式 `delete: true` 开启，默认只报告。

### `WorldStore` 处理

- [x] 本阶段保留 `WorldStore` 仅用于当前 Runtime 保持可构建；
- [x] 禁止新代码继续向 `WorldStore` 增加能力；
- [x] ArchiveRepository 测试不得调用 `WorldStore`；
- [x] Stage 6 完成后，正式写入能力已全部由 Archive Operations 实现；
- [x] Stage 7 已移除真实自然语言 Session 的旧布局读取依赖；
- [x] Stage 9 已删除旧同步 Runtime、native Session 和 `WorldStore`。

这里的短期保留只用于开发顺序，不构成第二套公开存档接口，也不从 package 根入口新增导出。

### 故障注入

- [x] workspace 写入失败；
- [x] canon/day revision 中途失败；
- [x] commit 写入失败；
- [x] current temp 写入失败；
- [x] current rename 失败；
- [x] rename 成功后 operation 状态写入失败；
- [x] publish lock 冲突、损坏 lock 和过期 owner；
- [x] base revision 冲突；
- [x] orphan 存在；
- [x] current/commit/reference 损坏。

### 退出门槛

- [x] 发布点前失败不改变 readCurrent；
- [x] 发布点后恢复确定为新 commit；
- [x] 并发 transaction 不丢失更新；
- [x] 正式 reader 从不读取 workspace；
- [x] archive tests/build 通过（Core 共 105 项，ArchiveRepository 21 项）。

## 8. Stage 4：纯状态机

### 目标

把 command availability 和 transition 收敛为纯 Domain 模块。

### 文件调整

```text
packages/core/src/domain/
  phases.ts
  command-registry.ts
  availability.ts
  transitions.ts
  state-machine.ts
```

### 修改清单

- [x] 迁移 `src/commands.ts`；
- [x] 迁移 `src/transitions.ts`；
- [x] availability 和 transition 共用 command registry；
- [x] availability 返回 `reasonCode + reason`；
- [x] transition 不读取 archive；
- [x] transition 不创建 Session；
- [x] transition 不修改输入 snapshot；
- [x] submit 同时校验 phase/kind/status/result kind；
- [x] cancel 使用精确来源状态；
- [x] settle/abandon 要求 current day；
- [x] invalid 禁用全部 command；
- [x] Runtime closed availability 由 Runtime 外层覆盖。

### 删除条件

- [x] 新状态机测试全部通过后删除根目录旧 `commands.ts/transitions.ts` 实现；
- [x] 根入口改为导出 domain 模块的正式 API。

### 退出门槛

- [x] phase × command 测试矩阵完整；
- [x] availability enabled 的 command 一定有合法 transition；
- [x] 测试不使用文件、Session 实例或 AI；
- [x] domain tests/build 通过（Core 共 110 项，状态机 7 项）。

## 9. Stage 5：Runtime 重组

### 目标

用新 SessionManager、ArchiveRepository 和状态机替换当前 Runtime 编排。

### 新目录

```text
packages/core/src/runtime/
  types.ts
  events.ts
  mutation-lock.ts
  runtime.ts
  create-runtime.ts
```

### 修改清单

- [x] 新增异步 `createDayloomRuntime()` 内核 factory；
- [x] Runtime 创建时读取并校验 archive；
- [x] Runtime 创建时完成 interrupted Session recovery；
- [x] 注入 StateMachine、SessionManager、ArchiveRepository、clock、ids、logger；
- [x] Runtime 不直接调用 `fs`；
- [x] WorldSnapshot 增加 worldId/revision/commitId/lastSettledDay/invalid；
- [x] command rejected 携带 RuntimeError；
- [x] session-created/session-ended 增加 operationId；
- [x] operation loading event 增加 operationId；
- [x] create Session 使用 prepare -> archive boundary -> activate；
- [x] submit 使用 prepare -> archive publish -> complete；
- [x] cancel 先 publish stable boundary，再结束 Session；
- [x] archive 发布前不替换公开 snapshot；
- [x] listener 观察事件时只能看到完整新 snapshot；
- [x] dispose 幂等；
- [x] closed 后 availability 全部 disabled；
- [x] archive conflict 映射为稳定 RuntimeResult。

### 当前 Runtime 处理

- [x] 在新 Runtime 通过完整测试前，不从根入口切换；
- [x] Stage 6 已为新 Runtime 接入默认 RuntimeOperations；
- [x] Stage 7 导出异步 Runtime factory，并将 TUI 调用方切换到新 Runtime；
- [x] Stage 9 删除公开 `CoreRuntime` 同步构造入口及过渡实现；
- [x] 新 Runtime 当前仅为包内模块，不形成两套并行公开 Runtime。

Stage 5 通过 `RuntimeOperations` 端口隔离编排和存档业务，Stage 6 补齐真实默认实现，Stage 7 又完成自然语言 Session 的 Archive read model 和 TUI 异步入口切换。旧同步入口、native JSON Session 和 WorldStore 只剩旧测试引用，在 Stage 9 统一删除。

### 必测

- [x] 异步创建成功、uninitialized、invalid 和 recovery；
- [x] Session start archive 边界失败；
- [x] submit 发布失败保留 Session；
- [x] cancel 发布失败保持会话 phase；
- [x] read API 不观察半状态；
- [x] listener 重入；
- [x] mutation busy；
- [x] archive conflict；
- [x] loading 异常路径成对；
- [x] repeated dispose。

### 退出门槛

- [x] 新 Runtime 内核没有 `new WorldStore()`；
- [x] 新 Runtime 内核没有直接文件 API；
- [x] request/result/event operationId 可完整关联；
- [x] runtime tests/build 通过（Core 共 124 项，新 Runtime 14 项；TUI PTY E2E 4 项）。

## 10. Stage 6：业务 Operations

### 目标

把 submission 转换为 ArchiveTransaction draft，替代 `WorldStore` 的全部正式写入。

### 新增文件

```text
packages/core/src/operations/
  initialize-world.ts
  start-session.ts
  submit-planning.ts
  submit-play.ts
  submit-revise.ts
  cancel-session.ts
  settle-day.ts
  abandon-day.ts
  builders/
    canon-revision.ts
    day-revision.ts
    commit.ts
```

### 修改清单

- [x] init 发布 manifest、canon、首个 commit 和 current；
- [x] start planning/play/revise 发布 session-boundary commit；
- [x] planning submission 发布 planned day revision；
- [x] play submission 发布 awaiting-settle day revision；
- [x] revise submission 发布完整新 canon revision；
- [x] cancel 发布复制 base 引用的新稳定 commit；
- [x] settle 发布 settled day revision并推进 day；
- [x] abandon 发布 abandoned day revision并回到前一天；
- [x] 每个 operation 只接收领域数据和 ArchiveRepository/ArchiveTransaction；
- [x] 所有 submission operation 先 validate submission；
- [x] 所有 operation 产物可以被 ArchiveReader 读回；
- [x] operation 不接受任意绝对路径。

### 删除

- [x] Stage 9 删除 `src/world-store.ts`；
- [x] Stage 9 删除 `CoreInitPayload/CorePlanningPayload/CorePlayPayload/CoreRevisePayload`；
- [x] 新 Operations 不直接写 `current.json`；
- [x] 新 Operations 不原地覆盖 canon/day；
- [x] Stage 9 删除对应旧文件结构测试。

### 退出门槛

- [x] 新架构中只有 ArchiveRepository 可以发布 current pointer；
- [x] 每个 operation 有成功流程和故障注入测试；
- [x] revision、parent、operation 和 dayHeads 引用一致；
- [x] operations/archive/runtime tests 通过。

## 11. Stage 7：真实业务 Sessions

### 目标

让真实 Session 只生成明确 submission，不再拥有正式存档写入能力。

### 修改文件

```text
packages/core/src/sessions/
  conversation-client.ts
  promptpile-client.ts
  natural-language-session.ts
  handler-session.ts
  implementations/
    init-session.ts
    planning-session.ts
    revise-session.ts
    play-session.ts
```

### 修改清单

- [x] `createNaturalLanguageSessionFactory()` 不再创建 WorldStore；
- [x] prompt context 从 readonly WorldSnapshot 和明确 archive read model 构建；
- [x] init Session 生成 InitSubmission；
- [x] planning Session 生成 PlanningSubmission；
- [x] revise Session 生成完整 CanonDocuments；
- [x] play Session 生成 beat/event/transcript 完整 PlaySubmission；
- [x] transcript/checkpoint 只写 SessionWorkspace；
- [x] provider delta 只产生同 messageId 的流式事件；
- [x] opening/完整回复统一转换为 start/delta/end；
- [x] AI 失败不修改 world；
- [x] AbortError 不产生虚假 assistant end；
- [x] prepareSubmit 只调用 read model，不直接调用 archive；
- [x] complete/fail submit 正确更新 Session status；
- [x] cancel/dispose 通过 SessionManager 中断并等待 active provider task。

### 顺序

1. init；
2. planning；
3. revise；
4. play。

### 退出门槛

- [x] 目标 natural/handler Session 不导入 ArchiveRepository、WorldStore 或文件系统实现；
- [x] Session submission 全部通过 runtime validator；
- [x] deterministic fake provider 覆盖 init/planning/play/revise 完整流程；
- [x] stream/error/abort 测试通过；
- [x] sessions/runtime/operations tests 通过。

`native-session.ts` 是 Stage 9 删除的旧 JSON 测试入口，不属于目标 Session 实现。目标实现通过 `SessionWorldReadModel` 读取结构化数据，Archive adapter 位于 `archive/session-world-read-model.ts`，依赖方向不反转。

## 12. Stage 8：恢复、GC 与诊断

### 修改清单

- [x] current 指向 Session phase 时读取 activeSession.baseCommitId；
- [x] planning 恢复到 idle 新 revision；
- [x] playing 恢复到 planned 新 revision；
- [x] revising 恢复到 idle 新 revision；
- [x] init 中断保持 uninitialized；
- [x] current 已发布、operation 仍 prepared 时校正为 published；
- [x] start-session outcome 标记 interrupted；
- [x] 实现 ArchiveInspection；
- [x] 构建 commit/canon/day 引用图；
- [x] 默认保留 current parent 历史链；
- [x] 清理不可达 object、过期终态 workspace 和 current tmp；
- [x] publish lock stale owner 安全回收，GC 删除也持有同一锁；
- [x] Runtime/Session listener 和 Archive 内部异常进入 CoreLogger；
- [x] 日志失败不改变 archive 事实。

### 退出门槛

- [x] transaction 发布点和 Session recovery 失败点有恢复测试；
- [x] GC 前后 current snapshot 相同；
- [x] GC 不删除可达历史或 active workspace；
- [x] invalid 诊断包含安全相对路径和引用 id；
- [x] recovery/gc tests 通过。

## 13. Stage 9：删除过渡实现与系统验收

### 清理清单

- [x] 删除根目录过渡 re-export 中不再公开的符号；
- [x] 删除 `CoreRuntime` 同步构造入口；
- [x] 删除 `WorldStore` 及所有引用；
- [x] 删除 `createCoreNativeSessionFactory` 及 JSON Session；
- [x] 删除 `payload: unknown` submission；
- [x] 删除 `beforePublish` 回调；
- [x] 删除当前 phase/day 形式的 current fixture；
- [x] 扫描正式存档写入，确认只有 archive 层拥有发布权；
- [x] 扫描目标 Session imports，确认不存在 archive/filesystem 反向依赖；
- [x] 检查 package 根导出与文档；
- [x] 更新 package README 的实现状态。

`promptpile-client.ts` 是 provider adapter，会在系统临时目录构造 promptpile 调用工程；这些文件不是 world archive，也不具有 phase/current 发布能力。

### 完整流程

- [x] uninitialized -> init -> idle；
- [x] idle -> daily -> planning -> submit -> planned；
- [x] planned -> play -> playing -> submit -> awaiting-settle；
- [x] awaiting-settle -> settle -> next-day idle；
- [x] idle -> revise -> revising -> submit -> idle；
- [x] planning/playing/revising cancel；
- [x] planned/awaiting-settle abandon-day；
- [x] AI 流式前失败、流式中失败、abort；
- [x] submit/cancel/archive 冲突；
- [x] Runtime dispose 和重入；
- [x] 中断 Session 恢复；
- [x] invalid archive；
- [x] GC。

### 最终验收命令

```bash
npm run build -w @dayloom/core
npm run test -w @dayloom/core
```

最终还必须满足：

- [x] 专题文档的公开接口与 `dist/*.d.ts` 一致；
- [x] 存档 fixture 与 archive schema 一致；
- [x] 所有公共错误可以 JSON 序列化；
- [x] 所有后台任务可终止；
- [x] 所有 mutation 失败路径释放 lock；
- [x] 不存在绕过状态机的 phase 修改；
- [x] 不存在绕过 ArchiveTransaction 的正式存档发布。

## 14. 文件级改造索引

| 当前文件 | 目标处理 | Stage |
|----------|----------|-------|
| `src/types.ts` | 拆分后作为根类型聚合或删除 | 1 |
| `src/errors.ts` | 增加稳定 RuntimeErrorCode 和内部 cause logging | 1、8 |
| `src/session-manager.ts` | 迁入 `sessions/` 并改成 prepare/activate | 2 |
| `src/message-store.ts` | 迁入 `sessions/`，保留聚合逻辑 | 2 |
| `src/commands.ts` | 迁入纯 domain availability | 4 |
| `src/transitions.ts` | 迁入纯 domain state machine | 4 |
| `src/runtime.ts` | 由异步 Runtime 和依赖编排替换 | 5 |
| `src/world-store.ts` | 被 archive + operations 完全替换后删除 | 3、6 |
| `sessions/fake-session.ts` | 改为新 Session contract 的测试实现 | 2 |
| `sessions/handler-session.ts` | 改为 prepare/complete/fail submit | 2 |
| `sessions/native-session.ts` | 拆分为 submission builder 或删除直接 JSON 写入实现 | 6、7 |
| `sessions/natural-language-session.ts` | 去掉 WorldStore，只产生 submission | 7 |
| `sessions/conversation-client.ts` | 保留 provider 无关接口，补错误/abort 测试 | 7 |
| `sessions/promptpile-client.ts` | 保留 adapter，校准 stream/abort | 7 |
| `test/index.test.js` | 拆分为模块测试 | 0 |

## 15. 阶段状态记录

实施时只更新下表和对应 Stage 的 checkbox，不修改已经冻结的目标契约。

| Stage | 状态 | 完成提交 | 备注 |
|-------|------|----------|------|
| 0 基线与测试 | completed | - | 原有 37 个行为测试保留，新增 4 个 helper 测试 |
| 1 类型与 Schema | completed | - | 新增 domain/schema/infrastructure 契约、validator 与 36 个 schema 测试 |
| 2 SessionManager | completed | - | prepare/activate、三步 submit、workspace、后台任务和流式幂等已验证 |
| 3 ArchiveRepository | completed | - | ArchiveRepository、transaction、reader、inspection 与 GC 已实现并验证 |
| 4 状态机 | completed | - | availability/transition 已收敛为纯 domain 模块 |
| 5 Runtime | completed | - | 新异步 Runtime 内核及默认 Operations 端口已验证，公共入口已于 Stage 7 切换 |
| 6 Operations | completed | - | 8 类 Archive 业务发布点及故障注入已验证 |
| 7 Sessions | completed | - | 自然语言 Session 已改用 Archive read model，TUI 已切换异步 Runtime；完整 provider 流程与 PTY 测试通过 |
| 8 恢复与 GC | completed | - | 三类 Session 恢复、init 中断、operation 校正、引用图、带锁 GC 与诊断已验证 |
| 9 系统验收 | completed | - | 旧 Runtime/WorldStore/native Session 已删除，公共 API、构建产物、Core 与 TUI 系统流程已验收 |
