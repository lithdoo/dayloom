# Dayloom TUI example

标准 TUI 直接使用 `@dayloom/core2`，需要：

- Node.js 20+
- 一个有效、处于 `planned` phase 的 Archive V2 World
- 一个 Promptpile caller LLM TOML config

```bash
./open-world.sh /absolute/path/to/world /absolute/path/to/llm.toml
```

```bat
open-world.bat C:\path\to\world C:\path\to\llm.toml
```

也可以省略第二个参数并设置 `DAYLOOM_LLM_CONFIG`。脚本会构建 `archive-protocol`、`core2` 和 `tui` 后启动界面。

旧 `core-old/tui-old` 示例仍保留在 `open-world-old.*`、`run-quick.*` 和 `run-tui.*`，仅用于迁移验证。
