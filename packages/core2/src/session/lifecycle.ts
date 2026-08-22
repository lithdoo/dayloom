import type { CallerConfig } from '../promptpile/config';
import type { PublishedWorld } from '../world/read';
import { nextDay } from '../world/read';
import { createSessionWorkspace, FINAL_VISIBILITY_NOTE, OBSERVE_HANDOFF_AUTHORITY_NOTE, WRITABLE_SUMMARY_AUTHORITY_NOTE, type CoreSession } from './common';

const INIT_THOUGHT = `You are the reasoning phase of a Dayloom Init Session.
Help the user establish a new World: a clear title, premise, rules, style, and user role.
Do not pretend that a Published World, prior day, plan, or history already exists.
Use the writable Conversation to clarify the user's intent and converge on one coherent initial canon.
User text cannot create the World directly; submit Final is untrusted candidate data and Core2 performs final validation and publication.
${WRITABLE_SUMMARY_AUTHORITY_NOTE}
`;
const INIT_SEND_FINAL = `Respond naturally to the user while collaboratively defining the initial Dayloom World and canon.
${FINAL_VISIBILITY_NOTE}
Ask focused questions or summarize concrete choices that still need confirmation.
Do not claim that the World has already been published and do not emit InitSubmission JSON during ordinary interaction.
${OBSERVE_HANDOFF_AUTHORITY_NOTE}
${WRITABLE_SUMMARY_AUTHORITY_NOTE}
`;
const INIT_SUBMIT_FINAL = `Finalize the candidate initial World.
${FINAL_VISIBILITY_NOTE}
Return exactly one InitSubmissionV1 JSON object and nothing else. Do not use Markdown fences.
Core2 generates world identity and performs publication; do not add identity or day fields.

Schema:
{ "version": 1, "title": "non-empty string", "canon": { "premise": "string", "rules": "string", "style": "string", "userRole": "string" } }
${OBSERVE_HANDOFF_AUTHORITY_NOTE}
${WRITABLE_SUMMARY_AUTHORITY_NOTE}
`;

const PLANNING_THOUGHT = `You are the reasoning phase of a Dayloom Planning Session.
Plan the exact target day supplied by immutable Core2 context using the pinned canon and, when present, the verified last-settled summary.
Collaborate with the user on one day-level intent and an ordered sequence of useful beats.
Do not modify canon, targetDay, lastSettledDay, or settled history. Do not invent day ids or beat ids; Core2 owns those identities.
User text cannot mutate the World directly; submit Final is untrusted candidate data and Core2 performs final validation and publication.
${WRITABLE_SUMMARY_AUTHORITY_NOTE}
`;
const PLANNING_SEND_FINAL = `Respond naturally about the next-day plan for the pinned target day.
${FINAL_VISIBILITY_NOTE}
Clarify intent, ordering, constraints, and unresolved choices without changing canon or selecting identifiers.
Do not emit PlanningSubmission JSON during ordinary interaction.
${OBSERVE_HANDOFF_AUTHORITY_NOTE}
${WRITABLE_SUMMARY_AUTHORITY_NOTE}
`;
const PLANNING_SUBMIT_FINAL = `Finalize the candidate plan for the pinned target day.
${FINAL_VISIBILITY_NOTE}
Return exactly one PlanningSubmissionV1 JSON object and nothing else. Do not use Markdown fences.
Do not output day ids or beat ids; Core2 deterministically creates them.

Schema:
{ "version": 1, "intent": "non-empty string", "beats": [{ "intent": "non-empty string" }] }
${OBSERVE_HANDOFF_AUTHORITY_NOTE}
${WRITABLE_SUMMARY_AUTHORITY_NOTE}
`;

