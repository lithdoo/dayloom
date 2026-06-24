export const PROTOCOL_VERSION = '0.0.0';
export const DEFAULT_MAX_INTERVIEW_ROUNDS = 12;

export const OPENING_ASSISTANT = `你好，我是 day-loom 的世界构建助手。接下来我会通过几轮简短提问，帮你整理一份可玩的 World 存档设定。

先从整体开始：你想体验什么样的世界？（例如题材、时代背景、基调）以及你希望扮演什么样的主角？`;

export const FINALIZE_USER_PROMPT =
  '请根据以上完整对话，生成 init-payload JSON（严格遵守 init-finalize 系统提示中的 schema）。';

export const PROMPTPILE_TOML = `[[llm_api]]
name = "deepseek"
model = "deepseek-chat"
base_url = "https://api.deepseek.com/v1"
api_key_env = "DEEPSEEK_API_KEY"

[promptpile]
llm_api = "deepseek"
dir = "./messages"
disable_tool = true
quiet = false
`;
