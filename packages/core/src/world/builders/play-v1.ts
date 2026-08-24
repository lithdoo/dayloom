import type { DomainPatchV1, PlaySubmissionV2 } from '../../session/submission-v2';
import type { PlayPlanV1, PublishedWorld } from '../read';
import type { WorldChange } from '../publish';
import { jsonDocument, markdown, yamlDocument } from './encode';

export function buildPlayMutationV1(world: PublishedWorld, submission: PlaySubmissionV2): WorldChange[] {
  if (world.profileV1 === null || world.playContext === null || !('version' in world.playContext.plan)) throw new Error('PlaySubmissionV2 requires a Profile V1 plan.');
  const plan = world.playContext.plan as PlayPlanV1, beatIds = new Set(plan.beats.map((beat) => beat.id)), characters = new Set(world.profileV1.characterIds), locations = new Set(world.profileV1.locationIds), arcs = new Set(world.profileV1.arcIds);
  const changes: WorldChange[] = [], eventIds = submission.events.map((_, index) => `event${index + 1}`), timeline: string[] = [];
  for (const [index, event] of submission.events.entries()) {
    if (event.beatId !== null && !beatIds.has(event.beatId) || event.locationId !== null && !locations.has(event.locationId) || event.participantIds.some((id) => !characters.has(id))) throw new Error('PlaySubmissionV2 event reference is invalid.');
    for (const id of [...event.result.completedBeatIds, ...event.result.skippedBeatIds]) if (!beatIds.has(id)) throw new Error('PlaySubmissionV2 result references an unknown beat.');
    if (event.result.completedBeatIds.some((id) => event.result.skippedBeatIds.includes(id))) throw new Error('PlaySubmissionV2 result completes and skips the same beat.');
    for (const patch of event.proposedPatch) validatePatchReference(patch, characters, locations, arcs);
    const id = eventIds[index], root = `days/${world.commit.control.day}/events/${id}`;
    changes.push(yamlDocument(`${root}/event.yaml`, { schemaVersion: 1, id, beatId: event.beatId, title: event.title, locationId: event.locationId, participantIds: event.participantIds, status: 'resolved' }), markdown(`${root}/scene.md`, event.scene), markdown(`${root}/dialogue.md`, event.dialogue), markdown(`${root}/user-action.md`, event.userAction), yamlDocument(`${root}/result.yaml`, { schemaVersion: 1, ...event.result }), yamlDocument(`${root}/state-patch.yaml`, { schemaVersion: 1, changes: event.proposedPatch }));
    timeline.push(`- ${id}: ${event.result.summary}`);
  }
  changes.push(yamlDocument(`days/${world.commit.control.day}/events/index.yaml`, { schemaVersion: 1, ids: eventIds }), markdown(`days/${world.commit.control.day}/timeline.md`, `${timeline.join('\n')}\n`), jsonDocument(`days/${world.commit.control.day}/play-index.json`, { version: 1, eventIds }));
  return changes;
}

function validatePatchReference(patch: DomainPatchV1, characters: ReadonlySet<string>, locations: ReadonlySet<string>, arcs: ReadonlySet<string>): void {
  if ((patch.op === 'set-character-status' || patch.op === 'move-character') && !characters.has(patch.characterId)) throw new Error('DomainPatchV1 references an unknown character.');
  if (patch.op === 'move-character' && (patch.locationId !== null && !locations.has(patch.locationId) || patch.expectedLocationId !== null && !locations.has(patch.expectedLocationId))) throw new Error('DomainPatchV1 references an unknown location.');
  if (patch.op === 'set-location-status' && !locations.has(patch.locationId)) throw new Error('DomainPatchV1 references an unknown location.');
  if (patch.op === 'set-arc-stage' && !arcs.has(patch.arcId)) throw new Error('DomainPatchV1 references an unknown arc.');
}
