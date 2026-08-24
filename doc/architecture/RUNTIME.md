# Runtime

**状态**：Implemented
**最后核对**：2026-08-24

应用通过 `createDayloomCore()` 异步创建 Runtime。实例同步暴露状态与 capabilities，异步执行生命周期动作，并通过 `CoreEvent` v1 流式报告工作与用户可见 Final。

所有 mutation 使用非排队的单写者边界；同一实例的重叠操作返回 `BUSY`。会话固定 Archive revision，提交前再次比较；冲突会刷新可见 World 并保持发布原子性。取消拥有终止线性化权，`dispose()` 等待子进程和事件管道排空且幂等。

完整 API、状态机、结果和 React 终止证据见 [Core Runtime V1](/contracts/CORE_RUNTIME_V1)。
