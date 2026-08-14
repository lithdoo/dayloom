# 快速开始

> **类型**：guide  
> **状态**：implemented  
> **最后核对**：2026-07

## 环境要求

- Node.js 18 或更高版本。
- 支持 raw mode 和 ANSI 的交互式终端。
- 开启真实 AI 对话时，需要 Promptpile 及可用的 OpenAI-compatible provider。

## 构建

在 Dayloom monorepo 根目录执行：

```bash
npm install
npm run build -w @dayloom/core -w @dayloom/tui
```

## 启动

打开指定 World：

```bash
node packages/tui/dist/main.js ./path/to/world
```

或使用根脚本：

```bash
npm run tui -- ./path/to/world
```

启动参数形式为：

```text
dayloom-tui [worldRoot]
```

- `worldRoot` 是唯一可选位置参数。
- 未传入时使用当前工作目录。
- `-h` 或 `--help` 输出帮助。
- 未知 option 或多余位置参数会以错误退出。

`main.ts` 会将 world 路径解析为绝对路径，异步创建 Runtime driver，再挂载全屏应用。

## AI Provider

默认使用 Promptpile 调用 DeepSeek：

```bash
export DEEPSEEK_API_KEY=your-key
```

可选环境变量：

| 变量 | 默认值 | 用途 |
|------|--------|------|
| `DAYLOOM_LLM_API_NAME` | `deepseek` | Promptpile API 配置名 |
| `DAYLOOM_LLM_MODEL` | `deepseek-chat` | 模型名 |
| `DAYLOOM_LLM_BASE_URL` | `https://api.deepseek.com/v1` | OpenAI-compatible base URL |
| `DAYLOOM_LLM_API_KEY_ENV` | `DEEPSEEK_API_KEY` | 存放 API key 的环境变量名 |
| `PROMPTPILE_BIN` | 自动解析 | 显式指定 Promptpile 可执行文件 |

Promptpile 解析顺序为：显式 `PROMPTPILE_BIN`、已安装包内脚本、`PATH` 中的 `promptpile`。

## World 初始状态

- 目录中没有已发布 archive 时，Hub 提供“初始化 World”。
- archive 有效时，Hub 根据 Core availability 展示下一步流程。
- archive 无效时，状态页展示诊断，业务 command 全部不可用。

## 退出与清理

Hub 中选择“退出”、按 `q` 或按 `Ctrl+C` 都会进入统一 shutdown 流程：

1. 卸载终端应用并恢复终端。
2. 取消 driver 订阅。
3. 释放 Core Runtime 和 active Session 资源。

重复 shutdown/dispose 是安全的。
