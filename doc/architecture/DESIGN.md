# 系统架构

**状态**：Implemented
**最后核对**：2026-08-24

Dayloom 只有一条产品依赖链：TUI 依赖 Core 的应用契约，Core 依赖 Archive Protocol 的纯协议原语，并在内部组合 Promptpile Conversation、Compression 与 React。

```text
@dayloom/tui
      │ CoreState / capabilities / CoreEvent / CoreResult
      ▼
@dayloom/core
      ├── Session 与取消
      ├── Promptpile 适配
      ├── World Profile V1 验证与 mutation builder
      └── Archive 发布策略
              │
              ▼
@dayloom/archive-protocol
```

TUI 不解析错误文本决定业务跳转；Core 不拥有终端布局；Archive Protocol 不依赖产品业务。具体契约见 [Core Runtime V1](/contracts/CORE_RUNTIME_V1) 与 [World Profile V1](/contracts/WORLD_PROFILE_V1)。
