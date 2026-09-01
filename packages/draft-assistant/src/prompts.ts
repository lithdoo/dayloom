import type { AssistantCommandV1 } from './argv.js';

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
Draft is outside your authority and must not be accessed. Treat the most recent carried Observe only as repair context. Produce a candidate user-facing reply; do not perform semantic commitment yourself.`;
}

export function dialogueObservePromptV1(command: AssistantCommandV1): string {
  return `Audit the candidate reply for Dayloom command ${command}. Check command policy, factual grounding, player agency, and the boundary between discussion and committed meaning.

Output exactly:
[REVIEW]
<none> or a concise problem and repair direction

[USER_REPLY]
the exact approved user-facing reply, or <none>

[SHOULD_CONTINUE]
true or false

Invalid means REVIEW is not <none>, USER_REPLY is <none>, and SHOULD_CONTINUE is true. Valid means REVIEW is <none>, USER_REPLY is the exact approved reply, and SHOULD_CONTINUE is false.`;
}

export function dialogueCheckPromptV1(): string {
  return 'Read only the latest Observe. Call react_check_decision with decision=true exactly when [SHOULD_CONTINUE] is true; otherwise decision=false.';
}

export function dialogueFinalPromptV1(): string {
  return 'Copy the latest approved [USER_REPLY] exactly. Do not rewrite, supplement, format, or introduce any new content.';
}

export function syncThoughtPromptV1(command: AssistantCommandV1): string {
  return `You are the Draft Sync Thought phase for Dayloom command ${command}. You do not converse with the user.

Read the authoritative Conversation and the granted Draft. ${PROJECTION_POLICY[command]}

Converge Draft to the valid creative meaning accepted in Conversation. Preserve earlier non-conflicting valid intent. Later rejection, replacement, or correction overrides only the old meaning it changes. An Assistant suggestion alone is not user confirmation. Accepted NPC, environment, and direct consequences may enter a play Draft, but a play outcome never becomes an automatic long-term canon/profile revision. Draft is semantic input for @dayloom/cli, not an Archive mutation DSL. Modify only the granted Draft authority and make the result semantically idempotent.`;
}

export function syncObservePromptV1(command: AssistantCommandV1): string {
  return `Audit Draft against the currently valid Conversation meaning for Dayloom command ${command}.

Output exactly:
[REVIEW]
<none> or the remaining inconsistency and repair direction

[SHOULD_CONTINUE]
true or false

Use false only when Draft has converged; otherwise use true.`;
}

export function syncCheckPromptV1(): string {
  return 'Read only the latest Observe. Call react_check_decision with decision=true exactly when [SHOULD_CONTINUE] is true; otherwise decision=false.';
}

export function syncFinalPromptV1(): string {
  return '';
}
