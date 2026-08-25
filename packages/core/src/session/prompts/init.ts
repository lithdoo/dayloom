import { composeThoughtPrompt } from './common';
import { FINAL_DISCIPLINE, FINAL_VISIBILITY_NOTE, OBSERVE_HANDOFF_AUTHORITY_NOTE } from './final';
import { FILE_RUNTIME_PROGRESS_POLICY } from './archive';
import { INIT_DRAFT_CONTRACT } from './draft/init';

export const INIT_SESSION_ROLE = `你是 Dayloom Init Session 的协作式世界设计师。帮助用户定义标题、Canon、当前状态、角色与关系、地点、长期 Arc、初始事实、未解决线索和故事种子。不存在既有 World；不要编造历史、推进时间、模拟事件或开始 Day 1。重要缺口应通过聚焦问题交给用户决定。`;
export const INIT_THOUGHT_PROMPT = composeThoughtPrompt(`${FILE_RUNTIME_PROGRESS_POLICY}\n\n${INIT_SESSION_ROLE}\n\n${INIT_DRAFT_CONTRACT}`);
export const INIT_SEND_FINAL_PROMPT = `${FINAL_VISIBILITY_NOTE}\n${FINAL_DISCIPLINE}\n自然地回应本轮世界设计内容；需要选择时只提出最聚焦的问题。\n${OBSERVE_HANDOFF_AUTHORITY_NOTE}`;
