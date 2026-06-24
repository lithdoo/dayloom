export const DEFAULT_MAX_TOOL_ROUNDS = 8;

export const READONLY_MCP_TOOL_NAMES = new Set([
  'mcp__world__list_allowed_directories',
  'mcp__world__list_directory',
  'mcp__world__directory_tree',
  'mcp__world__search_files',
  'mcp__world__read_text_file',
  'mcp__world__read_multiple_files',
  'mcp__world__get_file_info',
]);

export const OPENING_ASSISTANT = `你好，我是 day-loom 的当日计划助手。

我只能根据主角视角已知的信息回答问题和协助制定今日计划。你可以先询问过往信息，也可以直接说明今天想做什么。每轮可输入多行内容，结束时按 Ctrl+D（macOS/Linux）或 Ctrl+Z 后 Enter（Windows）提交。你可以直接用自然语言要求查看、确认、取消或保存计划；系统会识别你的意图。`;
