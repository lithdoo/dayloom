import type { InitSubmissionV2 } from '../../session/submission-v2';
import type { WorldChange } from '../publish';
import { jsonDocument, markdown, yamlDocument } from './encode';

export function buildInitMutationV1(submission: InitSubmissionV2): WorldChange[] {
  const characterIds = new Map(submission.characters.map((item, index) => [item.key, `character${index + 1}`]));
  const locationIds = new Map(submission.locations.map((item, index) => [item.key, `location${index + 1}`]));
  const arcIds = new Map(submission.arcs.map((item, index) => [item.key, `arc${index + 1}`]));
  const changes: WorldChange[] = [
    jsonDocument('profile/dayloom.json', { schemaVersion: 1, profile: 'dayloom', profileVersion: 1 }),
    markdown('canon/premise.md', submission.canon.premise), markdown('canon/rules.md', submission.canon.rules), markdown('canon/style.md', submission.canon.style), markdown('canon/user-role.md', submission.canon.userRole),
    yamlDocument('state/world.yaml', { schemaVersion: 1, title: submission.title.trim(), status: submission.worldState.status }),
    yamlDocument('state/calendar.yaml', { schemaVersion: 1, currentDay: null, elapsed: submission.worldState.elapsed }),
    yamlDocument('state/progress.yaml', { schemaVersion: 1, activeArcIds: submission.arcs.map((item) => item.status === 'active' ? arcIds.get(item.key)! : null).filter(Boolean) }),
    yamlDocument('state/variables.yaml', { schemaVersion: 1, variables: submission.worldState.variables }),
    yamlDocument('characters/index.yaml', { schemaVersion: 1, ids: [...characterIds.values()] }),
    yamlDocument('locations/index.yaml', { schemaVersion: 1, ids: [...locationIds.values()] }),
    yamlDocument('arcs/index.yaml', { schemaVersion: 1, ids: [...arcIds.values()] }),
    markdown('memory/short-term.md', ''), markdown('memory/long-term.md', ''),
    yamlDocument('memory/facts.yaml', { schemaVersion: 1, facts: submission.initialFacts.map((item, index) => ({ id: `fact${index + 1}`, text: item.text, origin: 'init', sourceEventIds: [] })) }),
    yamlDocument('memory/unresolved-threads.yaml', { schemaVersion: 1, threads: submission.unresolvedThreads.map((item, index) => ({ id: `thread${index + 1}`, text: item.text, origin: 'init', sourceEventIds: [] })) }),
    yamlDocument('memory/important-events.yaml', { schemaVersion: 1, events: [] }),
    yamlDocument('story-seeds/active.yaml', { schemaVersion: 1, seeds: submission.storySeeds.map((item, index) => ({ id: `seed${index + 1}`, text: item.text, origin: 'init', sourceEventIds: [] })) }),
  ];
  for (const item of submission.characters) {
    const id = characterIds.get(item.key)!;
    changes.push(markdown(`characters/${id}/profile.md`, item.profile), yamlDocument(`characters/${id}/relationships.yaml`, { schemaVersion: 1, relationships: item.relationships.map((relation) => ({ characterId: characterIds.get(relation.characterKey)!, relation: relation.relation, status: relation.status })) }), yamlDocument(`characters/${id}/state.yaml`, { schemaVersion: 1, status: item.status, locationId: item.locationKey === null ? null : locationIds.get(item.locationKey)!, tags: item.tags }), markdown(`characters/${id}/memory.md`, ''), markdown(`characters/${id}/timeline.md`, ''));
  }
  for (const item of submission.locations) {
    const id = locationIds.get(item.key)!;
    changes.push(markdown(`locations/${id}/profile.md`, item.profile), yamlDocument(`locations/${id}/state.yaml`, { schemaVersion: 1, status: item.status, tags: item.tags }), markdown(`locations/${id}/memory.md`, ''), yamlDocument(`locations/${id}/triggers.yaml`, { schemaVersion: 1, triggers: item.triggers.map((trigger, index) => ({ id: `trigger${index + 1}`, ...trigger })) }), markdown(`locations/${id}/timeline.md`, ''));
  }
  for (const item of submission.arcs) {
    const id = arcIds.get(item.key)!;
    changes.push(markdown(`arcs/${id}/profile.md`, item.profile), yamlDocument(`arcs/${id}/state.yaml`, { schemaVersion: 1, status: item.status, stage: item.stage, progress: null }), markdown(`arcs/${id}/timeline.md`, ''));
  }
  return changes;
}
