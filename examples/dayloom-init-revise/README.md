# dayloom init + revise example

验证 [`packages/dayloom`](../../packages/dayloom/) 的 World 初始化与设定维护流程。

- `init --quick`：创建空骨架，用于自动化 smoke。
- `revise --proposal`：对固定提案执行 dry-run 与受控写盘，用于自动化 smoke。
- `init` + `revise` interactive：首次运行通过 AI 创建 World，后续运行通过 AI + MCP 查询和维护现有设定。

存档布局见 [`packages/dayloom/prompts/spec.md`](../../packages/dayloom/prompts/spec.md) §4。

## Prerequisites

- Node.js
- 脚本会在 [`packages/dayloom`](../../packages/dayloom/) 安装依赖并重新构建，无需在本目录安装 dayloom。
- Quick 与 proposal smoke 无需 API key。
- Interactive 需要 `DEEPSEEK_API_KEY`。
- Interactive revise 需要可用的 `promptpile-mcp` CLI，或已运行的 promptpile-mcp gateway。
- Interactive revise 首次运行会将 `@modelcontextprotocol/server-filesystem` 安装到本示例的 `.runtime/`，之后直接复用本地入口。首次安装需要联网。

从 `.env.example` 复制为 `.env` 后按需填写：

```text
DEEPSEEK_API_KEY=sk-...
# PROMPTPILE_MCP_BIN=/absolute/path/to/promptpile-mcp
# PROMPTPILE_MCP_BASE_URL=http://127.0.0.1:8765
# PROMPTPILE_MCP_TOKEN=...
```

`.env` 与 `output/` 已加入 `.gitignore`，不要提交密钥或运行产物。

## Quick Init Smoke

Windows：

```bat
run-quick.bat
```

macOS/Linux：

```bash
./run-quick.sh
```

流程：清理 `output/world-quick` → `dayloom init --quick` → 验证空 World 骨架。

## Revise Proposal Smoke

Windows：

```bat
run-revise-smoke.bat
```

macOS/Linux：

```bash
./run-revise-smoke.sh
```

流程：

```text
清理 output/world-revise-smoke
  -> init --quick
  -> revise --proposal fixtures/revise-proposal.json --dry-run
  -> revise --proposal fixtures/revise-proposal.json --yes
  -> 验证风格、图书馆场景、revision 归档与 world_revision 日志
```

该流程无需 AI 或 MCP，适合 CI 与本地回归测试。

## Interactive Init + Revise

Windows：

```bat
run-interactive.bat
```

macOS/Linux：

```bash
./run-interactive.sh
```

脚本按 `output/world-interactive/manifest.yaml` 判断运行模式：

| 当前状态 | 行为 |
|----------|------|
| World 不存在 | 启动 AI 访谈并执行 `dayloom init` |
| 已存在有效 World | 启动 `dayloom revise`，保留原有设定 |
| 目录存在但缺少 `manifest.yaml` | 报错退出，避免覆盖残缺目录 |

首次 init 访谈时，每轮输入结束方式：

- Windows：`Ctrl+Z`，然后 Enter
- macOS/Linux：空行处按 `Ctrl+D`

进入 revise 后也使用多行输入。每轮输入完成后，Windows 按 `Ctrl+Z` 再按 Enter，macOS/Linux 在空行处按 `Ctrl+D` 提交。

可使用：

```text
/pending   查看待修改意图
/apply     生成最终提案，查看 diff，确认后应用
/cancel    放弃本次修改并退出
/exit      保留临时 session 草稿并退出
```

`/apply` 成功后会生成 `.loom/revisions/revision_*` 归档，并在 `logs/state_changes.jsonl` 记录 `world_revision`。

## Manual Verification

```bash
node scripts/verify-world.js output/world-quick --mode quick
node scripts/verify-world.js output/world-interactive --mode existing
node scripts/verify-world.js output/world-revise-smoke --mode revise
```

支持的验证模式：

| 模式 | 用途 |
|------|------|
| `quick` | 空骨架 init |
| `interactive` | AI init 结果，要求 canon、人物和 init transcript |
| `existing` | 已有 World 的通用结构 |
| `revise` | 固定 proposal 已应用，且存在 revision 归档和日志 |

## Reset Interactive World

交互脚本不会自动删除已有 World。需要重新体验 init 时，手动删除：

Windows：

```bat
rmdir /s /q output\world-interactive
```

macOS/Linux：

```bash
rm -rf output/world-interactive
```

## Troubleshooting

| 现象 | 处理 |
|------|------|
| `DEEPSEEK_API_KEY is not set` | 设置环境变量或创建 `.env`；Windows 使用 `setx` 后需新开 cmd。 |
| `spawn promptpile ENOENT` | 在 `packages/dayloom` 执行 `npm install`，或重新运行脚本。 |
| `spawn promptpile-mcp ENOENT` | 设置 `PROMPTPILE_MCP_BIN`，安装 `promptpile-mcp` CLI，或使用 `PROMPTPILE_MCP_BASE_URL`。 |
| filesystem MCP 首次安装失败 | 确认网络可访问 npm registry；脚本会在 `.runtime/` 中执行最小安装。 |
| 需要检查 AI 临时 session | interactive 脚本默认启用 `--keep-session`，路径会打印到 stderr。 |
