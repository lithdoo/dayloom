import type { CallerConfig } from '../promptpile/config';
import type { PublishedWorld } from '../world/read';
import { nextDay } from '../world/read';
import { createSessionWorkspace, type CoreSession, type SessionToolingBinding } from './common';
import { INIT_SEND_FINAL_PROMPT, INIT_THOUGHT_PROMPT } from './prompts/init';
import { PLANNING_SEND_FINAL_PROMPT, PLANNING_THOUGHT_PROMPT } from './prompts/planning';
import { REVISE_SEND_FINAL_PROMPT, REVISE_THOUGHT_PROMPT } from './prompts/revise';

export function createInitWorkspace(runtimeRoot: string, id: string, config: CallerConfig, tooling?: SessionToolingBinding) {
  return createSessionWorkspace(runtimeRoot, id, config, { kind: 'init', thought: INIT_THOUGHT_PROMPT, sendFinal: INIT_SEND_FINAL_PROMPT, pinned: null }, tooling);
}
export function createPlanningWorkspace(runtimeRoot: string, id: string, world: PublishedWorld, config: CallerConfig, tooling?: SessionToolingBinding) {
  const day = nextDay(world.commit.control.lastSettledDay);
  return createSessionWorkspace(runtimeRoot, id, config, { kind: 'planning', thought: PLANNING_THOUGHT_PROMPT, sendFinal: PLANNING_SEND_FINAL_PROMPT, pinned: world, day }, tooling);
}
export function createReviseWorkspace(runtimeRoot: string, id: string, world: PublishedWorld, config: CallerConfig, tooling?: SessionToolingBinding) {
  return createSessionWorkspace(runtimeRoot, id, config, { kind: 'revise', thought: REVISE_THOUGHT_PROMPT, sendFinal: REVISE_SEND_FINAL_PROMPT, pinned: world }, tooling);
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
