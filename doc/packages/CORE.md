# @dayloom/core

> **类型**：package  
> **状态**：implemented  
> **最后核对**：2026-07  
> **代码入口**：`packages/core/src/index.ts`

## 1. 范围

`@dayloom/core` 是 Dayloom 的业务运行内核，提供：

- World phase、command availability 和纯状态转移；
- active Session 生命周期与自然语言输入；
- Runtime snapshot、operation id 和语义事件；
- archive repository、transaction、inspection、recovery 和 GC；
- init、daily、play、revise、settle 和 abandon-day 业务操作；
- Promptpile conversation client 和可注入基础设施。

Core 不包含页面、终端布局、快捷键或 slash 语法。

## 2. Runtime 入口

Runtime 必须异步创建，因为首次暴露 snapshot 前需要读取、校验并恢复 archive：

```ts
import {
  createArchiveRepository,
  createArchiveSessionWorldReadModel,
  createDayloomRuntime,
  createNaturalLanguageSessionFactory,
} from '@dayloom/core';

const archive = createArchiveRepository({ worldRoot });
const runtime = await createDayloomRuntime({
  worldRoot,
  archiveRepository: archive,
  sessionFactory: createNaturalLanguageSessionFactory({
    readModel: createArchiveSessionWorldReadModel(archive),
    client,
  }),
});
```

## 3. DayloomRuntime

```ts
interface DayloomRuntime {
  getSnapshot(): RuntimeSnapshot;
  getAvailableCommands(): CommandAvailability[];
  sendInput(input: RuntimeInput): Promise<RuntimeResult>;
  executeCommand(request: RuntimeCommandRequest): Promise<RuntimeResult>;
  subscribe(listener: RuntimeEventListener): RuntimeUnsubscribe;
  dispose(): Promise<void>;
}
```

- `getSnapshot()` 和 `getAvailableCommands()` 是同步只读操作。
- `sendInput()` 只处理自然语言，成功表示后台任务已启动，不表示 assistant 回复已结束。
- `executeCommand()` 只处理 Core command。
- `subscribe()` 只发送订阅后事件，listener 异常被隔离。
- `dispose()` 中止可中断任务并且幂等。

完整编排和事件顺序见 [Runtime 架构](/architecture/RUNTIME)。

## 4. 公开模块

| 模块 | 主要导出 |
|------|----------|
| Domain | phases、commands、availability、state machine、transitions |
| Runtime | factory、snapshot/event/result 类型 |
| Sessions | SessionManager、MessageStore、SessionFactory、natural-language/fake/handler Session |
| Archive | repository、transaction、reader、inspection、recovery、GC |
| Operations | RuntimeOperations 和业务 operations |
| Schemas | archive/submission/common 类型与 validators |
| Infrastructure | filesystem、clock、id generator、logger |

## 5. 错误和并发

公开错误是可 JSON 序列化的 `RuntimeError`，不暴露原始 `Error`、AbortSignal 或 provider 私有对象。Runtime 使用非排队 mutation lock；重叠 mutation 返回 `RUNTIME_BUSY`。

archive 发布还使用 base revision compare-and-swap 防止多 Runtime 覆盖。

## 6. 构建与测试

```bash
npm run build -w @dayloom/core
npm run test -w @dayloom/core
```

参见 [测试概览](/testing/OVERVIEW)。

## 7. 相关文档

- [系统架构](/architecture/DESIGN)
- [Command 参考](/reference/COMMANDS)
- [Archive Format](/reference/ARCHIVE_FORMAT)
- [Session Manager](/architecture/SESSION_MANAGER)

