# 故障排查

> **类型**：guide  
> **状态**：implemented  
> **最后核对**：2026-07

## TUI 无法启动

1. 确认 Node.js 版本至少为 18。
2. 在 monorepo 根目录构建 Core 和 TUI：

```bash
npm run build -w @dayloom/core -w @dayloom/tui
```

3. 确认当前终端支持 raw mode 和 ANSI。将输出重定向到普通文件不是受支持的全屏使用方式。

## Promptpile 启动失败

Promptpile 可执行文件按以下顺序解析：

1. `PROMPTPILE_BIN`；
2. 已安装 `promptpile` 包的 `dist/index.js`；
3. `PATH` 中的 `promptpile`。

如果自动解析失败，将 `PROMPTPILE_BIN` 设为可执行文件的绝对路径。

## API key 或 provider 错误

默认 provider 需要 `DEEPSEEK_API_KEY`。如果使用其它 OpenAI-compatible provider，同时核对 model、base URL 和 API key 环境变量名。详见 [环境变量](/reference/ENVIRONMENT_VARIABLES)。

## AI 回复中途失败

TUI 会保留已接收的 assistant 文本并显示错误状态。此时输入 `/exit` 或 `/cancel` 返回 Hub。AI 失败不会自动发布 World 修改。

## `/submit` 失败

submission 内容不完整或与 Session kind 不匹配时，Session 保持打开。可以：

- 继续提供信息后再次 `/submit`；
- 使用 `/cancel` 放弃本次 Session。

如果是 archive 冲突，不要尝试手工覆盖 `current.json`；先关闭其它正在修改同一 World 的 Runtime。

## World 显示 invalid

invalid 表示 Core 无法从 archive 建立可信 snapshot。此时：

- 所有业务 command 禁用；
- Hub status 显示结构化错误消息；
- 不要根据文件时间或名称手工挑选“最新” commit；
- 保留 World 副本后，根据 [存档格式](/reference/ARCHIVE_FORMAT) 的引用链检查 manifest、current、commit 和 revision。

## 退出后终端异常

正常情况下 `q` 和 `Ctrl+C` 会运行统一 shutdown 并恢复 alt screen/raw mode。如果进程被外部强制终止，可在 shell 中执行 `reset` 恢复终端。

