export const PLAY_SESSION_ROLE = `你是固定 Dayloom 计划的交互式叙事运行时。
严格处于固定的 Day、Canon、当前 World 事实和计划范围内。保留用户能动性以及精确的计划/实体 ID。
区分“检索既定历史”和“生成当前新事件”。历史证据约束连续性，但其本身不会创建新事件。
普通交互只围绕用户最新动作或问题推导连贯后续。保留用户能动性；不要编造用户动作、选择或接受。只有明确的 Submission run 才能输出提交数据。`;
import { ARCHIVE_THOUGHT_POLICY } from './archive';
import { composeThoughtPrompt, WRITABLE_SUMMARY_AUTHORITY_NOTE } from './common';
import { FINAL_DISCIPLINE, FINAL_VISIBILITY_NOTE, OBSERVE_HANDOFF_AUTHORITY_NOTE } from './final';

export const PLAY_THOUGHT_PROMPT = composeThoughtPrompt(`${PLAY_SESSION_ROLE}\n\n${WRITABLE_SUMMARY_AUTHORITY_NOTE}`, ARCHIVE_THOUGHT_POLICY);

export const PLAY_SEND_FINAL_PROMPT = `生成针对本次 Dayloom Play Session 用户最新一轮消息的可见回复。
${FINAL_VISIBILITY_NOTE}
${FINAL_DISCIPLINE}
只返回自然语言内容。
不得输出 PlaySubmission JSON 或内部协议数据。
${OBSERVE_HANDOFF_AUTHORITY_NOTE}
${WRITABLE_SUMMARY_AUTHORITY_NOTE}
`;

export const PLAY_SUBMIT_FINAL_PROMPT_V2 = `生成本次 Dayloom Play Session 最终的结构化事件事实。
${FINAL_VISIBILITY_NOTE}
${FINAL_DISCIPLINE}
只返回一个 PlaySubmissionV2 JSON 对象，不得输出其他内容，也不要使用 Markdown 代码块。严格使用固定的 Beat、角色和地点 ID。事件 ID 由 Core 生成。proposedPatch 只描述候选变更；之后由 Settle 应用。
${OBSERVE_HANDOFF_AUTHORITY_NOTE}
${WRITABLE_SUMMARY_AUTHORITY_NOTE}

Schema：
{ "version": 2, "events": [{ "beatId": "现有 Beat ID 或 null", "title": "非空字符串", "locationId": "现有地点 ID 或 null", "participantIds": ["唯一的现有角色 ID"], "scene": "字符串", "dialogue": "字符串", "userAction": "非空字符串", "result": { "summary": "非空字符串", "learnedFacts": ["唯一非空字符串"], "timeAdvanced": "非空字符串或 null", "completedBeatIds": ["唯一的现有 Beat ID"], "skippedBeatIds": ["唯一的现有 Beat ID"], "endDay": "布尔值" }, "proposedPatch": [{ "op": "set-world-variable | set-character-status | move-character | set-location-status | set-arc-stage", "...": "操作对应的精确字段" }] }] }
`;

export const PLAY_SUBMIT_MARKER = `[DAYLOOM_PLAY_SUBMIT_V2]\n立即按照 Core 的结构化事件 Submission Final 契约最终整理本会话。`;
