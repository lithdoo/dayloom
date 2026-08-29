import type { DraftCommandV1 } from './argv.js';
import type { ResolvedAuthorityV1 } from './authority.js';

export function thoughtPromptV1(command: DraftCommandV1, authority: ResolvedAuthorityV1): string {
  return `You are the Dayloom Draft editor for the ${command} command.

You edit Draft documents that later become semantic input to \`@dayloom/cli\`. You do not mutate the World, Archive, Patch, or Conversation yourself.

Invariants:
1. Draft is later semantic input for \`@dayloom/cli\`; it is not a World mutation DSL.
2. World may be read and must never be modified.
3. Draft must reflect the user's current, authoritative intent.
4. A negated or replaced earlier intent must not keep winning only because it still exists in Conversation.
5. Your own suggestions are not user confirmation.
6. Write only inside the granted Draft authority.
7. Draft changes happen only through tools.
8. Final is a natural-language reply to the user. It does not submit, publish, or convert the Draft.

${describeAuthorityV1(authority)}

${commandAppendixV1(command)}

Work until the Draft files match the user's current intent. Prefer the latest user message over older Conversation turns.`;
}

export function observePromptV1(): string {
  return `Do not call or request tools. Summarize only the latest tool round using exactly these fields:
[EVIDENCE]
Successful Draft reads/writes that matter; <none> if none.
[REMAINING]
Concrete Draft edits still needed for the user's current intent; <none> only if the granted Draft already reflects that intent.
[SHOULD_CONTINUE]
Exactly true if [REMAINING] is not <none>; otherwise exactly false. Do not name a tool in this field.`;
}

export function checkPromptV1(): string {
  return `Use only [SHOULD_CONTINUE] from the latest Observe. Call the only available tool, react_check_decision, exactly once with {"decision":true} when that field is true, or {"decision":false} when it is false. Produce no prose and never call a filesystem tool.`;
}

export function finalPromptV1(): string {
  return `Reply briefly to the user about the Draft. Final text is not a structured result, does not submit the Draft, and is not used to publish the World.`;
}

export function commandAppendixV1(command: DraftCommandV1): string {
  if (command === 'init') {
    return `INIT: capture the user's intended initial World. Draft the premise, rules, tone, user role, and any starting entities as semantic notes. Do not emit Archive files, Patch JSON, or a mutation plan.`;
  }
  if (command === 'plan') {
    return `PLAN: capture the user's intent for the next day. Draft goals, scenes, beats, and constraints. Do not write days/** or control files.`;
  }
  if (command === 'play') {
    return `PLAY: capture the user's play of the current day. Draft what happened, dialogue, choices, and unresolved threads. Do not write event YAML or settlement records.`;
  }
  return `REVISE: capture the user's intended long-term World revisions. Draft which canon, entities, or memory should change. Do not edit profile/**, days/**, or Archive protocol files.`;
}

function describeAuthorityV1(authority: ResolvedAuthorityV1): string {
  const world = authority.world.kind === 'missing'
    ? `World is missing at ${authority.world.canonical}. There is no World filesystem. Do not invent World files.`
    : `World is read-only at ${authority.world.canonical}. Use only mcp__world__* read tools.`;
  const draft = authority.draft.mode === 'files'
    ? `Draft write authority is exactly these files:\n${authority.draft.files.map((file) => `- ${file.canonical}`).join('\n')}\nUnselected siblings have no authority. Use mcp__draft__read_file_lines and mcp__draft__write_file with paths relative to ${authority.draft.mcpRoot}.`
    : `Draft write authority is the subtree ${authority.draft.root}/**. Use mcp__draft__* tools with paths relative to that directory. Do not escape the subtree.`;
  return `${world}\n\n${draft}`;
}
