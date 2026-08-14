# @dayloom/tui

`@dayloom/tui` 是直接使用 `@dayloom/core2` application API 的 Dayloom 全屏终端界面。

## 使用

先构建 Core2 和 TUI：

```bash
npm run build -w @dayloom/core2 -w @dayloom/tui
```

打开一个有效的 Archive V2 World，并显式提供 Promptpile caller config：

```bash
dayloom-tui ./path/to/world --llm-config ./path/to/llm.toml
```

也可以通过环境变量提供配置路径：

```bash
DAYLOOM_LLM_CONFIG=./path/to/llm.toml npm run tui -- ./path/to/world
```

TUI 只展示 Core2 当前提供的能力。第一版在 `planned` World 中提供 Play：进入 Session 后可多轮输入自然语言，使用 `/submit` 提交，使用 `/exit` 或 `/cancel` 取消并返回 Hub。

LLM provider、模型和凭证由 `llm.toml` 与 Promptpile 解释；TUI 不复制 provider 配置策略。

设计与验收契约见 [`TUI_CORE2_ADAPTATION_DRAFT.md`](../../TUI_CORE2_ADAPTATION_DRAFT.md)。
