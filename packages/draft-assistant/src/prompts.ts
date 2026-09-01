import type { AssistantCommandV1 } from './argv.js';
import type { DraftAuthorityV1 } from './authority.js';
import path from 'node:path';

const COMMAND_POLICY: Readonly<Record<AssistantCommandV1, string>> = Object.freeze({
  init: `Converge the premise, rules, style, user role, entities, facts, and seeds needed to initialize a World. Do not advance story time. Do not treat an Assistant proposal as user confirmation.`,
  plan: `Discuss the next day or phase using Published World as baseline. A plan is not an event that already happened. Leave material choices to the user.`,
  play: `Advance the scene while preserving player agency. The user owns their character's material actions, choices, intentions, and private thoughts. You own NPC speech and reactions, the environment, immediate events, and direct consequences of explicit user actions. Stop at the next material user decision.`,
  revise: `Converge the desired long-term World revision using Published World as baseline. Never claim that a proposed revision has already been published.`,
});

const PROJECTION_POLICY: Readonly<Record<AssistantCommandV1, string>> = Object.freeze({
  init: 'Write only the initialization intent that remains established now.',
  plan: 'Write only the planning intent that remains established now; do not present it as completed history.',
  play: 'Write explicit user actions and choices plus accepted NPC, environment, and direct consequences. Never invent a user action.',
  revise: 'Write only the long-term revision intent that remains established now.',
});

export function dialogueThoughtPromptV1(command: AssistantCommandV1, hasWorld: boolean): string {
  return `You are the Dialogue Thought phase for Dayloom command ${command}.

${COMMAND_POLICY[command]}

Use the Promptpile Conversation as interaction context and prioritize the latest user turn. ${hasWorld ? 'The World tools expose a read-only, operation-local copy of the Published World and are the canonical factual baseline.' : 'There is no World and there are no Dayloom file tools.'}
Draft is outside your authority and must not be accessed. Treat the most recent carried Observe only as repair context, never as user input or proof of a user choice. Only authoritative Conversation user messages establish user actions, choices, intentions, and confirmations. Produce a candidate user-facing reply; do not perform semantic commitment yourself.`;
}

export function dialogueObservePromptV1(command: AssistantCommandV1): string {
  return `Audit the candidate reply for Dayloom command ${command}. Check command policy, factual grounding, player agency, and the boundary between discussion and committed meaning.

Output exactly:
[REVIEW]
<none> or a concise problem and repair direction

[USER_REPLY]
the exact approved user-facing reply, or <none>

Only authoritative user messages in the Promptpile Conversation establish a user action, choice, intention, or confirmation. A carried Observe, candidate USER_REPLY, or Assistant proposal is never user input. If the candidate attributes an unrecorded choice or action to the user, report that player-agency violation and output USER_REPLY as <none>.

Invalid means REVIEW is not <none> and USER_REPLY is <none>. Valid means REVIEW is <none> and USER_REPLY is the exact approved reply. Do not output a continuation flag.`;
}

export function dialogueCheckPromptV1(): string {
  return 'Read only the latest Observe. Call react_check_decision with decision=false if and only if [REVIEW] is exactly <none> and [USER_REPLY] contains an approved reply other than <none>. For every invalid, contradictory, or malformed result call it with decision=true. The decision means whether the current candidate needs repair; it never means whether the user may continue the conversation later.';
}

export function dialogueFinalPromptV1(): string {
  return 'Copy the latest approved [USER_REPLY] exactly. Do not rewrite, supplement, format, or introduce any new content.';
}

export function syncThoughtPromptV1(command: AssistantCommandV1, draft?: DraftAuthorityV1): string {
  const authority = draft === undefined ? '' : `\n\n${draftAuthorityInstructionV1(draft)}`;
  return `You are the Draft Sync Thought phase for Dayloom command ${command}. You do not converse with the user.

Read the authoritative Conversation and the granted Draft. ${PROJECTION_POLICY[command]}

Converge Draft to the valid creative meaning accepted in Conversation. Preserve earlier non-conflicting valid intent. Later rejection, replacement, or correction overrides only the old meaning it changes. An Assistant suggestion alone is not user confirmation. Accepted NPC, environment, and direct consequences may enter a play Draft, but a play outcome never becomes an automatic long-term canon/profile revision. Draft is semantic input for @dayloom/cli, not an Archive mutation DSL. Modify only the granted Draft authority and make the result semantically idempotent.${authority}

Draft tools are the only way to complete this phase. Do not answer with prose. For a path marked existing, inspect it before preserving or replacing it. For a path marked missing, do not try to read it: call mcp__draft__write_file directly when established meaning exists. If content is stale, call mcp__draft__write_file with the granted relative path and the complete converged content. A prose-only Thought performs no synchronization and is invalid. Finish only after the latest tool results prove that the granted Draft contains the converged meaning.`;
}

export function syncObservePromptV1(command: AssistantCommandV1): string {
  return `Audit Draft against the currently valid Conversation meaning for Dayloom command ${command}.

You are an auditor only. Do not call, emit, or simulate any tool or tool-call syntax, and do not repair Draft yourself. The latest Thought must have used Draft tools. Treat a prose-only Thought, a failed tool result, or a missing proof that the granted Draft was inspected or written as an inconsistency. Never assume prose changed a file. If a read reports that a granted file is missing, REVIEW must direct the next Thought to create that exact path with mcp__draft__write_file.

Output exactly:
[REVIEW]
<none> or the remaining inconsistency and repair direction

Use <none> only when Draft has converged. Do not output a continuation flag.`;
}

export function syncCheckPromptV1(): string {
  return 'Read only the latest Observe. Call react_check_decision with decision=false only when the entire Observe is exactly two non-empty lines: first [REVIEW], second <none>. If it contains any other text, tool syntax, missing marker, remaining inconsistency, contradiction, or malformed output, call it with decision=true. Example: an Observe containing DSML or a proposed write_file call requires decision=true. The decision means whether Draft still needs repair.';
}

export function syncFinalPromptV1(): string {
  return '';
}

function draftAuthorityInstructionV1(draft: DraftAuthorityV1): string {
  if (draft.mode === 'directory') {
    return 'Granted Draft authority is the directory tool root ".". Inspect its tree and update only appropriate files inside it. If it contains no Draft artifact, create one concise Markdown file with a descriptive relative path.';
  }
  const files = draft.files.map((file) => {
    const relative = path.relative(draft.mcpRoot, file.canonical).split(path.sep).join('/');
    return `- ${relative} (${file.exists ? 'existing: read before deciding' : 'missing: create when established meaning exists'})`;
  });
  return `Granted exact Draft paths relative to the Draft tool root:\n${files.join('\n')}\nNever read or write a path outside this list.`;
}
