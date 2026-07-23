# World 与 Day

> **类型**：concept  
> **状态**：implemented  
> **最后核对**：2026-07

## World

World 是 Dayloom 中一个长期存档的边界。它包含：

- 稳定身份和标题；
- 当前业务 phase；
- 当前 Day 和最近已结算 Day；
- 当前 canon revision；
- 各 Day 的有效 revision；
- 会话中断恢复所需的 active Session 引用。

World 状态不从目录中“最新的文件”推断，而是从 `current.json` 指向的已发布 commit 读取。

## Day

Day 是计划、行动和结算的业务单位，使用 `day_0001` 这类稳定 id。一个 Day 可以经历：

```text
尚未计划 → planned → awaiting-settle → settled
                                  └→ abandoned
```

每次业务修改创建新的不可变 Day revision，不原地覆盖已发布产物。

## 稳定边界与会话边界

- `idle`、`planned`、`awaiting-settle` 是没有 active Session 的稳定边界。
- `planning`、`playing`、`revising` 是已发布 active Session 引用的会话边界。
- `initializing` 只存在于首次发布前的进程内。

进程在会话边界中断时，下次 Runtime 创建会将 World 恢复到进入 Session 前的稳定 commit。

## 相关文档

- [World 生命周期](/guide/WORLD_LIFECYCLE)
- [Phase 与 Command](/concepts/PHASE_AND_COMMAND)
- [Archive 与 Revision](/concepts/ARCHIVE_AND_REVISION)
- [存档格式](/reference/ARCHIVE_FORMAT)

