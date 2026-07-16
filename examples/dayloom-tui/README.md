# dayloom TUI example

通过 `@dayloom/tui` 的全屏界面体验 `runGameShell`：从 shell 提示符进入 init / daily / play / settle，无需在多个 CLI 子命令之间切换。

布局为五行全屏：Header → MessageList → LoadingBar → TextInput → Footer。详见 [`packages/tui/README.md`](../../packages/tui/README.md)。

## Prerequisites

- Node.js
- 脚本会在 [monorepo 根目录](../../) 安装依赖并构建 `@dayloom/core`、`@dayloom/cli`、`@dayloom/tui`
- **Quick 演示**无需 API key
- **完整 AI 流程**需要 `DEEPSEEK_API_KEY` 与可用的 `promptpile-mcp`（或 MCP 网关）
- **Windows** 建议使用 Windows Terminal，以获得更好的全屏 alt-screen 支持

从 `.env.example` 复制为 `.env`（仅 `run-tui.*` 需要）：

```text
DEEPSEEK_API_KEY=sk-...
# PROMPTPILE_MCP_BASE_URL=http://127.0.0.1:8765
# PROMPTPILE_MCP_TOKEN=...
```

## 1. Quick TUI Smoke（无需 API key）

创建空 World 骨架并在 TUI shell 中浏览界面（`--no-auto-start`，不会自动进入 init 会话）：

macOS/Linux：

```bash
./run-quick.sh
```

Windows：

```bat
run-quick.bat
```

退出 TUI 后脚本会验证 `output/world-quick`。在 shell 中输入 `/next` 或自然语言触发 quick init 即可落盘。

## 2. Open Local World（无需 API key）

直接使用项目内构建的 `dayloom-tui` 打开本示例的 `world` 目录：

macOS/Linux：

```bash
./open-world.sh
```

Windows：

```bat
open-world.bat
```

## 3. Full Game Shell（需要 API key）

使用相邻示例已创建的 World，在 TUI 中连续体验 daily → play → settle：

```text
../dayloom-init-revise/output/world-interactive   # 源 World
output/world-tui-interactive                      # 本示例副本（首次自动复制）
```

先创建源 World：

```bash
cd ../dayloom-init-revise
./run-interactive.sh
```

再启动 TUI：

macOS/Linux：

```bash
./run-tui.sh
```

Windows：

```bat
run-tui.bat
```

默认 `--locale zh`、`--keep-session`（结算服务保持会话）。启动后会根据 World 阶段自动推荐下一步（`--auto-start` 为默认行为）。

### 输入快捷键

| 操作 | 快捷键 |
|------|--------|
| 换行 | Enter |
| 发送 | Ctrl+Enter |
| 确认 | Y / Enter = 是，N = 否 |

斜杠命令（`/status`、`/next`、`/revise` 等）仍可作为调试后备。

## Reset

删除本示例副本后重新从源 World 复制：

```bash
rm -rf output/world-tui-interactive
```

Windows：

```bat
rmdir /s /q output\world-tui-interactive
```

Quick 演示重置：

```bash
rm -rf output/world-quick
```

## 与 CLI 示例的关系

| 示例 | 入口 | 说明 |
|------|------|------|
| `dayloom-init-revise` | `dayloom init` / `revise` | 创建源 World |
| `dayloom-daily-play` | `dayloom daily` / `play` / `settle` | 分步 CLI 流程 |
| `dayloom-tui` | `dayloom-tui <world>` | 统一 shell，同一界面贯穿全流程 |
