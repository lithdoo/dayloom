# dayloom

dayloom 是一个以“天”为推进单位的 AI 生活模拟与日记生成工具。

这个仓库采用 monorepo 布局：

- [`packages/core`](packages/core/)：正式状态机、Runtime 与 Session 引擎（`@dayloom/core`）
- [`packages/core2`](packages/core2/)：Archive V2-only Play Session MVP（`@dayloom/core2`）；独立于现有 TUI，按 [`CORE2_IMPLEMENTATION_DRAFT.md`](CORE2_IMPLEMENTATION_DRAFT.md) 的冻结契约实现
- [`packages/tui`](packages/tui/)：正式全屏 TUI（`@dayloom/tui`，`dayloom-tui`）
- [`packages/cli`](packages/cli/)：**已废弃**的旧 `dayloom` CLI；仍依赖 `@dayloom/core-old`，不再承接新功能
- [`packages/core-old`](packages/core-old/)：旧引擎，仅为 CLI 和迁移验证保留，准备弃用
- [`packages/tui-old`](packages/tui-old/)：旧全屏 TUI（`dayloom-tui-old`），准备弃用
- [`examples/dayloom-tui`](examples/dayloom-tui/)：新旧 TUI 启动示例

`core-old` 与 `tui-old` 不再承接新功能；后续应先迁移 CLI，再删除这两个旧包。

文档原生 World、Archive V2、持久 Promptpile Conversation、staging tools、会话压缩与 ReAct 的整体重构设计见 [`AI_SESSION_REACT_DESIGN.md`](AI_SESSION_REACT_DESIGN.md)。

常用命令（在 monorepo 根目录）：

```bash
npm install
npm run build
npm test
```

> `@dayloom/cli` 已废弃，仅为迁移验证保留。新使用方式请采用 `@dayloom/tui`（`dayloom-tui`）与 `@dayloom/core` Runtime。

旧 CLI 的交互命令通过 `createCliSessionIO()` 注入 `SessionIO`。根目录 `npm install` 后仍可用 `npx dayloom` 进行兼容性验证。

统一 shell 入口（支持 `/status`、`/next`、`/revise` 等斜杠命令路由）：

```bash
npx dayloom shell -d ./world
```
