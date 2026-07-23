# Dayloom 系统架构

> **类型**：architecture  
> **状态**：implemented  
> **最后核对**：2026-07  
> **范围**：Core 职责、分层、模块依赖和设计不变量

## 1. 设计目标

Core 是 Dayloom 的业务运行内核。它将 world 存档、业务阶段、会话生命周期和语义事件组织成稳定、可测试、与展示方式无关的接口。

目标：

- 业务状态由明确的状态机管理，而不是从输出文本或零散文件推断；
- 自然语言输入与业务指令使用不同接口；
- world phase 与 Session status 分层建模；
- Session 负责交互和产物，不拥有 world transition 权；
- 所有多文件业务修改通过统一存档事务发布；
- 未发布或未被引用的文件不影响业务状态；
- 流式回复使用稳定消息 id 和语义事件；
- 并发、取消、失败和资源释放具有确定语义；
- 公共快照、事件和错误均可稳定序列化。

## 2. Core 边界

Core 负责：

- world 存档的读取、校验、写入和发布；
- world phase、Core command 与合法状态转移；
- active Session 的创建、输入、提交、取消和释放；
- AI 调用、工具任务和 assistant 流式事件的抽象；
- mutation 串行、operation id、快照和语义事件；
- invalid 状态的识别和只读诊断。

Core 不负责：

- 页面、终端文本、颜色、布局或快捷键；
- 用户输入中的命令语法；
- `help`、`status`、`exit`、`next` 等应用级能力；
- 二次确认、自动提交或草稿按钮；
- 任何特定展示流程。

## 3. 目标分层

```text
Public API
  DayloomRuntime
        |
Application Layer
  command/input orchestration
  mutation lock
  snapshot and event publication
        |
        +-------------------+
        |                   |
Domain Layer          Session Layer
  state machine         SessionManager
  transitions           RuntimeSession
  command rules         stream/task lifecycle
        |                   |
        +---------+---------+
                  |
Persistence Layer
  ArchiveRepository
  ArchiveTransaction
  archive validation
  atomic publication
                  |
Infrastructure Layer
  filesystem
  AI provider
  tool gateway
  clock / id generator
```

依赖方向只能从上向下：

- Domain Layer 不依赖文件系统、AI、Session 或 Runtime；
- Session Layer 不依赖 Runtime，也不能直接提交 world phase；
- Persistence Layer 不依赖 Session 或具体应用；
- Runtime 负责组合各层，但不泄漏内部可变对象；
- Infrastructure 通过接口注入，可在测试中替换。

## 4. 模块职责

### 4.1 Domain State Machine

输入当前 `WorldSnapshot`、`SessionSnapshot` 和明确 Command，输出：

- command availability；
- 合法目标状态；
- 需要创建的 Session kind；
- 稳定错误。

状态机必须是纯逻辑，不直接读写存档或执行 AI。

### 4.2 SessionManager

维护当前进程内唯一 active Session：

- 创建和启动 Session；
- 转发自然语言输入；
- 管理后台 task 和 AbortController；
- 转发窄化 SessionEvent；
- 执行 submit、cancel、dispose；
- 保证 Session 启动事件只在正式发布后可见。

### 4.3 RuntimeSession

表示一次 `init`、`planning`、`play` 或 `revise` 会话。Session：

- 处理自然语言和 AI 交互；
- 产生消息、loading、输入请求和状态事件；
- 在 submit 时返回类型明确的业务产物；
- 不返回目标 world phase；
- 不直接修改正式存档入口。

### 4.4 Application Operations

执行一次完整 Core mutation：

- 校验 command；
- 获取 mutation lock；
- 创建 Session 或调用 Session 控制方法；
- 创建存档 transaction；
- 校验和发布业务产物；
- 提交内存快照；
- 按顺序发布 RuntimeEvent。

### 4.5 ArchiveRepository

是正式存档的唯一读写入口：

- 读取 current revision；
- 校验 manifest、current 和被引用产物；
- 创建 operation workspace；
- 发布 transaction；
- 原子更新 `current.json`；
- 识别未完成 operation 和 orphan；
- 提供只读诊断与后续清理能力。

### 4.6 MessageStore

根据 Session 消息事件按 `sessionId/messageId` 聚合消息。它不属于 world 存档事实来源，也不进入 RuntimeSnapshot。

## 5. 核心不变量

### 5.1 两层状态

`WorldPhase` 描述业务阶段，`SessionStatus` 描述当前会话活动。任何输入、submit 或 cancel 能力都必须同时检查两者。

### 5.2 单一 active Session

同一 Runtime 最多存在一个 active Session。有 Session 的 phase 仅包括：

- `initializing`；
- `planning`；
- `playing`；
- `revising`。

### 5.3 显式提交

AI 回复结束不自动推进 world phase。只有显式 `submit` 才会把 Session 产物交给 Runtime 发布。

### 5.4 输入与指令分离

- `sendInput()` 只处理自然语言；
- `executeCommand()` 只处理 Core command；
- Core 不解析斜杠命令或其它输入语法。

### 5.5 引用决定有效性

文件存在不代表业务有效。只有被已发布 `current.json` 和对应 revision 引用的产物参与业务读取。

### 5.6 最后发布入口

多文件 operation 必须先写入并校验全部业务产物，最后原子替换 `current.json`。发布入口更新失败时，新产物仍视为未发布。

### 5.7 先提交再通知

RuntimeEvent 只能描述已经提交的状态。listener 不能观察到 world 已改变但 Session 尚未建立等半完成快照。

### 5.8 可序列化公共边界

公开 snapshot、event、result 和 error 不包含 `Error`、函数、文件句柄、AbortController 或 provider 私有对象。

## 6. 规范文档

| 文档 | 唯一负责内容 |
|------|--------------|
| [Archive Format](/reference/ARCHIVE_FORMAT) | 存档目录、文件 schema、revision、transaction、发布和恢复 |
| [Commands](/reference/COMMANDS) | world phase、Core command、availability 和 transition |
| [Session Manager](/architecture/SESSION_MANAGER) | Session 契约、状态、事件、后台任务、AI 失败和消息聚合 |
| [Runtime](/architecture/RUNTIME) | Runtime public API、编排、并发、事件顺序和错误 |

发生重复描述时，以负责该主题的专题文档为准，其它文档只保留摘要和链接。

## 7. 建议源码结构

```text
packages/core/src/
  domain/
    phases.ts
    commands.ts
    transitions.ts
  sessions/
    types.ts
    session-manager.ts
    message-store.ts
    implementations/
  archive/
    types.ts
    schemas.ts
    archive-reader.ts
    archive-transaction.ts
    archive-repository.ts
    recovery.ts
  operations/
    create-session.ts
    submit-session.ts
    settle-day.ts
    abandon-day.ts
  infrastructure/
    filesystem.ts
    conversation-client.ts
    promptpile-client.ts
  runtime/
    types.ts
    events.ts
    runtime.ts
  index.ts
```

该结构是重构目标，不要求一次性移动所有文件。每个阶段只在对应接口和测试稳定后调整目录。
