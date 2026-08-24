# @dayloom/tui

`@dayloom/tui` 是由 `@dayloom/core` application semantics 驱动的 Dayloom 全屏终端界面。TUI 只负责 Hub/Session 展示、输入、流式 transcript、焦点与滚动；World、Session、publication 和 cancellation truth 均由 Core 持有。

## 使用

需要 Node.js 20+、一个 World 目录和 caller-owned Promptpile TOML：

```bash
npm run build -w @dayloom/archive-protocol -w @dayloom/core -w @dayloom/tui
node packages/tui/dist/main.js ./path/to/world --llm-config ./llm.toml
```

也可以通过环境变量提供配置路径：

```bash
DAYLOOM_LLM_CONFIG=./llm.toml npm run tui -- ./path/to/world
```

`--llm-config` 优先于 `DAYLOOM_LLM_CONFIG`。配置由 Core/Promptpile 解释；TUI 不解析 provider topology。`--help` 不需要配置，也不会创建 Core。

Hub 使用选择框进入业务流程。Session 中输入自然语言，使用 `/submit` 提交，使用 `/exit` 或 `/cancel` 取消；AI 正在回复时仍可用这两个指令中断。

## 验证

```bash
npm run test -w @dayloom/tui
```

该命令执行 build、architecture guard、unit 和 PTY tests。生产源码禁止旧 Core、Core deep import、backend facade、operation queue 和 cancellation manager。

## 文档

- [TUI 使用指南](../../doc/guide/TUI.md)
- [TUI 包文档](../../doc/packages/TUI.md)
- [TUI E2E](../../doc/testing/TUI_E2E.md)
