# Dayloom 文档规范

> **类型**：convention  
> **状态**：implemented  
> **最后核对**：2026-07

## 1. 发布范围

文档只描述当前 `@dayloom/core` 和 `@dayloom/tui`。已弃用实现、实施过程记录和尚未发布的应用入口不保存在产品仓库中。

## 2. 目录语义

| 目录 | 用途 |
|------|------|
| `guide/` | 面向用户的任务导向指南 |
| `concepts/` | 不绑定单一 API 的领域概念 |
| `reference/` | 与代码/schema 精确同步的参考 |
| `packages/` | 可发布包的边界、API 和维护说明 |
| `architecture/` | 系统分层、Runtime 和 Session 内部契约 |
| `testing/` | 测试策略和 E2E 验收 |

`doc/` 根目录只允许 `index.md`、`README.md`、`CONVENTIONS.md` 和站点资源。

## 3. 文档元数据

除首页外，文档文首应包含：

```markdown
> **类型**：guide | concept | reference | package | architecture | testing
> **状态**：implemented | partial
> **最后核对**：YYYY-MM
> **代码入口**：仅 package/reference 需要
```

`partial` 表示文档所述能力仅部分实现，必须在“已知限制”列出缺口。

## 4. 内容边界

- Guide 说明如何完成任务，不展开内部类图。
- Concept 解释领域模型，不复制完整 TypeScript union。
- Reference 记录精确字段、默认值和转移，修改公开契约时必须同步。
- Package 只记录包边界和公开 API，横切细节链到 architecture/reference。
- 设计意图必须与现行实现分开；已完成的阶段计划由 Git 历史保存。

## 5. 链接

- 站内链接使用 VitePress 根路径，例如 `/reference/COMMANDS`。
- 指向源码、测试或 TODO 时使用 `https://github.com/lithdoo/dayloom/...` 绝对链接。
- 活跃页不得使用 `../../packages/...` 这类离开 `doc/` 的相对链接。

## 6. 变更 checklist

改公开 Core API/schema 时：

1. 更新 `packages/CORE.md`。
2. 更新相关 `reference/` 文档。
3. 更新测试回归索引和“最后核对”。

改 TUI 可见行为时：

1. 更新 `guide/TUI.md`。
2. 若改变 driver/state 契约，更新 `packages/TUI.md`。
3. 更新 `testing/TUI_E2E.md` 并增加对应回归。

每次文档结构变更都要同步 `README.md` 和 `.vitepress/config.mts`。

