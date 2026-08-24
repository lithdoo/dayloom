# 环境变量

**状态**：Implemented
**最后核对**：2026-08-24

| 变量 | 用途 |
|---|---|
| `DAYLOOM_LLM_CONFIG` | 未传 `--llm-config` 时的 caller-owned Promptpile TOML 路径 |
| `DAYLOOM_DIAGNOSTIC_LOG_FILE` | 可选 TUI 诊断日志路径 |
| `DAYLOOM_DIAGNOSTIC_RUN_ID` | 可选诊断关联 ID |
| provider 自己的 key 变量 | 由 TOML 的 `api_key_env` 引用，例如 `DEEPSEEK_API_KEY` |

模型、base URL、provider 名称和 key 变量名只在 caller-owned TOML 中配置。Core 不读取旧式 provider override，也不接受 Promptpile 二进制或 React 配置覆盖。

