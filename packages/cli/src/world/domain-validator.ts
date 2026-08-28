import YAML from 'yaml';
import type { ArchiveMediaTypeV1 } from '@dayloom/archive-protocol';
import type { ScannedWorkspaceV1 } from '../workspace/files.js';
import { decodeWorldTextV1 } from './profile.js';
import { parseStableEntityIdV1 } from './entity-id.js';

export interface ValidatedWorldProfileV1 {
  title: string;
  characterIds: readonly string[];
  locationIds: readonly string[];
  arcIds: readonly string[];
}

export function validateWorldProfileWorkspaceV1(workspace: ScannedWorkspaceV1): Readonly<ValidatedWorldProfileV1> {
  const read = new WorkspaceReaderV1(workspace);
  validateDescriptorV1(read);
  for (const path of ['canon/premise.md', 'canon/rules.md', 'canon/style.md', 'canon/user-role.md'] as const) read.text(path, 'text/markdown');

  const characterIds = readIndexV1(read, 'characters/index.yaml', 'CharacterIndexV1');
  const locationIds = readIndexV1(read, 'locations/index.yaml', 'LocationIndexV1');
  const arcIds = readIndexV1(read, 'arcs/index.yaml', 'ArcIndexV1');
  const characterSet = new Set(characterIds);
  const locationSet = new Set(locationIds);
  const arcSet = new Set(arcIds);

  assertEntityTreeClosureV1(workspace, 'characters', characterSet);
  assertEntityTreeClosureV1(workspace, 'locations', locationSet);
  assertEntityTreeClosureV1(workspace, 'arcs', arcSet);

  for (const id of characterIds) validateCharacterV1(read, id, characterSet, locationSet);
  for (const id of locationIds) validateLocationV1(read, id);
  for (const id of arcIds) validateArcV1(read, id);

  const world = yamlV1(read, 'state/world.yaml', 'WorldStateV1');
  exactV1(world, ['schemaVersion', 'title', 'status'], 'WorldStateV1');
  schemaV1(world.schemaVersion, 'WorldStateV1');
  const title = stringV1(world.title, 'WorldStateV1.title');
  stringV1(world.status, 'WorldStateV1.status');

  const calendar = yamlV1(read, 'state/calendar.yaml', 'CalendarStateV1');
  exactV1(calendar, ['schemaVersion', 'currentDay', 'elapsed'], 'CalendarStateV1');
  schemaV1(calendar.schemaVersion, 'CalendarStateV1');
  if (!(calendar.currentDay === null || typeof calendar.currentDay === 'string' && /^day[1-9][0-9]*$/.test(calendar.currentDay))) throw new Error('CalendarStateV1.currentDay is invalid.');
  if (!(calendar.elapsed === null || typeof calendar.elapsed === 'string')) throw new Error('CalendarStateV1.elapsed is invalid.');

  const progress = yamlV1(read, 'state/progress.yaml', 'ProgressStateV1');
  exactV1(progress, ['schemaVersion', 'activeArcIds'], 'ProgressStateV1');
  schemaV1(progress.schemaVersion, 'ProgressStateV1');
  const activeArcIds = stringArrayV1(progress.activeArcIds, 'ProgressStateV1.activeArcIds');
  if (activeArcIds.some((id) => !arcSet.has(id))) throw new Error('ProgressStateV1 references an unknown arc.');

  const variables = yamlV1(read, 'state/variables.yaml', 'VariablesStateV1');
  exactV1(variables, ['schemaVersion', 'variables'], 'VariablesStateV1');
  schemaV1(variables.schemaVersion, 'VariablesStateV1');
  if (!recordV1(variables.variables)) throw new Error('VariablesStateV1.variables must be an object.');
  for (const [key, value] of Object.entries(variables.variables)) {
    if (!/^[A-Za-z][A-Za-z0-9_-]*$/.test(key)) throw new Error(`VariablesStateV1 variable key is invalid: ${key}.`);
    if (value !== null && !['string', 'number', 'boolean'].includes(typeof value)) throw new Error(`VariablesStateV1 variable value is invalid: ${key}.`);
    if (typeof value === 'number' && !Number.isFinite(value)) throw new Error(`VariablesStateV1 variable value is invalid: ${key}.`);
  }

  validateMemoryV1(read);
  return Object.freeze({
    title,
    characterIds: Object.freeze(characterIds),
    locationIds: Object.freeze(locationIds),
    arcIds: Object.freeze(arcIds),
  });
}

class WorkspaceReaderV1 {
  constructor(private readonly workspace: ScannedWorkspaceV1) {}

