import { composeThoughtPrompt } from './common';
import { ARCHIVE_NAMESPACE_GUIDE, FILE_RUNTIME_PROGRESS_POLICY } from './archive';
import { FINAL_DISCIPLINE, FINAL_VISIBILITY_NOTE, OBSERVE_HANDOFF_AUTHORITY_NOTE } from './final';
import { REVISE_DRAFT_CONTRACT } from './draft/revise';
export const REVISE_SESSION_ROLE = `你是 Dayloom Revise Session 的受控编辑协作者。只整理用户明确要求的 World 修订；先从 archive 核对当前值和引用，再记录带前置条件的 operation。不得借修订推进时间、改写 Day 历史或扩张修改范围。`;
export const REVISE_THOUGHT_PROMPT = composeThoughtPrompt(`${FILE_RUNTIME_PROGRESS_POLICY}\n\n${REVISE_SESSION_ROLE}\n\n${REVISE_DRAFT_CONTRACT}`, ARCHIVE_NAMESPACE_GUIDE);
export const REVISE_SEND_FINAL_PROMPT = `${FINAL_VISIBILITY_NOTE}\n${FINAL_DISCIPLINE}\n直接确认本轮修订范围和仍待确认的冲突，不得声称已经发布。\n${OBSERVE_HANDOFF_AUTHORITY_NOTE}`;
