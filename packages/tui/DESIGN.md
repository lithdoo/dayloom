# @dayloom/tui design

TUI 已完成到 `@dayloom/core2` 的原位 backend replacement。

当前冻结的 ownership、projection、消息时序、失败语义、CLI contract、实施顺序和 Definition of Done 统一由仓库根目录的 [`TUI_CORE2_ADAPTATION_DRAFT.md`](../../TUI_CORE2_ADAPTATION_DRAFT.md) 定义。

核心边界：

```text
@dayloom/core2 CoreState/CoreEvent/CoreResult
                    ↓
       TUI-owned presentation projection
                    ↓
              existing BindTTY UI
```

TUI 不提供 legacy Runtime facade，不维护第二套 lifecycle authority，也不读取 Promptpile Conversation artifact。
