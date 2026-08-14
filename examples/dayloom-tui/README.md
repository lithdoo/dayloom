# Dayloom TUI example

通过 `@dayloom/tui` 的 Hub / Session 全屏界面使用正式 `@dayloom/core` Runtime。标准入口不会预置业务状态；空 World 目录会以 `uninitialized` 打开，并由 Hub 提供 `init`。

## 前置条件

- Node.js 18+
- 浏览 Hub 不需要 API key；进入自然语言 Session 需要 `DEEPSEEK_API_KEY`
- Windows 建议使用 Windows Terminal

可将 `.env.example` 复制为 `.env`，或直接在环境中设置凭证。不要把 secret 提交到仓库。

## 启动

不传参数时，脚本使用当前示例目录下的空 `world2` 目录：

```bash
./open-world.sh
```

```bat
open-world.bat
```

入口脚本只创建目录、构建 `@dayloom/core` 与 `@dayloom/tui`，然后启动 TUI；它不会预写 canon、plan、day 或 phase。

Session 支持自然语言多轮输入。使用 `/submit` 提交，使用 `/exit` 或 `/cancel` 取消并退出。

## 配置

标准 TUI 支持 `.env.example` 中列出的 `DAYLOOM_LLM_*` 和 `PROMPTPILE_BIN` 可选环境变量。详细交互说明见 [`packages/tui/README.md`](../../packages/tui/README.md)。

## Windows resize smoke

在 Windows Terminal 或经典 Console Host 中运行：

```bat
verify-resize.bat
```

该脚本使用与标准入口相同的 Core/TUI 启动契约，并将诊断日志写入本目录的 `.runtime\diagnostics`。resize checklist 是人工 smoke，不属于自动化测试。
