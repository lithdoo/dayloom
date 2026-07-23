# dayloom TUI example

通过 `@dayloom/tui` 的 Hub / Session 全屏界面使用正式 `@dayloom/core` Runtime。

## Prerequisites

- Node.js 18+
- 标准入口构建 `@dayloom/core` 与 `@dayloom/tui`
- 浏览 Hub 不需要 API key；进入自然语言 Session 需要 `DEEPSEEK_API_KEY`
- Windows 建议使用 Windows Terminal

可将 `.env.example` 复制为 `.env`：

```text
DEEPSEEK_API_KEY=sk-...
# DAYLOOM_LLM_MODEL=deepseek-chat
# DAYLOOM_LLM_BASE_URL=https://api.deepseek.com/v1
```

## Standard TUI

打开新 Runtime 使用的独立 `world2` 目录：

```bash
./open-world.sh
```

```bat
open-world.bat
```

该入口构建并启动 `packages/tui`。Hub 可直接浏览；发送自然语言消息时才会调用远端模型。

## Legacy TUI

旧 `core-old/tui-old` 实现仍可用于迁移验证：

```bash
./open-world-old.sh
```

```bat
open-world-old.bat
```

`run-quick.*` 和 `run-tui.*` 同样保留为 legacy 测试入口，不再承接新功能。

## Configuration

标准 TUI 支持以下可选环境变量：

```text
DAYLOOM_LLM_API_NAME=deepseek
DAYLOOM_LLM_MODEL=deepseek-chat
DAYLOOM_LLM_BASE_URL=https://api.deepseek.com/v1
DAYLOOM_LLM_API_KEY_ENV=DEEPSEEK_API_KEY
PROMPTPILE_BIN=/optional/path/to/promptpile
```

详细交互说明见 [`packages/tui/README.md`](../../packages/tui/README.md)。
