# @dayloom/tui

`@dayloom/tui` 是基于 `@dayloom/core` Runtime 的 Dayloom 全屏终端界面。

## 使用

先在 monorepo 根目录构建：

```bash
npm run build -w @dayloom/core -w @dayloom/tui
```

打开指定 World：

```bash
node packages/tui/dist/main.js ./path/to/world
```

也可以使用根脚本：

```bash
npm run tui -- ./path/to/world
```

未传路径时使用当前工作目录。AI 对话默认通过 Promptpile 调用 DeepSeek，需要设置：

```text
DEEPSEEK_API_KEY=...
```

可选 provider 配置：

```text
DAYLOOM_LLM_API_NAME=deepseek
DAYLOOM_LLM_MODEL=deepseek-chat
DAYLOOM_LLM_BASE_URL=https://api.deepseek.com/v1
DAYLOOM_LLM_API_KEY_ENV=DEEPSEEK_API_KEY
PROMPTPILE_BIN=/optional/path/to/promptpile
```

Hub 使用选择框进入业务流程；Session 中输入自然语言，使用 `/submit` 提交、`/exit` 或 `/cancel` 返回 Hub。

## 文档

- [快速开始](../../doc/guide/GETTING_STARTED.md)
- [TUI 使用指南](../../doc/guide/TUI.md)
- [TUI 包文档](../../doc/packages/TUI.md)
- [TUI E2E](../../doc/testing/TUI_E2E.md)
