# 快速开始

**状态**：适用于 1.0.0-beta.1
**最后核对**：2026-08-24

要求 Node.js 20 或 22，以及支持 raw mode 与 ANSI 的终端。

```bash
npm install
npm run build
```

复制 `examples/dayloom-tui/llm.example.toml` 为 `llm.toml`，按 provider 要求设置 API key，然后启动：

```bash
node packages/tui/dist/main.js ./world --llm-config ./llm.toml
```

`world` 可以是空目录，Init Session 会创建首个 Archive V2/Profile V1 revision。之后在 Hub 根据 capabilities 进入 Planning、Play、Settle 或 Revise。会话中输入自然语言继续对话，使用 `/submit` 明确发布，使用 `/cancel` 或 `/exit` 返回 Hub。

也可直接运行 `examples/dayloom-tui/open-world.sh` 或 Windows 的 `open-world.bat`。配置详情见 [环境变量](/reference/ENVIRONMENT_VARIABLES)。
