# Core Refactor Plan

> **类型**：plan · **状态**：archived · **现行架构**：[DESIGN](../../architecture/DESIGN.md)  
> 范围：新 Core 的实现阶段、依赖顺序、交付物、测试和退出门槛
> 原则：每个阶段必须形成可独立验证的稳定边界，不能用后续模块掩盖当前模块的缺陷。

## 1. 执行原则

- 只实现 [DESIGN](../../architecture/DESIGN.md) 定义的目标架构；
- 先冻结公共契约和 archive schema，再扩大业务实现；
- SessionManager 优先实现，因为它可以通过 fake Session 独立验证；
- 状态机保持纯逻辑，测试不得依赖文件系统；
- ArchiveRepository 独立验证原子发布和失败恢复；
- Runtime 只在三项基础能力稳定后开始整合；
- 业务 Session 通过明确 submission 类型接入，不返回任意 `unknown`；
- 每阶段完成时必须通过 build、unit test、类型导出和文档一致性检查；
- 未达到退出门槛时不进入下一阶段。

## 2. 阶段依赖

```text
Phase 0  Shared contracts and test harness
    |
    +---------> Phase 1  SessionManager foundation
    |
    +---------> Phase 2  Archive foundation
    |
    +---------> Phase 3  Pure state machine
                      |
                      v
               Phase 4  Runtime integration
                      |
                      v
               Phase 5  Business schemas/operations
                      |
                      v
               Phase 6  Real Sessions
                      |
                      v
               Phase 7  Recovery, GC, observability
                      |
                      v
               Phase 8  System hardening
```

Phase 1、2、3 在 Phase 0 后可以并行，但建议按编号完成，降低同时变更多份公共类型的成本。

## 3. Phase 0：契约冻结与测试基础

### 目标

建立所有后续模块共同依赖的类型、schema 和测试工具，不实现完整业务流程。

### 交付物

- `WorldPhase`、`SessionKind`、`SessionStatus`；
- Core command 和结构化 availability reason；
- RuntimeError、JsonValue、operation/session/message id 类型；
- SessionEvent、RuntimeEvent 的初始 discriminated union；
- Init/Planning/Play/Revise submission schema；
- archive manifest/current/commit/operation/day/canon schema；
- clock、id generator、filesystem、logger 接口；
- 临时目录、fake clock、deterministic id、failure injection 测试工具；
- JSON schema 或等价 runtime validator。

### 约束

- 所有公开接口、字段和 union member 带注释；
- 公共类型不得出现未约束 `unknown` payload；
- 公共错误可 JSON 序列化；
- 文件路径必须使用经过校验的领域 id 组合，不接受任意绝对路径。

### 退出门槛

- 类型编译通过；
- 每份 archive schema 有 valid/invalid fixture；
- submission discriminated union 可穷尽匹配；
- 所有公共类型从 package 根入口可按计划导出；
- 文档示例与 TypeScript 类型一致。

## 4. Phase 1：SessionManager 基础

### 目标

在不依赖真实 archive、状态机和 AI provider 的情况下完成会话生命周期。

### 交付物

- `RuntimeSession` 接口；
- `SessionFactory`；
- `SessionWorkspace` fake 实现；
- `prepareSession/activateSession/discardPreparedSession`；
- active Session 查询；
- input background task 和 AbortController；
- `prepareSubmit/completeSubmit/failSubmit`；
- cancel/dispose；
- SessionEvent listener；
- MessageStore；
- FakeSession 和可控 deferred task。

### 必测场景

- factory/start 成功与失败；
- start 期间事件缓冲和顺序；
- candidate discard 不泄漏事件或资源；
- 重复创建返回 `SESSION_ALREADY_ACTIVE`；
- waiting-input 才接受 input；
- 同时只允许一个输入 task；
- streaming/loading 时 cancel/dispose abort；
- submit prepare 失败不清除 Session；
- complete submit 后终止并清除；
- fail submit 可恢复或进入 failed；
- listener 抛错隔离；
- 未观察 Promise rejection 为零；
- MessageStore 流式聚合幂等。

### 退出门槛

- SessionManager 测试不创建正式 world archive；
- 所有状态转移有断言；
- 所有后台 task 在测试结束前完成或被 abort；
- 无悬空 timer、listener 或 Promise；
- Session 不能发出 Runtime/world/command 事件。

## 5. Phase 2：Archive 基础

