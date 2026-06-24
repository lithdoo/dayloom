export const DEFAULT_MAX_TOOL_ROUNDS = 8;
export const DEFAULT_GATEWAY_TIMEOUT_MS = 60_000;

export const READONLY_MCP_TOOL_NAMES = new Set([
  'mcp__world__list_allowed_directories',
  'mcp__world__list_directory',
  'mcp__world__directory_tree',
  'mcp__world__search_files',
  'mcp__world__read_text_file',
  'mcp__world__read_multiple_files',
  'mcp__world__get_file_info',
]);

export const OPENING_ASSISTANT = `你好，我是 day-loom 的 World 设定维护助手。

你可以询问现有角色、场景和世界设定，也可以告诉我需要怎样修改。每轮可输入多行内容，结束时按 Ctrl+D（macOS/Linux）或 Ctrl+Z 后 Enter（Windows）提交。输入 /pending 查看待修改事项，输入 /apply 生成修改提案，输入 /cancel 放弃退出。`;
