import type { RootTreeV1 } from '@dayloom/archive-protocol';
import { parseDomainPatchV1, type DomainPatchV1 } from '../../session/submission-v2';
import type { PlayPlanV1 } from '../read';
import type { WorldProfileV1 } from './validate';
import { createVerifiedDocumentReaderV1 } from './document-reader';
import { exactObjectV1, isRecord, parseYamlObjectV1, schemaVersionV1, stringArrayV1, stringV1 } from './yaml';

export interface PersistedEventV1 { id: string; beatId: string | null; title: string; locationId: string | null; participantIds: string[]; summary: string; learnedFacts: string[]; timeAdvanced: string | null; completedBeatIds: string[]; skippedBeatIds: string[]; endDay: boolean; patches: DomainPatchV1[] }

export async function readStructuredDayEventsV1(root: string, tree: Readonly<RootTreeV1>, day: string, plan: PlayPlanV1, profile: Readonly<WorldProfileV1>): Promise<readonly PersistedEventV1[]> {
  const reader = createVerifiedDocumentReaderV1(root, tree), index = parseYamlObjectV1(await reader.text(`days/${day}/events/index.yaml`, 'application/yaml'), 'EventIndexV1');
  exactObjectV1(index, ['schemaVersion', 'ids'], 'EventIndexV1'); schemaVersionV1(index.schemaVersion, 'EventIndexV1');
  const ids = stringArrayV1(index.ids, 'EventIndexV1.ids'), beatIds = new Set(plan.beats.map((beat) => beat.id)), characters = new Set(profile.characterIds), locations = new Set(profile.locationIds);
  if (ids.length === 0 || ids.some((id, index) => id !== `event${index + 1}`)) throw new Error('EventIndexV1 ids are invalid.');
  const playIndex = await reader.json(`days/${day}/play-index.json`);
  if (!isRecord(playIndex) || Object.keys(playIndex).length !== 2 || playIndex.version !== 1 || !Array.isArray(playIndex.eventIds) || JSON.stringify(playIndex.eventIds) !== JSON.stringify(ids)) throw new Error('PlayIndexV1 is invalid.');
  const events: PersistedEventV1[] = [];
  for (const id of ids) {
    const base = `days/${day}/events/${id}`;
    await reader.text(`${base}/scene.md`, 'text/markdown'); await reader.text(`${base}/dialogue.md`, 'text/markdown'); const action = await reader.text(`${base}/user-action.md`, 'text/markdown'); if (action.trim() === '') throw new Error('Event user action must be non-empty.');
    const event = parseYamlObjectV1(await reader.text(`${base}/event.yaml`, 'application/yaml'), `EventV1(${id})`);
    exactObjectV1(event, ['schemaVersion', 'id', 'beatId', 'title', 'locationId', 'participantIds', 'status'], `EventV1(${id})`); schemaVersionV1(event.schemaVersion, `EventV1(${id})`);
    if (event.id !== id || event.status !== 'resolved' || !(event.beatId === null || typeof event.beatId === 'string' && beatIds.has(event.beatId)) || !(event.locationId === null || typeof event.locationId === 'string' && locations.has(event.locationId))) throw new Error(`EventV1(${id}) references are invalid.`);
    const participants = stringArrayV1(event.participantIds, `EventV1(${id}).participantIds`); if (participants.some((value) => !characters.has(value))) throw new Error(`EventV1(${id}) participant is invalid.`);
    const result = parseYamlObjectV1(await reader.text(`${base}/result.yaml`, 'application/yaml'), `EventResultV1(${id})`);
    exactObjectV1(result, ['schemaVersion', 'summary', 'learnedFacts', 'timeAdvanced', 'completedBeatIds', 'skippedBeatIds', 'endDay'], `EventResultV1(${id})`); schemaVersionV1(result.schemaVersion, `EventResultV1(${id})`);
    const completedBeatIds = stringArrayV1(result.completedBeatIds, `EventResultV1(${id}).completedBeatIds`), skippedBeatIds = stringArrayV1(result.skippedBeatIds, `EventResultV1(${id}).skippedBeatIds`);
    if ([...completedBeatIds, ...skippedBeatIds].some((value) => !beatIds.has(value)) || completedBeatIds.some((value) => skippedBeatIds.includes(value)) || typeof result.endDay !== 'boolean') throw new Error(`EventResultV1(${id}) is invalid.`);
    const patch = parseYamlObjectV1(await reader.text(`${base}/state-patch.yaml`, 'application/yaml'), `StatePatchV1(${id})`);
    exactObjectV1(patch, ['schemaVersion', 'changes'], `StatePatchV1(${id})`); schemaVersionV1(patch.schemaVersion, `StatePatchV1(${id})`); if (!Array.isArray(patch.changes)) throw new Error(`StatePatchV1(${id}).changes must be an array.`);
    const timeAdvanced = result.timeAdvanced === null ? null : stringV1(result.timeAdvanced, `EventResultV1(${id}).timeAdvanced`), patches = patch.changes.map(parseDomainPatchV1);
    for (const change of patches) {
      if ('characterId' in change && !characters.has(change.characterId) || 'locationId' in change && change.locationId !== null && !locations.has(change.locationId) || change.op === 'move-character' && change.expectedLocationId !== null && !locations.has(change.expectedLocationId) || change.op === 'set-arc-stage' && !profile.arcIds.includes(change.arcId)) throw new Error(`StatePatchV1(${id}) references an unknown entity.`);
    }
    events.push({ id, beatId: event.beatId as string | null, title: stringV1(event.title, `EventV1(${id}).title`), locationId: event.locationId as string | null, participantIds: participants, summary: stringV1(result.summary, `EventResultV1(${id}).summary`), learnedFacts: stringArrayV1(result.learnedFacts, `EventResultV1(${id}).learnedFacts`), timeAdvanced, completedBeatIds, skippedBeatIds, endDay: result.endDay, patches });
  }
  return Object.freeze(events);
}
