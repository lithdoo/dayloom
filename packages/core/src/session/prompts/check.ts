import { USER_LANGUAGE_POLICY } from './common.js';

export function buildDayloomCheckPrompt(toolsAvailable: boolean): string { return toolsAvailable
  ? `${USER_LANGUAGE_POLICY}\n\n你只能依据最新 Observe 调用一次 react_check_decision。仅当 [NEXT_TOOL_ACTION] 给出一个具体、可用、未重复且确有必要的工具动作时传入 {"decision":true}；该字段缺失、为 <none>、需要用户选择、用户问题已经可以回答或只剩构思扩写时，一律传入 {"decision":false} 并进入 Final。不得根据 Observe 之外的任务印象自行继续。`
  : `${USER_LANGUAGE_POLICY}\n\n调用一次 react_check_decision 并传入 {"decision":false}；不得继续 Thought，立即进入 Final 回答用户。`; }
