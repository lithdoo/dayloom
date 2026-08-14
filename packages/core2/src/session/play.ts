import type { CallerConfig } from '../promptpile/config';
import type { PublishedWorld } from '../world/read';
import { createSessionWorkspace, SUMMARY_SYSTEM_PROMPT, WRITABLE_SUMMARY_AUTHORITY_NOTE, type CoreSession } from './common';

export { SUMMARY_SYSTEM_PROMPT, WRITABLE_SUMMARY_AUTHORITY_NOTE };

export const THOUGHT_PROMPT = `You are the reasoning phase of a Dayloom Play Session.
Treat the first immutable Conversation layer as authoritative Dayloom World context.
Treat the writable Conversation layer as the current interaction history.
Stay within the pinned day and plan. Do not replace or reinterpret the supplied canon or plan ids.
For ordinary interaction, reason toward a coherent continuation of the current planned day.
Do not emit Dayloom submission JSON unless the current run is explicitly a submission run.
${WRITABLE_SUMMARY_AUTHORITY_NOTE}
`;
export const SEND_FINAL_PROMPT = `Produce the user-facing assistant response for the latest user turn in this Dayloom Play Session.
Use the authoritative context and the completed reasoning from this run.
Return natural-language content only.
Do not emit PlaySubmission JSON or internal protocol data.
${WRITABLE_SUMMARY_AUTHORITY_NOTE}
`;
export const SUBMIT_FINAL_PROMPT = `Produce the final machine result for this Dayloom Play Session.
Return exactly one JSON object and nothing else. Do not use Markdown fences.
Do not choose or change the day. Use the existing plan beat ids exactly.
${WRITABLE_SUMMARY_AUTHORITY_NOTE}

Schema:
{
  "version": 1,
  "summary": "non-empty string",
  "beats": [{ "id": "existing plan beat id", "status": "pending | completed | skipped", "eventId": "event id or null" }],
  "events": [{ "id": "unique event id", "beatId": "existing plan beat id or null", "userInput": "non-empty string", "assistantOutput": "non-empty string" }]
}
`;
export const SUBMIT_MARKER = `[DAYLOOM_PLAY_SUBMIT_V1]
Finalize this Session now using the Core2 submission Final contract.`;

export interface PlaySession extends CoreSession { kind: 'play'; pinned: PublishedWorld; day: string }
export async function createPlayWorkspace(runtimeRoot: string, id: string, world: PublishedWorld, config: CallerConfig): Promise<PlaySession> {
  if (!world.playContext || world.commit.control.day === null) throw new Error('Play context is not available.');
  return createSessionWorkspace(runtimeRoot, id, config, { kind: 'play', thought: THOUGHT_PROMPT, sendFinal: SEND_FINAL_PROMPT, submitFinal: SUBMIT_FINAL_PROMPT, submitMarker: SUBMIT_MARKER, pinned: world, day: world.commit.control.day }) as Promise<PlaySession>;
}
export function buildContextMessage(world: PublishedWorld): string {
  const context = world.playContext!;
  return `[DAYLOOM_PLAY_CONTEXT_V0]

[WORLD]
world_id: ${world.manifest.worldId}
day: ${world.commit.control.day}

[CANON_PREMISE]
${context.premise}

[CANON_RULES]
${context.rules}

[CANON_STYLE]
${context.style}

[CANON_USER_ROLE]
${context.userRole}

[PLAN_JSON]
${JSON.stringify(context.plan, null, 2)}`;
}
