# Dayloom TUI example

通过 `@dayloom/tui` 使用正式 `@dayloom/core`。示例从被忽略的空 `world/` 开始，由真实 Init Session 创建 World；脚本不预写 Archive、canon、plan、day 或 phase。

## 前置条件

- Node.js 20+
- Windows 建议使用 Windows Terminal
- caller-owned `llm.toml` 和其中引用的 provider credential

首次使用时，启动脚本会自动从 `llm.example.toml` 生成 `llm.toml`：

```bash
export DEEPSEEK_API_KEY=...
./open-world.sh
```

Windows：

```bat
set DEEPSEEK_API_KEY=...
open-world.bat
```

launcher 只检查配置、创建空目录、按 `archive-protocol → core → tui` 构建并运行：

```text
node packages/tui/dist/main.js <world> --llm-config <llm.toml>
```

Session 支持自然语言多轮输入。`/submit` 提交，`/exit` 或 `/cancel` 取消；AI 回复中也可用后两者中断。

`verify-resize.bat` 使用同一生产启动契约，并把诊断写入 `.runtime/diagnostics`。
