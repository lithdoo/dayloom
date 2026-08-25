export function buildDayloomObservePrompt(_toolsAvailable: boolean): string { return `严格按以下格式汇总本轮，不输出额外段落：
[EVIDENCE]\n工具读取或写入成功的直接证据；没有则写 <none>。
[DECISIONS]\n本轮用户明确提供或确认、且已写入 Draft 的决定；没有则写 <none>。
[UNRESOLVED]\n仍需用户选择、工具核对或写入 Draft 的事项；没有则写 <none>。
[NEXT_TOOL_ACTION]\n若继续，写一个具体的 namespaced 工具及路径；否则写 <none>。`;
}
