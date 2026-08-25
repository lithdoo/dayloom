import type { CallerConfig } from '../promptpile/config';
import type { PublishedWorld } from '../world/read';
import { nextDay } from '../world/read';
import { createSessionWorkspace, FINAL_VISIBILITY_NOTE, OBSERVE_HANDOFF_AUTHORITY_NOTE, WRITABLE_SUMMARY_AUTHORITY_NOTE, type CoreSession, type SessionToolingBinding } from './common';
import { composeThoughtPrompt } from './prompts/common';
import { ARCHIVE_THOUGHT_POLICY } from './prompts/archive';
import { INIT_SESSION_ROLE } from './prompts/init';
import { PLANNING_SESSION_ROLE } from './prompts/planning';
import { REVISE_SESSION_ROLE } from './prompts/revise';
import { FINAL_DISCIPLINE } from './prompts/final';

const INIT_THOUGHT = composeThoughtPrompt(`${INIT_SESSION_ROLE}\n\n${WRITABLE_SUMMARY_AUTHORITY_NOTE}`);
const INIT_SEND_FINAL = `Respond naturally while collaboratively defining the initial World, entities, relationships, state, conflicts, facts, and seeds.
${FINAL_VISIBILITY_NOTE}
${FINAL_DISCIPLINE}
Ask focused questions or summarize concrete choices that still need confirmation.
Do not claim that the World has already been published and do not emit InitSubmission JSON during ordinary interaction.
${OBSERVE_HANDOFF_AUTHORITY_NOTE}
${WRITABLE_SUMMARY_AUTHORITY_NOTE}
`;
const INIT_SUBMIT_FINAL = `Finalize the candidate initial World.
${FINAL_VISIBILITY_NOTE}
${FINAL_DISCIPLINE}
Return exactly one InitSubmissionV2 JSON object and nothing else. Do not use Markdown fences.
Core generates all persistent identities; use submission-local keys only where requested.

Schema:
{ "version": 2, "title": "non-empty string", "canon": { "premise": "string", "rules": "string", "style": "string", "userRole": "string" }, "worldState": { "status": "non-empty string", "elapsed": "non-empty string or null", "variables": { "name": "finite scalar JSON value" } }, "characters": [{ "key": "unique local key", "profile": "string", "relationships": [{ "characterKey": "existing character key", "relation": "non-empty string", "status": "non-empty string" }], "status": "non-empty string", "locationKey": "existing location key or null", "tags": ["unique non-empty string"] }], "locations": [{ "key": "unique local key", "profile": "string", "status": "non-empty string", "tags": ["unique non-empty string"], "triggers": [{ "condition": "non-empty string", "effect": "non-empty string" }] }], "arcs": [{ "key": "unique local key", "profile": "string", "status": "inactive or active", "stage": "string" }], "initialFacts": [{ "text": "non-empty string" }], "unresolvedThreads": [{ "text": "non-empty string" }], "storySeeds": [{ "text": "non-empty string" }] }
${OBSERVE_HANDOFF_AUTHORITY_NOTE}
${WRITABLE_SUMMARY_AUTHORITY_NOTE}
`;

const PLANNING_THOUGHT = composeThoughtPrompt(`${PLANNING_SESSION_ROLE}\n\n${WRITABLE_SUMMARY_AUTHORITY_NOTE}`, ARCHIVE_THOUGHT_POLICY);
const PLANNING_SEND_FINAL = `Respond naturally about the next-day plan for the pinned target day.
${FINAL_VISIBILITY_NOTE}
${FINAL_DISCIPLINE}
Clarify intent, ordering, constraints, and unresolved choices without changing canon or selecting identifiers.
Do not emit PlanningSubmission JSON during ordinary interaction.
${OBSERVE_HANDOFF_AUTHORITY_NOTE}
${WRITABLE_SUMMARY_AUTHORITY_NOTE}
`;
const PLANNING_SUBMIT_FINAL_V2 = `Finalize the candidate rich plan for the pinned target day.
${FINAL_VISIBILITY_NOTE}
${FINAL_DISCIPLINE}
Return exactly one PlanningSubmissionV2 JSON object and nothing else. Do not use Markdown fences.
Use submission-local beat keys for dependencies. Core generates the target day and persistent beat ids. Every dependency must reference an earlier beat key.

Schema:
{ "version": 2, "intent": "non-empty string", "knownContext": ["non-empty unique string"], "constraints": ["non-empty unique string"], "openQuestions": ["non-empty unique string"], "maxEvents": "integer >= 1", "beats": [{ "key": "unique local key", "intent": "non-empty string", "priority": "required or optional", "dependsOn": ["earlier beat key"] }] }
${OBSERVE_HANDOFF_AUTHORITY_NOTE}
${WRITABLE_SUMMARY_AUTHORITY_NOTE}
`;

