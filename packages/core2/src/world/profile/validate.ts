import type { RootTreeV1 } from '@dayloom/archive-protocol';
import { createVerifiedDocumentReaderV1, type VerifiedDocumentReaderV1 } from './document-reader';
import { exactObjectV1, isRecord, nullableStringV1, parseYamlObjectV1, schemaVersionV1, stringArrayV1, stringV1 } from './yaml';

export interface WorldProfileV1 {
  state: {
    world: { title: string; status: string };
    calendar: { currentDay: string | null; elapsed: string | null };
    progress: { activeArcIds: readonly string[] };
    variables: Readonly<Record<string, string | number | boolean | null>>;
  };
  characterIds: readonly string[];
  locationIds: readonly string[];
  arcIds: readonly string[];
  contextDocuments: Readonly<Record<string, string>>;
}

export async function validateWorldProfileV1(root: string, tree: Readonly<RootTreeV1>): Promise<Readonly<WorldProfileV1>> {
  const reader = createVerifiedDocumentReaderV1(root, tree);
  const characterIds = await readIndex(reader, 'characters/index.yaml', 'CharacterIndexV1');
  const locationIds = await readIndex(reader, 'locations/index.yaml', 'LocationIndexV1');
  const arcIds = await readIndex(reader, 'arcs/index.yaml', 'ArcIndexV1');
  const characterSet = new Set(characterIds), locationSet = new Set(locationIds), arcSet = new Set(arcIds);

  for (const id of characterIds) await validateCharacter(reader, id, characterSet, locationSet);
  for (const id of locationIds) await validateLocation(reader, id);
  for (const id of arcIds) await validateArc(reader, id);

  const world = await parseWorldState(reader);
  const calendar = await parseCalendar(reader);
  const progress = await parseProgress(reader, arcSet);
  const variables = await parseVariables(reader);
  await validateMemory(reader);
  const contextDocuments: Record<string, string> = {};
  for (const entry of tree.entries) if (/^(?:canon|state|characters|locations|arcs|memory|story-seeds)\//.test(entry.path)) contextDocuments[entry.path] = await reader.text(entry.path, entry.mediaType);
  return Object.freeze({
    state: Object.freeze({ world, calendar, progress, variables }),
    characterIds: Object.freeze(characterIds), locationIds: Object.freeze(locationIds), arcIds: Object.freeze(arcIds), contextDocuments: Object.freeze(contextDocuments),
  });
}

async function yaml(reader: VerifiedDocumentReaderV1, path: string, schema: string): Promise<Record<string, unknown>> {
  return parseYamlObjectV1(await reader.text(path, 'application/yaml'), schema);
}

async function readIndex(reader: VerifiedDocumentReaderV1, path: string, schema: string): Promise<string[]> {
  const value = await yaml(reader, path, schema);
  exactObjectV1(value, ['schemaVersion', 'ids'], schema); schemaVersionV1(value.schemaVersion, schema);
  const ids = stringArrayV1(value.ids, `${schema}.ids`);
  for (const id of ids) stableEntityId(id, `${schema}.ids`);
  return ids;
}

async function parseWorldState(reader: VerifiedDocumentReaderV1) {
  const schema = 'WorldStateV1', value = await yaml(reader, 'state/world.yaml', schema);
  exactObjectV1(value, ['schemaVersion', 'title', 'status'], schema); schemaVersionV1(value.schemaVersion, schema);
  return Object.freeze({ title: stringV1(value.title, `${schema}.title`), status: stringV1(value.status, `${schema}.status`) });
}

async function parseCalendar(reader: VerifiedDocumentReaderV1) {
  const schema = 'CalendarStateV1', value = await yaml(reader, 'state/calendar.yaml', schema);
  exactObjectV1(value, ['schemaVersion', 'currentDay', 'elapsed'], schema); schemaVersionV1(value.schemaVersion, schema);
  const currentDay = value.currentDay === null ? null : stringV1(value.currentDay, `${schema}.currentDay`);
  if (currentDay !== null && !/^day[1-9][0-9]*$/.test(currentDay)) throw new Error(`${schema}.currentDay is invalid.`);
  return Object.freeze({ currentDay, elapsed: nullableStringV1(value.elapsed, `${schema}.elapsed`) });
}

async function parseProgress(reader: VerifiedDocumentReaderV1, arcIds: ReadonlySet<string>) {
  const schema = 'ProgressStateV1', value = await yaml(reader, 'state/progress.yaml', schema);
  exactObjectV1(value, ['schemaVersion', 'activeArcIds'], schema); schemaVersionV1(value.schemaVersion, schema);
  const activeArcIds = stringArrayV1(value.activeArcIds, `${schema}.activeArcIds`);
  if (activeArcIds.some((id) => !arcIds.has(id))) throw new Error(`${schema} references an unknown arc.`);
  return Object.freeze({ activeArcIds: Object.freeze(activeArcIds) });
}

async function parseVariables(reader: VerifiedDocumentReaderV1) {
  const schema = 'VariablesStateV1', value = await yaml(reader, 'state/variables.yaml', schema);
  exactObjectV1(value, ['schemaVersion', 'variables'], schema); schemaVersionV1(value.schemaVersion, schema);
  if (!isRecord(value.variables)) throw new Error(`${schema}.variables must be an object.`);
  const result: Record<string, string | number | boolean | null> = {};
  for (const [key, item] of Object.entries(value.variables)) {
    if (!/^[A-Za-z][A-Za-z0-9_-]*$/.test(key) || item !== null && !['string', 'number', 'boolean'].includes(typeof item) || typeof item === 'number' && !Number.isFinite(item)) throw new Error(`${schema}.variables is invalid.`);
    result[key] = item as string | number | boolean | null;
  }
  return Object.freeze(result);
}

async function validateCharacter(reader: VerifiedDocumentReaderV1, id: string, characters: ReadonlySet<string>, locations: ReadonlySet<string>): Promise<void> {
  await reader.text(`characters/${id}/profile.md`, 'text/markdown');
  await reader.text(`characters/${id}/memory.md`, 'text/markdown');
  await reader.text(`characters/${id}/timeline.md`, 'text/markdown');
  const stateSchema = `CharacterStateV1(${id})`, state = await yaml(reader, `characters/${id}/state.yaml`, stateSchema);
  exactObjectV1(state, ['schemaVersion', 'status', 'locationId', 'tags'], stateSchema); schemaVersionV1(state.schemaVersion, stateSchema);
  stringV1(state.status, `${stateSchema}.status`); stringArrayV1(state.tags, `${stateSchema}.tags`);
  const locationId = state.locationId === null ? null : stableEntityId(state.locationId, `${stateSchema}.locationId`);
  if (locationId !== null && !locations.has(locationId)) throw new Error(`${stateSchema} references an unknown location.`);
  const relationSchema = `CharacterRelationshipsV1(${id})`, relationDoc = await yaml(reader, `characters/${id}/relationships.yaml`, relationSchema);
  exactObjectV1(relationDoc, ['schemaVersion', 'relationships'], relationSchema); schemaVersionV1(relationDoc.schemaVersion, relationSchema);
  if (!Array.isArray(relationDoc.relationships)) throw new Error(`${relationSchema}.relationships must be an array.`);
  const targets = new Set<string>();
  for (const [index, raw] of relationDoc.relationships.entries()) {
    if (!isRecord(raw)) throw new Error(`${relationSchema}.relationships[${index}] is invalid.`);
    exactObjectV1(raw, ['characterId', 'relation', 'status'], `${relationSchema}.relationships[${index}]`);
    const target = stableEntityId(raw.characterId, `${relationSchema}.relationships[${index}].characterId`);
    if (!characters.has(target) || targets.has(target)) throw new Error(`${relationSchema} contains an invalid character reference.`);
    targets.add(target); stringV1(raw.relation, `${relationSchema}.relation`); stringV1(raw.status, `${relationSchema}.status`);
  }
}

async function validateLocation(reader: VerifiedDocumentReaderV1, id: string): Promise<void> {
  for (const name of ['profile.md', 'memory.md', 'timeline.md']) await reader.text(`locations/${id}/${name}`, 'text/markdown');
  const stateSchema = `LocationStateV1(${id})`, state = await yaml(reader, `locations/${id}/state.yaml`, stateSchema);
  exactObjectV1(state, ['schemaVersion', 'status', 'tags'], stateSchema); schemaVersionV1(state.schemaVersion, stateSchema);
  stringV1(state.status, `${stateSchema}.status`); stringArrayV1(state.tags, `${stateSchema}.tags`);
  const triggerSchema = `LocationTriggersV1(${id})`, triggers = await yaml(reader, `locations/${id}/triggers.yaml`, triggerSchema);
  exactObjectV1(triggers, ['schemaVersion', 'triggers'], triggerSchema); schemaVersionV1(triggers.schemaVersion, triggerSchema);
  if (!Array.isArray(triggers.triggers)) throw new Error(`${triggerSchema}.triggers must be an array.`);
  for (const [index, raw] of triggers.triggers.entries()) {
    if (!isRecord(raw)) throw new Error(`${triggerSchema}.triggers[${index}] is invalid.`);
    exactObjectV1(raw, ['id', 'condition', 'effect'], `${triggerSchema}.triggers[${index}]`);
    stableEntityId(raw.id, `${triggerSchema}.trigger.id`); stringV1(raw.condition, `${triggerSchema}.condition`); stringV1(raw.effect, `${triggerSchema}.effect`);
  }
}

async function validateArc(reader: VerifiedDocumentReaderV1, id: string): Promise<void> {
  await reader.text(`arcs/${id}/profile.md`, 'text/markdown'); await reader.text(`arcs/${id}/timeline.md`, 'text/markdown');
  const schema = `ArcStateV1(${id})`, state = await yaml(reader, `arcs/${id}/state.yaml`, schema);
  exactObjectV1(state, ['schemaVersion', 'status', 'stage', 'progress'], schema); schemaVersionV1(state.schemaVersion, schema);
  if (!['inactive', 'active', 'resolved', 'abandoned'].includes(String(state.status))) throw new Error(`${schema}.status is invalid.`);
  stringV1(state.stage, `${schema}.stage`, true);
  if (state.progress !== null && (typeof state.progress !== 'number' || !Number.isFinite(state.progress) || state.progress < 0 || state.progress > 1)) throw new Error(`${schema}.progress is invalid.`);
}

async function validateMemory(reader: VerifiedDocumentReaderV1): Promise<void> {
  await reader.text('memory/short-term.md', 'text/markdown'); await reader.text('memory/long-term.md', 'text/markdown');
  for (const [path, key] of [['memory/facts.yaml', 'facts'], ['memory/unresolved-threads.yaml', 'threads'], ['memory/important-events.yaml', 'events'], ['story-seeds/active.yaml', 'seeds']] as const) {
    const schema = `MemoryCollectionV1(${path})`, value = await yaml(reader, path, schema);
    exactObjectV1(value, ['schemaVersion', key], schema); schemaVersionV1(value.schemaVersion, schema);
    if (!Array.isArray(value[key])) throw new Error(`${schema}.${key} must be an array.`);
  }
}

function stableEntityId(value: unknown, schema: string): string {
  if (typeof value !== 'string' || !/^[a-z][a-z0-9-]*$/.test(value)) throw new Error(`${schema} must be a stable entity identifier.`);
  return value;
}
