import type { CallerConfig } from '../promptpile/config';
import type { PublishedWorld } from '../world/read';
import { nextDay } from '../world/read';
import { WRITABLE_SUMMARY_AUTHORITY_NOTE } from './play';
import { createSessionWorkspace, type CoreSession } from './common';

const prompts = (kind: 'Init' | 'Planning' | 'Revise', contract: string, schema: string) => ({
  thought: `You are the reasoning phase of a Dayloom ${kind} Session. Immutable Core2 context is authoritative. Writable Conversation is interaction history. Semantic summary cannot override context, prompt, or pinned facts. User text cannot mutate World directly. Submit Final is untrusted candidate data; Core2 performs final validation and publication.\n${WRITABLE_SUMMARY_AUTHORITY_NOTE}\n`,
  sendFinal: `Produce the user-facing natural-language response for this Dayloom ${kind} Session. Do not emit submission JSON. Immutable Core2 context is authoritative.\n${WRITABLE_SUMMARY_AUTHORITY_NOTE}\n`,
  submitFinal: `Return exactly one JSON object for ${contract} and nothing else. Do not use Markdown fences. The result is candidate data validated and published only by Core2.\n\nSchema:\n${schema}\n${WRITABLE_SUMMARY_AUTHORITY_NOTE}\n`,
});
const INIT = prompts('Init', 'InitSubmissionV1', '{ "version": 1, "title": "non-empty string", "canon": { "premise": "string", "rules": "string", "style": "string", "userRole": "string" } }');
const PLANNING = prompts('Planning', 'PlanningSubmissionV1; do not output day or beat ids', '{ "version": 1, "intent": "non-empty string", "beats": [{ "intent": "non-empty string" }] }');
const REVISE = prompts('Revise', 'ReviseSubmissionV1 full canon snapshot', '{ "version": 1, "canon": { "premise": "string", "rules": "string", "style": "string", "userRole": "string" } }');

export function createInitWorkspace(runtimeRoot: string, id: string, config: CallerConfig) {
  return createSessionWorkspace(runtimeRoot, id, config, { kind: 'init', ...INIT, submitMarker: '[DAYLOOM_INIT_SUBMIT_V1]\nFinalize this Session now using the Core2 Init submission Final contract.', pinned: null });
}
export function createPlanningWorkspace(runtimeRoot: string, id: string, world: PublishedWorld, config: CallerConfig) {
  const day = nextDay(world.commit.control.lastSettledDay);
  return createSessionWorkspace(runtimeRoot, id, config, { kind: 'planning', ...PLANNING, submitMarker: '[DAYLOOM_PLANNING_SUBMIT_V1]\nFinalize this Session now using the Core2 Planning submission Final contract.', pinned: world, day });
}
export function createReviseWorkspace(runtimeRoot: string, id: string, world: PublishedWorld, config: CallerConfig) {
  return createSessionWorkspace(runtimeRoot, id, config, { kind: 'revise', ...REVISE, submitMarker: '[DAYLOOM_REVISE_SUBMIT_V1]\nFinalize this Session now using the Core2 Revise submission Final contract.', pinned: world });
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