const REVISE_THOUGHT = composeThoughtPrompt(`${REVISE_SESSION_ROLE}\n\n${WRITABLE_SUMMARY_AUTHORITY_NOTE}`, ARCHIVE_THOUGHT_POLICY);
const REVISE_SEND_FINAL = `Respond naturally about the requested canon revision.
${FINAL_VISIBILITY_NOTE}
${FINAL_DISCIPLINE}
Explain or clarify the proposed premise, rules, style, and user-role changes while preserving manifest identity and day history.
Do not emit ReviseSubmission JSON during ordinary interaction.
${OBSERVE_HANDOFF_AUTHORITY_NOTE}
${WRITABLE_SUMMARY_AUTHORITY_NOTE}
`;
const REVISE_SUBMIT_FINAL_V2 = `Finalize typed semantic World revisions.
${FINAL_VISIBILITY_NOTE}
${FINAL_DISCIPLINE}
Return exactly one ReviseSubmissionV2 JSON object and nothing else. Do not use Markdown fences.
Every replacement or state update must include the exact current value as a precondition. Core rejects conflicting writes, unknown entity references, settled-day changes, audit changes, and control-plane changes.

Schema:
{ "version": 2, "operations": [
  { "op": "replace-canon", "field": "premise|rules|style|userRole", "expected": "exact current text", "value": "replacement text" },
  { "op": "replace-character-profile|replace-location-profile|replace-arc-profile", "characterId|locationId|arcId": "existing id", "expected": "exact current text", "value": "replacement text" },
  { "op": "create-character", "profile": "text", "status": "status", "locationId": "existing id or null", "tags": ["tag"], "relationships": [{ "characterId": "existing id", "relation": "relation", "status": "status" }] },
  { "op": "create-location", "profile": "text", "status": "status", "tags": ["tag"], "triggers": [{ "condition": "condition", "effect": "effect" }] },
  { "op": "create-arc", "profile": "text", "status": "inactive|active", "stage": "stage" },
  { "op": "set-world-variable", "key": "name", "expected": "scalar", "value": "scalar" },
  { "op": "set-character-status", "characterId": "existing id", "expected": "status", "value": "status" },
  { "op": "move-character", "characterId": "existing id", "expectedLocationId": "existing id or null", "locationId": "existing id or null" },
  { "op": "set-location-status", "locationId": "existing id", "expected": "status", "value": "status" },
  { "op": "set-arc-stage", "arcId": "existing id", "expected": "stage", "value": "stage" },
  { "op": "add-story-seed", "text": "non-empty text" },
  { "op": "remove-story-seed", "seedId": "existing id", "expectedText": "exact current text" }
] }
${OBSERVE_HANDOFF_AUTHORITY_NOTE}
${WRITABLE_SUMMARY_AUTHORITY_NOTE}
`;

export function createInitWorkspace(runtimeRoot: string, id: string, config: CallerConfig) {
  return createSessionWorkspace(runtimeRoot, id, config, { kind: 'init', thought: INIT_THOUGHT, sendFinal: INIT_SEND_FINAL, submitFinal: INIT_SUBMIT_FINAL, submitMarker: '[DAYLOOM_INIT_SUBMIT_V2]\nFinalize this Session now using the Core Init submission Final contract.', pinned: null });
}
export function createPlanningWorkspace(runtimeRoot: string, id: string, world: PublishedWorld, config: CallerConfig, tooling?: SessionToolingBinding) {
  const day = nextDay(world.commit.control.lastSettledDay);
  return createSessionWorkspace(runtimeRoot, id, config, { kind: 'planning', thought: PLANNING_THOUGHT, sendFinal: PLANNING_SEND_FINAL, submitFinal: PLANNING_SUBMIT_FINAL_V2, submitMarker: '[DAYLOOM_PLANNING_SUBMIT_V2]\nFinalize this Session now using the Core Planning submission Final contract.', pinned: world, day }, tooling);
}
export function createReviseWorkspace(runtimeRoot: string, id: string, world: PublishedWorld, config: CallerConfig, tooling?: SessionToolingBinding) {
  return createSessionWorkspace(runtimeRoot, id, config, { kind: 'revise', thought: REVISE_THOUGHT, sendFinal: REVISE_SEND_FINAL, submitFinal: REVISE_SUBMIT_FINAL_V2, submitMarker: '[DAYLOOM_REVISE_SUBMIT_V2]\nFinalize this Session now using the Core Revise submission Final contract.', pinned: world }, tooling);
}
export function buildLifecycleContext(session: CoreSession): string | null {
  if (session.kind === 'init') return null;
  const world = session.pinned!, marker = session.kind === 'planning' ? 'PLANNING' : 'REVISE';
  let value = `[DAYLOOM_${marker}_CONTEXT_V1]\n\n[WORLD]\nworld_id: ${world.manifest.worldId}\n`;
  if (session.kind === 'planning') value += `target_day: ${session.day}\n`;
  value += `last_settled_day: ${world.commit.control.lastSettledDay ?? '<none>'}\n\n[CANON_PREMISE]\n${world.canon.premise}\n\n[CANON_RULES]\n${world.canon.rules}\n\n[CANON_STYLE]\n${world.canon.style}\n\n[CANON_USER_ROLE]\n${world.canon.userRole}`;
  if (world.lastSettledSummary !== null) value += `\n\n[LAST_SETTLED_SUMMARY]\n${world.lastSettledSummary}`;
  value += `\n\n[WORLD_PROFILE_V1]\n${JSON.stringify({ state: world.profileV1.state, characterIds: world.profileV1.characterIds, locationIds: world.profileV1.locationIds, arcIds: world.profileV1.arcIds }, null, 2)}\n\n[VERIFIED_WORLD_DOCUMENTS]\n${formatContextDocuments(world.profileV1.contextDocuments)}`;
  return value;
}

function formatContextDocuments(documents: Readonly<Record<string, string>>): string {
  return Object.entries(documents).map(([documentPath, content]) => `--- ${documentPath} ---\n${content}`).join('\n\n');
}
