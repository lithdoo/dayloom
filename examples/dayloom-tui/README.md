# Dayloom TUI 示例

此示例通过正式 `@dayloom/tui` 使用 `@dayloom/core`。它从被忽略的空 `world/` 开始，由真实 Init Session 创建 World；启动脚本不会预写 Archive、Canon、计划或 Day 状态。

## 前置条件

- Node.js 20+
- Windows 建议使用 Windows Terminal
- caller-owned `llm.toml` 及其中引用的 provider credential

首次启动会从 `llm.example.toml` 复制生成 `llm.toml`。

Linux/macOS：

```bash
export DEEPSEEK_API_KEY=...
./open-world.sh
```

Windows：

```bat
set DEEPSEEK_API_KEY=...
open-world.bat
```

启动器只检查配置、创建空 World 目录，并按 `archive-protocol -> core -> tui` 构建后运行：

```text
node packages/tui/dist/main.js <world> --llm-config <llm.toml>
```

Session 支持自然语言多轮输入；`/submit` 从持久 Draft 启动校验与发布流水线，`/cancel` 取消当前 Session 或正在运行的操作，`/exit` 退出。对话 Final 不再生成 Submission JSON。

Draft 默认保存在 `world/.dayloom-runtime/drafts`，重启后可以恢复。临时 Candidate、模型 Conversation 与网关目录会在操作结束后清理。

`verify-resize.bat` 使用同一生产启动路径，并将诊断写入 `.runtime/diagnostics`。
