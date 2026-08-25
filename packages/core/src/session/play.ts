import type { CallerConfig } from '../promptpile/config';
import type { PublishedWorld } from '../world/read';
import { createSessionWorkspace, type CoreSession, type SessionToolingBinding } from './common';
import { PLAY_SEND_FINAL_PROMPT, PLAY_SUBMIT_FINAL_PROMPT_V2, PLAY_SUBMIT_MARKER, PLAY_THOUGHT_PROMPT } from './prompts/play';

export interface PlaySession extends CoreSession { kind: 'play'; pinned: PublishedWorld; day: string }
export async function createPlayWorkspace(runtimeRoot: string, id: string, world: PublishedWorld, config: CallerConfig, tooling?: SessionToolingBinding): Promise<PlaySession> {
  if (!world.playContext || world.commit.control.day === null) throw new Error('Play context is not available.');
  return createSessionWorkspace(runtimeRoot, id, config, { kind: 'play', thought: PLAY_THOUGHT_PROMPT, sendFinal: PLAY_SEND_FINAL_PROMPT, submitFinal: PLAY_SUBMIT_FINAL_PROMPT_V2, submitMarker: PLAY_SUBMIT_MARKER, pinned: world, day: world.commit.control.day }, tooling) as Promise<PlaySession>;
}
export function buildContextMessage(world: PublishedWorld): string {
  const context = world.playContext!;
  return `[DAYLOOM_PLAY_CONTEXT_V1]

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
${JSON.stringify(context.plan, null, 2)}\n\n[VERIFIED_WORLD_DOCUMENTS]\n${Object.entries(world.profileV1.contextDocuments).map(([documentPath, content]) => `--- ${documentPath} ---\n${content}`).join('\n\n')}`;
}
