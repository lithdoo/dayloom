import type { DomainPatchV1 } from '../../session/submission-v2';
import { parseYamlObjectV1 } from '../profile/yaml';
import type { PersistedEventV1 } from '../profile/events';
import type { PublishedWorld } from '../read';
import type { WorldChange } from '../publish';
import { markdown, yamlDocument } from './encode';

export function buildSettlementMutationV1(world: PublishedWorld, events: readonly PersistedEventV1[]): WorldChange[] {
  if (world.commit.control.day === null || events.length === 0) throw new Error('Profile V1 settlement input is invalid.');
  const documents = world.profileV1.contextDocuments, structured = new Map<string, Record<string, unknown>>(), changed = new Set<string>(), writes = new Set<string>();
  const object = (path: string) => { let value = structured.get(path); if (!value) { value = parseYamlObjectV1(required(documents, path), path); structured.set(path, value); } return value; };
  const applied: DomainPatchV1[] = [];
  for (const event of events) for (const patch of event.patches) {
    const target = patchTarget(patch); if (writes.has(target)) throw new Error(`Settlement contains conflicting writes to ${target}.`); writes.add(target);
    applyPatch(patch, object, changed); applied.push(patch);
  }
  const lastAdvance = [...events].reverse().find((event) => event.timeAdvanced !== null)?.timeAdvanced ?? null;
  { const calendar = object('state/calendar.yaml'); calendar.currentDay = world.commit.control.day; if (lastAdvance !== null) calendar.elapsed = lastAdvance; changed.add('state/calendar.yaml'); }

  const facts = object('memory/facts.yaml'), factItems = asArray(facts.facts, 'memory/facts.yaml.facts'), learned = events.flatMap((event) => event.learnedFacts);
  const addedFactIds = learned.map((text, index) => { const id = `fact${factItems.length + index + 1}`; factItems.push({ id, text, origin: 'settlement', sourceEventIds: events.filter((event) => event.learnedFacts.includes(text)).map((event) => event.id) }); return id; });
  if (learned.length !== 0) changed.add('memory/facts.yaml');
  const important = object('memory/important-events.yaml'), importantItems = asArray(important.events, 'memory/important-events.yaml.events');
  const addedImportantEventIds = events.map((event, index) => { const id = `important-event${importantItems.length + index + 1}`; importantItems.push({ id, text: event.summary, origin: 'settlement', sourceEventIds: [event.id] }); return id; }); changed.add('memory/important-events.yaml');
  const seeds = object('story-seeds/active.yaml'), seedItems = asArray(seeds.seeds, 'story-seeds/active.yaml.seeds'), seedId = `seed${seedItems.length + 1}`;
  seedItems.push({ id: seedId, text: `Continue from: ${events.at(-1)!.summary}`, origin: 'settlement', sourceEventIds: events.map((event) => event.id) }); changed.add('story-seeds/active.yaml');

  const day = world.commit.control.day, changes: WorldChange[] = [];
  for (const path of changed) changes.push(yamlDocument(path, structured.get(path)!));
  appendTimelines(events, documents, changes);
  const summary = events.map((event) => event.summary).join('\n\n');
  changes.push(markdown(`days/${day}/summary.md`, `${summary}\n`), markdown(`days/${day}/diary.md`, `${events.map((event) => `- ${event.title}: ${event.summary}`).join('\n')}\n`), yamlDocument(`days/${day}/settlement.yaml`, { schemaVersion: 1, day, eventIds: events.map((event) => event.id), appliedPatches: applied, addedFactIds, addedImportantEventIds, resolvedThreadIds: [], createdThreadIds: [], createdStorySeedIds: [seedId] }), yamlDocument(`days/${day}/next-day-seed.yaml`, { schemaVersion: 1, day, text: `Continue from: ${events.at(-1)!.summary}`, sourceEventIds: events.map((event) => event.id) }));
  return changes;
}

function applyPatch(patch: DomainPatchV1, object: (path: string) => Record<string, unknown>, changed: Set<string>): void {
  if (patch.op === 'set-world-variable') { const path = 'state/variables.yaml', doc = object(path), variables = doc.variables as Record<string, unknown>; expect(variables[patch.key] ?? null, patch.expected, patch.op); variables[patch.key] = patch.value; changed.add(path); return; }
  if (patch.op === 'set-character-status') { const path = `characters/${patch.characterId}/state.yaml`, doc = object(path); expect(doc.status, patch.expected, patch.op); doc.status = patch.value; changed.add(path); return; }
  if (patch.op === 'move-character') { const path = `characters/${patch.characterId}/state.yaml`, doc = object(path); expect(doc.locationId ?? null, patch.expectedLocationId, patch.op); doc.locationId = patch.locationId; changed.add(path); return; }
  if (patch.op === 'set-location-status') { const path = `locations/${patch.locationId}/state.yaml`, doc = object(path); expect(doc.status, patch.expected, patch.op); doc.status = patch.value; changed.add(path); return; }
  const path = `arcs/${patch.arcId}/state.yaml`, doc = object(path); expect(doc.stage, patch.expected, patch.op); doc.stage = patch.value; changed.add(path);
}
function patchTarget(patch: DomainPatchV1): string {
  if (patch.op === 'set-world-variable') return `world-variable:${patch.key}`;
  if (patch.op === 'set-character-status') return `character:${patch.characterId}:status`;
  if (patch.op === 'move-character') return `character:${patch.characterId}:location`;
  if (patch.op === 'set-location-status') return `location:${patch.locationId}:status`;
  return `arc:${patch.arcId}:stage`;
}
function appendTimelines(events: readonly PersistedEventV1[], documents: Readonly<Record<string, string>>, changes: WorldChange[]): void {
  const additions = new Map<string, string[]>();
  for (const event of events) {
    for (const id of event.participantIds) push(additions, `characters/${id}/timeline.md`, `- ${event.id}: ${event.summary}`);
    if (event.locationId !== null) push(additions, `locations/${event.locationId}/timeline.md`, `- ${event.id}: ${event.summary}`);
    for (const patch of event.patches) if (patch.op === 'set-arc-stage') push(additions, `arcs/${patch.arcId}/timeline.md`, `- ${event.id}: ${event.summary}`);
  }
  for (const [path, lines] of additions) changes.push(markdown(path, `${required(documents, path).trimEnd()}${required(documents, path).trim() === '' ? '' : '\n'}${lines.join('\n')}\n`));
}
function push(map: Map<string, string[]>, key: string, value: string) { const values = map.get(key) ?? []; values.push(value); map.set(key, values); }
function expect(actual: unknown, expected: unknown, operation: string): void { if (!Object.is(actual, expected)) throw new Error(`${operation} precondition failed.`); }
function required(documents: Readonly<Record<string, string>>, path: string): string { const value = documents[path]; if (value === undefined) throw new Error(`Settlement document is missing: ${path}`); return value; }
function asArray(value: unknown, field: string): unknown[] { if (!Array.isArray(value)) throw new Error(`${field} must be an array.`); return value; }
