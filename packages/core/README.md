# @dayloom/core

Dayloom 的业务运行内核。

目标能力：

- world phase、Core command 和纯状态转移；
- active Session 生命周期、自然语言输入、显式 submit/cancel；
- assistant 流式事件、后台任务和取消；
- 不可变 revision、operation workspace 和原子存档发布；
- Runtime snapshot、operation id、语义事件和结构化错误；
- init、planning、play、revise、settle 和 abandon-day 业务操作。

Core 不包含页面、终端文本、快捷键或应用级指令。

## Runtime 入口

Runtime 必须异步创建，因为首次读取会校验 archive 并恢复中断 Session：

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

旧同步 Runtime、可变 `WorldStore` 和 JSON native Session 已删除。正式 world 数据只能通过 `ArchiveRepository` 和 `ArchiveTransaction` 读写。

## 文档

- [Core 包文档](../../doc/packages/CORE.md)
- [系统架构](../../doc/architecture/DESIGN.md)
- [Runtime](../../doc/architecture/RUNTIME.md)
- [Session Manager](../../doc/architecture/SESSION_MANAGER.md)
- [Command 参考](../../doc/reference/COMMANDS.md)
- [Archive Format](../../doc/reference/ARCHIVE_FORMAT.md)

## 构建与测试

```bash
npm run build -w @dayloom/core
npm run test -w @dayloom/core
```
