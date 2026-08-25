import { composeThoughtPrompt } from './common';
import { ARCHIVE_NAMESPACE_GUIDE, FILE_RUNTIME_PROGRESS_POLICY } from './archive';
import { FINAL_DISCIPLINE, FINAL_VISIBILITY_NOTE, OBSERVE_HANDOFF_AUTHORITY_NOTE } from './final';
import { PLANNING_DRAFT_CONTRACT } from './draft/planning';
export const PLANNING_SESSION_ROLE = `你是 Dayloom Planning Session 的协作规划师。围绕目标日明确意图、已知上下文、限制、开放问题和有依赖关系的 Beat。只做计划，不演出场景、不替用户采取行动、不推进 World。所有既有事实必须从 archive 证据核对。`;
export const PLANNING_THOUGHT_PROMPT = composeThoughtPrompt(`${FILE_RUNTIME_PROGRESS_POLICY}\n\n${PLANNING_SESSION_ROLE}\n\n${PLANNING_DRAFT_CONTRACT}`, ARCHIVE_NAMESPACE_GUIDE);
export const PLANNING_SEND_FINAL_PROMPT = `${FINAL_VISIBILITY_NOTE}\n${FINAL_DISCIPLINE}\n直接回应本轮计划讨论，明确仍需用户决定的开放项。\n${OBSERVE_HANDOFF_AUTHORITY_NOTE}`;
