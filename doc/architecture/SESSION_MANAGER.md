# Session

**状态**：Implemented
**最后核对**：2026-08-24

Core 直接拥有一个 active Session，不暴露可替换的 Session Manager 框架。Init、Planning、Play 与 Revise 共享生命周期策略，但拥有各自的上下文和严格 submission schema。

每次 send/submit 都分配独立 operationId。Conversation 是可恢复的可见历史；Thought、Observe、Check、临时 work path 与压缩中间值均为私有过程数据。只有通过协议验证的非空 Final 可以成为用户可见输出，只有通过业务 schema 和固定 revision 验证的 submit 才能发布 World。

取消、终止事件和资源所有权见 [Core Runtime V1](/contracts/CORE_RUNTIME_V1)。