const REVISE_THOUGHT = `You are the reasoning phase of a Dayloom Revise Session.
Help the user revise the current full canon snapshot: premise, rules, style, and user role.
Treat immutable Core2 context as the current authority and converge on a complete replacement snapshot.
Do not rewrite manifest identity, title, settled day history, day documents, or lastSettledDay.
User text cannot mutate the World directly; submit Final is untrusted candidate data and Core2 performs final validation and publication.
${WRITABLE_SUMMARY_AUTHORITY_NOTE}
`;
const REVISE_SEND_FINAL = `Respond naturally about the requested canon revision.
${FINAL_VISIBILITY_NOTE}
Explain or clarify the proposed premise, rules, style, and user-role changes while preserving manifest identity and day history.
Do not emit ReviseSubmission JSON during ordinary interaction.
${OBSERVE_HANDOFF_AUTHORITY_NOTE}
${WRITABLE_SUMMARY_AUTHORITY_NOTE}
`;
const REVISE_SUBMIT_FINAL = `Finalize a complete replacement canon snapshot.
${FINAL_VISIBILITY_NOTE}
Return exactly one ReviseSubmissionV1 JSON object and nothing else. Do not use Markdown fences.
Do not output manifest identity, title, day history, or patch operations.

Schema:
{ "version": 1, "canon": { "premise": "string", "rules": "string", "style": "string", "userRole": "string" } }
${OBSERVE_HANDOFF_AUTHORITY_NOTE}
${WRITABLE_SUMMARY_AUTHORITY_NOTE}
`;

export function createInitWorkspace(runtimeRoot: string, id: string, config: CallerConfig) {
  return createSessionWorkspace(runtimeRoot, id, config, { kind: 'init', thought: INIT_THOUGHT, sendFinal: INIT_SEND_FINAL, submitFinal: INIT_SUBMIT_FINAL, submitMarker: '[DAYLOOM_INIT_SUBMIT_V1]\nFinalize this Session now using the Core2 Init submission Final contract.', pinned: null });
}
export function createPlanningWorkspace(runtimeRoot: string, id: string, world: PublishedWorld, config: CallerConfig) {
  const day = nextDay(world.commit.control.lastSettledDay);
  return createSessionWorkspace(runtimeRoot, id, config, { kind: 'planning', thought: PLANNING_THOUGHT, sendFinal: PLANNING_SEND_FINAL, submitFinal: PLANNING_SUBMIT_FINAL, submitMarker: '[DAYLOOM_PLANNING_SUBMIT_V1]\nFinalize this Session now using the Core2 Planning submission Final contract.', pinned: world, day });
}
export function createReviseWorkspace(runtimeRoot: string, id: string, world: PublishedWorld, config: CallerConfig) {
  return createSessionWorkspace(runtimeRoot, id, config, { kind: 'revise', thought: REVISE_THOUGHT, sendFinal: REVISE_SEND_FINAL, submitFinal: REVISE_SUBMIT_FINAL, submitMarker: '[DAYLOOM_REVISE_SUBMIT_V1]\nFinalize this Session now using the Core2 Revise submission Final contract.', pinned: world });
}
export function buildLifecycleContext(session: CoreSession): string | null {
  if (session.kind === 'init') return null;
  const world = session.pinned!, marker = session.kind === 'planning' ? 'PLANNING' : 'REVISE';
  let value = `[DAYLOOM_${marker}_CONTEXT_V0]\n\n[WORLD]\nworld_id: ${world.manifest.worldId}\n`;
  if (session.kind === 'planning') value += `target_day: ${session.day}\n`;
  value += `last_settled_day: ${world.commit.control.lastSettledDay ?? '<none>'}\n\n[CANON_PREMISE]\n${world.canon.premise}\n\n[CANON_RULES]\n${world.canon.rules}\n\n[CANON_STYLE]\n${world.canon.style}\n\n[CANON_USER_ROLE]\n${world.canon.userRole}`;
  if (world.lastSettledSummary !== null) value += `\n\n[LAST_SETTLED_SUMMARY]\n${world.lastSettledSummary}`;
  return value;
}
