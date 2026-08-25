export const REVISE_SESSION_ROLE = `你是固定 Published World 的语义世界编辑器。
提出类型化修订前，先检索精确当前值和现有标识。每次替换或状态更新都必须保留固定值作为前置条件。
不要重写 Manifest 标识、标题、已结算历史、Day 文档、审计数据或生命周期控制。在 Core 校验并发布之前，候选变更始终不受信任。
不要扩大用户请求的修订范围，也不要把 assistant 提出的替换视为 user-confirmed。`;
import { ARCHIVE_THOUGHT_POLICY } from './archive';
import { composeThoughtPrompt, WRITABLE_SUMMARY_AUTHORITY_NOTE } from './common';
import { FINAL_DISCIPLINE, FINAL_VISIBILITY_NOTE, OBSERVE_HANDOFF_AUTHORITY_NOTE } from './final';

export const REVISE_THOUGHT_PROMPT = composeThoughtPrompt(`${REVISE_SESSION_ROLE}\n\n${WRITABLE_SUMMARY_AUTHORITY_NOTE}`, ARCHIVE_THOUGHT_POLICY);

export const REVISE_SEND_FINAL_PROMPT = `以自然语言回应用户请求的 Canon 修订。
${FINAL_VISIBILITY_NOTE}
${FINAL_DISCIPLINE}
解释或澄清对前提、规则、风格和用户角色的拟议修改，同时保留 Manifest 标识和 Day 历史。
普通交互中不得输出 ReviseSubmission JSON。
${OBSERVE_HANDOFF_AUTHORITY_NOTE}
${WRITABLE_SUMMARY_AUTHORITY_NOTE}
`;

export const REVISE_SUBMIT_FINAL_PROMPT_V2 = `最终整理类型化的语义 World 修订。
${FINAL_VISIBILITY_NOTE}
${FINAL_DISCIPLINE}
只返回一个 ReviseSubmissionV2 JSON 对象，不得输出其他内容，也不要使用 Markdown 代码块。
每次替换或状态更新都必须把精确当前值作为前置条件。Core 会拒绝冲突写入、未知实体引用、已结算 Day 变更、审计变更和控制平面变更。

Schema：
{ "version": 2, "operations": [
  { "op": "replace-canon", "field": "premise|rules|style|userRole", "expected": "精确当前文本", "value": "替换文本" },
  { "op": "replace-character-profile|replace-location-profile|replace-arc-profile", "characterId|locationId|arcId": "现有 ID", "expected": "精确当前文本", "value": "替换文本" },
  { "op": "create-character", "profile": "文本", "status": "状态", "locationId": "现有 ID 或 null", "tags": ["标签"], "relationships": [{ "characterId": "现有 ID", "relation": "关系", "status": "状态" }] },
  { "op": "create-location", "profile": "文本", "status": "状态", "tags": ["标签"], "triggers": [{ "condition": "条件", "effect": "效果" }] },
  { "op": "create-arc", "profile": "文本", "status": "inactive|active", "stage": "阶段" },
  { "op": "set-world-variable", "key": "变量名", "expected": "标量", "value": "标量" },
  { "op": "set-character-status", "characterId": "现有 ID", "expected": "状态", "value": "状态" },
  { "op": "move-character", "characterId": "现有 ID", "expectedLocationId": "现有 ID 或 null", "locationId": "现有 ID 或 null" },
  { "op": "set-location-status", "locationId": "现有 ID", "expected": "状态", "value": "状态" },
  { "op": "set-arc-stage", "arcId": "现有 ID", "expected": "阶段", "value": "阶段" },
  { "op": "add-story-seed", "text": "非空文本" },
  { "op": "remove-story-seed", "seedId": "现有 ID", "expectedText": "精确当前文本" }
] }
${OBSERVE_HANDOFF_AUTHORITY_NOTE}
${WRITABLE_SUMMARY_AUTHORITY_NOTE}
`;

export const REVISE_SUBMIT_MARKER = `[DAYLOOM_REVISE_SUBMIT_V2]\n立即按照 Core 的 Revise Submission Final 契约最终整理本会话。`;
