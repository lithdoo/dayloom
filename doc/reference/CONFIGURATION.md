# 配置参考

> **类型**：reference  
> **状态**：implemented  
> **最后核对**：2026-07  
> **代码入口**：`packages/tui/src/argv.ts`、`packages/tui/src/runtime-driver/create-runtime-driver.ts`

## TUI 参数

```text
dayloom-tui [worldRoot]
```

| 参数 | 默认值 | 说明 |
|------|--------|------|
| `worldRoot` | 当前工作目录 | World archive 目录；启动时解析为绝对路径 |
| `-h`, `--help` | `false` | 输出 usage 并退出 |

未知 option 或第二个位置参数会报错。

## Runtime driver 默认值

| 项 | 默认行为 |
|----|----------|
| Archive | `createArchiveRepository({ worldRoot })` |
| Session read model | Archive Session read model |
| Session factory | Natural-language Session factory |
| Conversation client | Promptpile conversation client |
| Message 条数上限 | 每 Session 500 |
| Message 文本上限 | 每 Session 250,000 字符 |
| Hub 初始 mode | `status` |

## 终端默认值

- alt screen：开启；
- raw mode：开启；
- terminal cursor：隐藏；
- enhanced keyboard：开启；
- `Ctrl+C`：由应用捕获并执行可控 shutdown；
- Textarea：最少 1 行，最多显示 4 行；
- input history：进程内最近 100 条。

AI provider 配置见 [环境变量](/reference/ENVIRONMENT_VARIABLES)。

