# 路线图

> **类型**：architecture  
> **状态**：implemented  
> **最后核对**：2026-07

## 当前结论

- Core 新架构的 Stage 0–9 已完成。
- World 正式写入已切换到 ArchiveRepository/ArchiveTransaction。
- Runtime 使用异步 factory，启动时执行 archive 校验和 Session 恢复。
- natural-language Session 通过 Archive read model 读取结构化 World 数据。
- TUI 已使用 Core Runtime driver，关键用户流程具有真实 PTY 验收。

## 维护方向

- 保持 Core 公开 schema、reference 文档和类型 smoke test 同步。
- 对 archive 恢复、GC 和诊断增加长时运行覆盖。
- TUI 可见交互变更必须包含 Runtime driver 测试和真实 PTY 回归。
- 改进发布文档的链接、契约和导航自动检查。

## 历史计划

已完成的 Core 重构计划和实施 checklist 由 Git 历史保存，不作为现行契约发布。