  text(documentPath: string, expected: ArchiveMediaTypeV1): string {
    const file = this.workspace.files.get(documentPath);
    if (!file) throw new Error(`Required World document is missing: ${documentPath}.`);
    if (file.mediaType !== expected) throw new Error(`World document has wrong media type: ${documentPath}.`);
    return decodeWorldTextV1(file.bytes, documentPath);
  }

  json(documentPath: string): unknown {
    return JSON.parse(this.text(documentPath, 'application/json'));
  }
}

function validateDescriptorV1(read: WorkspaceReaderV1): void {
  const value = read.json('profile/dayloom.json');
  if (!recordV1(value)) throw new Error('profile/dayloom.json must be an object.');
  exactV1(value, ['schemaVersion', 'profile', 'profileVersion'], 'DayloomProfileV1');
  if (value.schemaVersion !== 1 || value.profile !== 'dayloom' || value.profileVersion !== 1) throw new Error('profile/dayloom.json is not the Dayloom profile descriptor.');
}

function readIndexV1(read: WorkspaceReaderV1, documentPath: string, schema: string): string[] {
  const value = yamlV1(read, documentPath, schema);
  exactV1(value, ['schemaVersion', 'ids'], schema);
  schemaV1(value.schemaVersion, schema);
  const ids = stringArrayV1(value.ids, `${schema}.ids`);
  const seen = new Set<string>();
  for (const id of ids) {
    parseStableEntityIdV1(id, `${schema}.ids`);
    if (seen.has(id)) throw new Error(`${schema}.ids contains a duplicate: ${id}.`);
    seen.add(id);
  }
  return ids;
}

function assertEntityTreeClosureV1(workspace: ScannedWorkspaceV1, root: 'characters' | 'locations' | 'arcs', ids: ReadonlySet<string>): void {
  for (const documentPath of workspace.files.keys()) {
    const match = new RegExp(`^${root}/([^/]+)/`).exec(documentPath);
    if (match && !ids.has(match[1]!)) throw new Error(`${root} contains an unindexed entity directory: ${match[1]}.`);
  }
}

function validateCharacterV1(read: WorkspaceReaderV1, id: string, characters: ReadonlySet<string>, locations: ReadonlySet<string>): void {
  for (const name of ['profile.md', 'memory.md', 'timeline.md'] as const) read.text(`characters/${id}/${name}`, 'text/markdown');
  const stateSchema = `CharacterStateV1(${id})`;
  const state = yamlV1(read, `characters/${id}/state.yaml`, stateSchema);
  exactV1(state, ['schemaVersion', 'status', 'locationId', 'tags'], stateSchema);
  schemaV1(state.schemaVersion, stateSchema);
  stringV1(state.status, `${stateSchema}.status`);
  stringArrayV1(state.tags, `${stateSchema}.tags`);
  const locationId = state.locationId === null ? null : parseStableEntityIdV1(state.locationId, `${stateSchema}.locationId`);
  if (locationId !== null && !locations.has(locationId)) throw new Error(`${stateSchema} references an unknown location.`);

  const relationSchema = `CharacterRelationshipsV1(${id})`;
  const relationDoc = yamlV1(read, `characters/${id}/relationships.yaml`, relationSchema);
  exactV1(relationDoc, ['schemaVersion', 'relationships'], relationSchema);
  schemaV1(relationDoc.schemaVersion, relationSchema);
  if (!Array.isArray(relationDoc.relationships)) throw new Error(`${relationSchema}.relationships must be an array.`);
  const targets = new Set<string>();
  relationDoc.relationships.forEach((raw, index) => {
    if (!recordV1(raw)) throw new Error(`${relationSchema}.relationships[${index}] is invalid.`);
    exactV1(raw, ['characterId', 'relation', 'status'], `${relationSchema}.relationships[${index}]`);
    const target = parseStableEntityIdV1(raw.characterId, `${relationSchema}.relationships[${index}].characterId`);
    if (!characters.has(target) || target === id || targets.has(target)) throw new Error(`${relationSchema} contains an invalid character reference.`);
    targets.add(target);
    stringV1(raw.relation, `${relationSchema}.relationships[${index}].relation`);
    stringV1(raw.status, `${relationSchema}.relationships[${index}].status`);
  });
}

