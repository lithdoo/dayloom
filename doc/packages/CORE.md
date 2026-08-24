# @dayloom/core

**状态**：稳定契约
**最后核对**：2026-08-24

`@dayloom/core` 是 Dayloom 唯一产品运行时，拥有 World 生命周期、会话工作区、子进程、取消、事件投影与 Archive 发布。应用通过 `createDayloomCore({ worldRoot, llmConfigPath })` 创建实例，通过 `getState()` 和 `capabilities` 驱动界面，通过 `subscribe()` 接收 `CoreEvent` v1，并在退出时调用 `dispose()`。

主入口只导出应用契约；旧 World 导入位于 `@dayloom/core/migration`。内部 Promptpile、World reader、submission builder 和测试 driver 不属于公开 API。

```bash
npm run build -w @dayloom/core
npm run test -w @dayloom/core
```

详细行为见 [Core Runtime V1](/contracts/CORE_RUNTIME_V1)，持久化规则见 [World Profile V1](/contracts/WORLD_PROFILE_V1)。
