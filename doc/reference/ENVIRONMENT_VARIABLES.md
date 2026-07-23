# 环境变量

> **类型**：reference  
> **状态**：implemented  
> **最后核对**：2026-07  
> **代码入口**：`packages/core/src/sessions/promptpile-client.ts`

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `DAYLOOM_LLM_API_NAME` | `deepseek` | Promptpile `llm_api` 名称 |
| `DAYLOOM_LLM_MODEL` | `deepseek-chat` | provider 模型名 |
| `DAYLOOM_LLM_BASE_URL` | `https://api.deepseek.com/v1` | OpenAI-compatible API base URL |
| `DAYLOOM_LLM_API_KEY_ENV` | `DEEPSEEK_API_KEY` | 存放 API key 的环境变量名 |
| `DEEPSEEK_API_KEY` | 无 | 默认 provider 的 API key |
| `PROMPTPILE_BIN` | 自动解析 | Promptpile 可执行文件路径 |

## 自定义 provider

```bash
export DAYLOOM_LLM_API_NAME=my-provider
export DAYLOOM_LLM_MODEL=my-model
export DAYLOOM_LLM_BASE_URL=https://provider.example/v1
export DAYLOOM_LLM_API_KEY_ENV=MY_PROVIDER_API_KEY
export MY_PROVIDER_API_KEY=your-key
```

provider 必须提供 Promptpile 可用的 OpenAI-compatible streaming API。

## Promptpile 解析

`PROMPTPILE_BIN` 非空时直接执行该路径。否则优先寻找已安装 `promptpile` 包的 `dist/index.js`，最后回退到 `PATH` 中的 `promptpile`。