function validateLocationV1(read: WorkspaceReaderV1, id: string): void {
  for (const name of ['profile.md', 'memory.md', 'timeline.md'] as const) read.text(`locations/${id}/${name}`, 'text/markdown');
  const stateSchema = `LocationStateV1(${id})`;
  const state = yamlV1(read, `locations/${id}/state.yaml`, stateSchema);
  exactV1(state, ['schemaVersion', 'status', 'tags'], stateSchema);
  schemaV1(state.schemaVersion, stateSchema);
  stringV1(state.status, `${stateSchema}.status`);
  stringArrayV1(state.tags, `${stateSchema}.tags`);

  const triggerSchema = `LocationTriggersV1(${id})`;
  const triggers = yamlV1(read, `locations/${id}/triggers.yaml`, triggerSchema);
  exactV1(triggers, ['schemaVersion', 'triggers'], triggerSchema);
  schemaV1(triggers.schemaVersion, triggerSchema);
  if (!Array.isArray(triggers.triggers)) throw new Error(`${triggerSchema}.triggers must be an array.`);
  const ids = new Set<string>();
  triggers.triggers.forEach((raw, index) => {
    if (!recordV1(raw)) throw new Error(`${triggerSchema}.triggers[${index}] is invalid.`);
    exactV1(raw, ['id', 'condition', 'effect'], `${triggerSchema}.triggers[${index}]`);
    const triggerId = parseStableEntityIdV1(raw.id, `${triggerSchema}.triggers[${index}].id`);
    if (ids.has(triggerId)) throw new Error(`${triggerSchema} contains duplicate trigger id ${triggerId}.`);
    ids.add(triggerId);
    stringV1(raw.condition, `${triggerSchema}.triggers[${index}].condition`);
    stringV1(raw.effect, `${triggerSchema}.triggers[${index}].effect`);
  });
}

function validateArcV1(read: WorkspaceReaderV1, id: string): void {
  read.text(`arcs/${id}/profile.md`, 'text/markdown');
  read.text(`arcs/${id}/timeline.md`, 'text/markdown');
  const schema = `ArcStateV1(${id})`;
  const state = yamlV1(read, `arcs/${id}/state.yaml`, schema);
  exactV1(state, ['schemaVersion', 'status', 'stage', 'progress'], schema);
  schemaV1(state.schemaVersion, schema);
  if (!['inactive', 'active', 'resolved', 'abandoned'].includes(String(state.status))) throw new Error(`${schema}.status is invalid.`);
  if (typeof state.stage !== 'string') throw new Error(`${schema}.stage must be a string.`);
  if (state.progress !== null && (typeof state.progress !== 'number' || !Number.isFinite(state.progress) || state.progress < 0 || state.progress > 1)) throw new Error(`${schema}.progress is invalid.`);
}

function validateMemoryV1(read: WorkspaceReaderV1): void {
  read.text('memory/short-term.md', 'text/markdown');
  read.text('memory/long-term.md', 'text/markdown');
  for (const [documentPath, key] of [
    ['memory/facts.yaml', 'facts'],
    ['memory/unresolved-threads.yaml', 'threads'],
    ['memory/important-events.yaml', 'events'],
    ['story-seeds/active.yaml', 'seeds'],
  ] as const) {
    const schema = `MemoryCollectionV1(${documentPath})`;
    const value = yamlV1(read, documentPath, schema);
    exactV1(value, ['schemaVersion', key], schema);
    schemaV1(value.schemaVersion, schema);
    if (!Array.isArray(value[key])) throw new Error(`${schema}.${key} must be an array.`);
  }
}

function yamlV1(read: WorkspaceReaderV1, documentPath: string, schema: string): Record<string, unknown> {
  const value: unknown = YAML.parse(read.text(documentPath, 'application/yaml'));
  if (!recordV1(value)) throw new Error(`${schema} must be an object.`);
  return value;
}

function exactV1(value: Record<string, unknown>, keys: readonly string[], schema: string): void {
  const actual = Object.keys(value);
  if (actual.length !== keys.length || keys.some((key) => !(key in value))) throw new Error(`${schema} has unknown or missing fields.`);
}

function schemaV1(value: unknown, schema: string): void {
  if (value !== 1) throw new Error(`${schema}.schemaVersion must be 1.`);
}

function stringV1(value: unknown, schema: string): string {
  if (typeof value !== 'string' || value.trim() === '') throw new Error(`${schema} must be a non-empty string.`);
  return value;
}

function stringArrayV1(value: unknown, schema: string): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string' || item.trim() === '')) throw new Error(`${schema} must be an array of non-empty strings.`);
  if (new Set(value).size !== value.length) throw new Error(`${schema} contains duplicate values.`);
  return value as string[];
}

const recordV1 = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
