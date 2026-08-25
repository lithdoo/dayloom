export function buildDayloomCheckPrompt(toolsAvailable: boolean): string { return toolsAvailable
  ? `仅当 UNRESOLVED 不是 <none>，并且 NEXT_TOOL_ACTION 给出可执行、未重复、确有必要的工具动作时继续。用户问题已经可以回答或下一步需要用户选择时必须停止并进入 Final。`
  : `不得继续 Thought；立即进入 Final 回答用户。`; }