### 目标

实现 [Archive Format](../../reference/ARCHIVE_FORMAT.md) 的独立存档层，使业务有效性完全由 current pointer 和不可变引用决定。

### 交付物

- ArchiveReader；
- ArchiveValidator；
- ArchiveRepository；
- ArchiveTransaction；
- operation workspace；
- 不可变 canon/day/commit 写入；
- current pointer 原子替换；
- compare-and-swap revision 校验；
- ArchiveInspection；
- failure-injection filesystem。

### 实现顺序

1. schema validator 和安全路径；
2. uninitialized/current archive reader；
3. transaction workspace；
4. immutable object staging；
5. commit staging；
6. current pointer atomic publish；
7. conflict detection；
8. inspection 和 orphan 识别。

### 必测故障点

- 写 operation.json 前后；
- 写 canon/day revision 中途；
- 写 commit 前后；
- 写 current temp 失败；
- rename current 失败；
- current rename 成功、operation status 尚未更新时崩溃；
- 两个 transaction 基于同一 revision 并发发布；
- current 指向缺失/损坏 commit；
- commit 指向缺失 canon/day revision；
- orphan 文件存在。

### 退出门槛

- 发布点之前任何失败都不改变 `readCurrent()`；
- 发布点之后恢复结果确定为新 commit；
- archive conflict 不覆盖新状态；
- 正式读取从不访问 workspace；
- orphan 数量不影响业务快照；
- 所有 invalid 类型有结构化诊断。

## 6. Phase 3：纯状态机

### 目标

实现 [Commands](../../reference/COMMANDS.md) 的 availability 和 transition，不引入副作用。

### 交付物

- command registry；
- `getAvailableCommands()`；
- world command transition；
- submit transition；
- cancel transition；
- phase-to-session-kind 映射；
- 结构化 unavailable reason。

### 测试矩阵

- 所有 phase × 所有 command；
- Session active/inactive；
- 每个 Session kind；
- 每个 Session status；
- submission kind 匹配/不匹配；
- day 存在/不存在；
- invalid；
- 输入对象不被修改；
- availability enabled 时对应 transition 必须可计算。

### 退出门槛

- 测试不使用文件、AI 或真实 Session；
- transition 是确定纯函数；
- availability 与 transition 不存在规则重复漂移；
- 每个失败都有稳定错误码。

## 7. Phase 4：Runtime 整合

### 目标

将 SessionManager、ArchiveRepository 和状态机组合成完整但尚未接真实业务 Session 的 Runtime。

### 交付物

- 异步 `createDayloomRuntime()`；
- RuntimeSnapshot；
- mutation lock；
- operation id；
- input API；
- command API；
- RuntimeEvent dispatch；
- listener isolation；
- Session prepare/activate 编排；
- submit/cancel archive 编排；
- settle/abandon operation 占位实现；
- dispose。

### 测试方式

使用 FakeSessionFactory、内存或临时目录 ArchiveRepository、fake clock 和 deterministic id，验证 Runtime 自身，不调用真实 AI。

### 必测场景

- unavailable command rejected；
- command started/succeeded/failed 顺序；
- world/session 原子可见性；
- Session start 与 archive boundary 任一失败；
- input 迅速返回；
- streaming 中 cancel/dispose；
- submit archive 失败后 Session 保留；
- cancel archive 失败后 phase 不伪变；
- listener 内读取新 snapshot；
- listener 重入返回 busy；
- archive conflict；
- invalid Runtime；
- repeated dispose。

### 退出门槛

- Runtime 不直接调用文件系统或 provider；
- read API 不观察半状态；
- request/result/event operation id 一致；
- 所有失败路径释放 lock；
- loading 生命周期在异常路径成对结束。

## 8. Phase 5：业务 Schema 与 Operations

### 目标

将业务 submission 转换为 archive draft，完成所有正式写入操作，但暂不依赖自然语言 Session。

### 交付物

- InitOperation；
- PlanningSubmitOperation；
- PlaySubmitOperation；
- ReviseSubmitOperation；
- SettleDayOperation；
- AbandonDayOperation；
- CancelSessionOperation；
- 对应 canon/day/commit draft builder；
- 全部 submission runtime validation。

### 不变量

