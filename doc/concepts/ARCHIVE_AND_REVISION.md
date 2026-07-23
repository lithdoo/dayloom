# Archive 与 Revision

> **类型**：concept  
> **状态**：implemented  
> **最后核对**：2026-07

Dayloom archive 使用“不可变对象 + 单一可变指针”模型。

```text
current.json
    ↓
commit
  ├─ canon revision
  └─ day revisions
```

## 引用决定有效性

文件存在不等于业务有效。只有从 `current.json` 出发，沿 commit 引用可达的 canon/day revision 才是当前事实。

## Operation workspace

每个多文件操作先在隔离 workspace 内写入产物，通过 schema 和交叉引用校验后才发布。发布的最后一步是原子替换 `current.json`。

在最后一步之前失败，已发布 World 不变；新文件只是未引用对象，可由 inspection/GC 诊断和清理。

## Revision 与 commit

- canon revision 是一份完整且不可变的设定快照。
- day revision 是某一 Day 的计划、行动或结算快照。
- commit 将 World phase、canon revision、day heads 和 active Session 引用组成一致业务快照。
- current pointer revision 是单调递增的发布序号，用于检测并发冲突。

精确目录、schema 和恢复规则见 [Archive Format](/reference/ARCHIVE_FORMAT)。

