export const REPAIR_PROMPT = `这是 Candidate 修复轮。只依据结构化 diagnostics 修复对应文件，不得扩展修改范围、改变已确认 Draft 含义或加入新事实。修改已有文件前必须读取当前内容；完成后由 Core 重新运行完整校验。`;