- operation 只接受领域数据，不接受任意目标路径；
- init 首次发布 manifest/canon/commit/current；
- planning 创建新 planned day revision；
- play 创建 awaiting-settle day revision；
- revise 创建新完整 canon revision；
- settle/abandon 创建新 day revision；
- cancel 发布新 revision，不把 pointer 倒退。

### 退出门槛

- 每个 operation 有 golden archive fixture；
- 每个 operation 有写入中途失败测试；
- 产出的 archive 可被 ArchiveReader 完整读回；
- 状态机目标与 commit world state 一致；
- revision、parent 和 operation 引用全部正确。

## 9. Phase 6：真实业务 Sessions

### 目标

实现 init、planning、play、revise Session，并只通过 submission 与正式业务写入连接。

### 顺序

1. init Session；
2. planning Session；
3. revise Session；
4. play Session。

play 最后实现，因为它同时涉及多轮对话、beat 状态、event、transcript 和最终结算前产物。

### 每个 Session 的固定分层

```text
prompt builder
conversation client
stream adapter
response parser
domain accumulator
submission builder
```

### 约束

- provider delta 只转换为 assistant message delta；
- Session 不读取 current pointer；
- Session 不写正式 canon/day/commit；
- Session checkpoint 只写 operation workspace；
- submit result 必须通过 Phase 0 schema；
- AI 失败不推进 world phase；
- abort 不产生虚假 assistant end。

### 退出门槛

- 每种 Session 可用 deterministic fake conversation 完成多轮测试；
- 流式和非流式 provider 产生同一语义消息；
- submission 能被对应 Phase 5 operation 发布；
- play 的 beat/event/transcript 引用一致；
- provider 和工具资源在 cancel/dispose 后释放。

## 10. Phase 7：恢复、GC 与可观测性

### 目标

完成长期运行与异常退出需要的 archive 运维能力。

### 交付物

- interrupted Session recovery；
- prepared/published operation status reconciliation；
- archive inspection report；
- orphan reference graph；
- conservative GC；
- internal CoreLogger；
- operation id 关联日志；
- listener/provider/filesystem 原始异常内部记录。

### 退出门槛

- planning/playing/revising 崩溃恢复到 base stable state 并发布新 revision；
- init 崩溃仍是 uninitialized；
- current 已发布但 operation 未标记时识别为成功；
- GC 不删除 current 历史链可达对象；
- 日志失败不改变 archive 事实；
- inspect 本身只读。

## 11. Phase 8：系统加固

### 目标

在目标能力完整后验证跨模块不变量和压力场景。

### 测试范围

- 完整 init -> daily -> play -> settle 流程；
- idle -> revise -> idle；
- planning/play/revise cancel；
- planned/awaiting-settle abandon-day；
- 每个 archive 发布点故障注入；
- 长流式回复与大 transcript；
- 重复 delta/end/error；
- mutation 并发和 archive conflict；
- 进程退出与恢复；
- invalid archive 分类；
- GC 前后快照一致；
- dispose 期间后台 task；
- 公共对象序列化。

### 退出门槛

- build、unit、integration、failure-injection 测试全部通过；
- 文档 schema 与导出类型自动校验；
- 不存在从 Session 到正式 archive 的旁路写入；
- 不存在绕过状态机的 phase 修改；
- 不存在绕过 ArchiveTransaction 的 current pointer 写入；
- 所有后台任务都有 owner 和终止路径；
- 所有公共错误有稳定 code。

## 12. 每阶段完成清单

每完成一个 Phase，统一执行：

1. 更新对应专题文档的“已实现范围”，不修改目标契约；
2. 检查 package 根导出；
3. 运行类型构建；
4. 运行该模块 unit tests；
5. 运行此前所有阶段回归测试；
6. 扫描越层依赖；
7. 执行 archive fixture/schema 校验；
8. 记录尚未完成但不阻塞下一阶段的明确限制。

## 13. 禁止的临时方案

- 从自然语言字符串中解析 Core command；
- Session 直接改 phase/current pointer；
- Runtime 直接调用 `fs` 写业务文件；
- 用目录中“最新文件”代替 current pointer；
- 在已发布 revision 上原地覆盖内容；
- submit 清除 Session 后才开始 archive publish；
- cancel 将 current pointer 直接倒退到旧 revision；
- 把 provider chunk 当成多条完整消息；
- listener 异常中断 Runtime mutation；
- 用 `unknown` 作为长期公开 submission payload；
- 用日志重放替代 commit/current 事实来源。
