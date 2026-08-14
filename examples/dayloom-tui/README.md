# Dayloom TUI example

这是当前 `@dayloom/tui` + `@dayloom/core2` 的最小可运行示例。它连接一个已有的 Archive V2 World 和 Promptpile caller LLM 配置；示例不会创建或修改 World，也不包含 provider 或业务逻辑。

## 前置条件

- Node.js 20+
- 一个有效且处于 `planned` phase 的 Archive V2 World
- 一个 Promptpile caller LLM TOML 配置

复制 [`llm.example.toml`](./llm.example.toml)，填写 provider 的 model、base URL 和凭证环境变量名，然后在环境中设置对应的 API key。不要把 secret 写入 TOML。

## 启动

不传参数时，脚本默认使用当前示例目录下的 `world` 和 `llm.toml`：

```bash
./open-world.sh
```

```bat
open-world.bat
```

脚本会在 `world` 目录不存在时自动创建，并在首次构建后初始化为最小的有效 Archive V2 World；在 `llm.toml` 不存在时，会从 `llm.example.toml` 自动复制一份。默认配置使用 DeepSeek，启动前需设置 `DEEPSEEK_API_KEY`；使用其他 provider 时再修改 `llm.toml`。
也可以继续显式指定路径：

macOS/Linux：

```bash
./open-world.sh /absolute/path/to/world /absolute/path/to/llm.toml
```

Windows：

```bat
open-world.bat C:\path\to\world C:\path\to\llm.toml
```

也可以省略第二个参数，通过 `DAYLOOM_LLM_CONFIG` 提供配置路径。参数、环境变量和默认值的优先级依次为：命令行参数、`DAYLOOM_LLM_CONFIG`、示例目录下的 `llm.toml`。入口脚本会依次构建 `@dayloom/archive-protocol`、`@dayloom/core2` 和 `@dayloom/tui`，再启动当前 TUI。

Session 支持自然语言多轮输入。使用 `/submit` 提交，使用 `/exit` 或 `/cancel` 取消并退出。

## Windows resize smoke

在 Windows Terminal 或经典 Console Host 中运行：

```bat
verify-resize.bat C:\path\to\planned-world C:\path\to\llm.toml
```

该脚本使用与标准入口相同的 World、LLM config、构建步骤和 TUI 启动契约，并将诊断日志写入本目录的 `.runtime\diagnostics`。resize checklist 是人工 smoke，不属于自动化测试。
