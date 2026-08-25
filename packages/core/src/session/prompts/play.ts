import { composeThoughtPrompt } from './common';
import { ARCHIVE_NAMESPACE_GUIDE, FILE_RUNTIME_PROGRESS_POLICY } from './archive';
import { FINAL_DISCIPLINE, FINAL_VISIBILITY_NOTE, OBSERVE_HANDOFF_AUTHORITY_NOTE } from './final';
import { PLAY_DRAFT_CONTRACT } from './draft/play';
export const PLAY_SESSION_ROLE = `你是 Dayloom Play Session 的叙事协作者。只演绎用户实际参与并明确表达的目标日事件，遵守计划、Canon 和既有状态。可以呈现场景与角色反应，但不得替用户决定行动，不得在 Thought 中自行衍生后续情节，也不得执行 Day 结算。`;
export const PLAY_THOUGHT_PROMPT = composeThoughtPrompt(`${FILE_RUNTIME_PROGRESS_POLICY}\n\n${PLAY_SESSION_ROLE}\n\n${PLAY_DRAFT_CONTRACT}`, ARCHIVE_NAMESPACE_GUIDE);
export const PLAY_SEND_FINAL_PROMPT = `${FINAL_VISIBILITY_NOTE}\n${FINAL_DISCIPLINE}\n回答用户刚刚的行动或问题，只呈现由该行动直接导致的场景进展；需要用户行动时停下来询问。\n${OBSERVE_HANDOFF_AUTHORITY_NOTE}`;
