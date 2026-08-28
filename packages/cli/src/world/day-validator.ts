import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import YAML from 'yaml';
import type { WorldControlV1 } from '@dayloom/archive-protocol';
import type { ScannedWorkspaceV1 } from '../workspace/files.js';
import { parseDomainPatchV1, type DomainPatchV1 } from './domain-patch.js';

export interface SettlementEventV1 {
  id: string;
  title: string;
  locationId: string | null;
  participantIds: string[];
  summary: string;
  learnedFacts: string[];
  timeAdvanced: string | null;
  patches: DomainPatchV1[];
}

interface DaySourceV1 {
  paths: readonly string[];
  read(documentPath: string): Promise<string>;
}

export async function validatePlanArtifactsV1(root: string, day: string): Promise<void> {
  await validatePlanSourceV1(await rootSourceV1(root), day);
}

export async function validateActiveDayWorkspaceV1(workspace: ScannedWorkspaceV1, control: Readonly<WorldControlV1>): Promise<void> {
  if (control.phase === 'idle') return;
  if (control.day === null) throw new Error(`${control.phase} World is missing its active day.`);
  const source: DaySourceV1 = {
    paths: [...workspace.files.keys()],
    async read(documentPath) {
      const file = workspace.files.get(documentPath);
      if (!file) throw new Error(`Day document is missing or invalid UTF-8: ${documentPath}.`);
      try { return new TextDecoder('utf-8', { fatal: true }).decode(file.bytes); }
      catch { throw new Error(`Day document is missing or invalid UTF-8: ${documentPath}.`); }
    },
  };
  if (control.phase === 'planned') await validatePlanSourceV1(source, control.day);
  else await readSettlementEventsFromSourceV1(source, control.day);
}

async function validatePlanSourceV1(source: DaySourceV1, day: string): Promise<void> {
  const plan = await readJsonObjectV1(source, `days/${day}/plan.json`);
  exactV1(plan, ['version', 'intent'], 'plan');
  if (plan.version !== 1 || !nonemptyV1(plan.intent)) throw new Error('Plan is invalid.');
  await requiredNonemptyTextV1(source, `days/${day}/timeline.md`);
  await requiredNonemptyTextV1(source, `days/${day}/dialogue/planning.md`);
  const index = await readYamlObjectV1(source, `days/${day}/events/index.yaml`);
  exactV1(index, ['schemaVersion', 'ids'], 'planned event index');
  if (index.schemaVersion !== 1 || !Array.isArray(index.ids) || index.ids.length !== 0) throw new Error('Planned event index must have empty ids.');
}

export async function readSettlementEventsV1(root: string, day: string): Promise<readonly SettlementEventV1[]> {
  return readSettlementEventsFromSourceV1(await rootSourceV1(root), day);
}

async function readSettlementEventsFromSourceV1(source: DaySourceV1, day: string): Promise<readonly SettlementEventV1[]> {
  const index = await readYamlObjectV1(source, `days/${day}/events/index.yaml`);
  exactV1(index, ['schemaVersion', 'ids'], 'event index');
  if (index.schemaVersion !== 1 || !Array.isArray(index.ids) || index.ids.length === 0) throw new Error('Event index is invalid.');
  const ids = index.ids.map((id, i) => {
    if (id !== `event${i + 1}`) throw new Error('Event IDs must be sequential event1..eventN.');
    return id;
  });

  const playIndex = await readJsonObjectV1(source, `days/${day}/play-index.json`);
  exactV1(playIndex, ['version', 'eventIds'], 'play index');
  if (playIndex.version !== 1 || !Array.isArray(playIndex.eventIds) || JSON.stringify(playIndex.eventIds) !== JSON.stringify(ids)) {
    throw new Error('Play index does not match event index.');
  }

  assertEventDirectoryClosureV1(source, day, ids);
  const events: SettlementEventV1[] = [];
  for (const id of ids) {
    const base = `days/${day}/events/${id}`;
    await requiredNonemptyTextV1(source, `${base}/scene.md`);
    await requiredNonemptyTextV1(source, `${base}/dialogue.md`);
    await requiredNonemptyTextV1(source, `${base}/user-action.md`);

    const event = await readYamlObjectV1(source, `${base}/event.yaml`);
    exactV1(event, ['schemaVersion', 'id', 'beatId', 'title', 'locationId', 'participantIds', 'status'], `event ${id}`);
    if (event.schemaVersion !== 1 || event.id !== id || event.status !== 'resolved' || !nonemptyV1(event.title)) throw new Error(`Event ${id} is invalid.`);
    if (!(event.beatId === null || nonemptyV1(event.beatId))) throw new Error(`Event ${id} beatId is invalid.`);
    if (!(event.locationId === null || nonemptyV1(event.locationId))) throw new Error(`Event ${id} locationId is invalid.`);
    const participantIds = stringArrayV1(event.participantIds, `Event ${id} participantIds`);

    const result = await readYamlObjectV1(source, `${base}/result.yaml`);
    exactV1(result, ['schemaVersion', 'summary', 'learnedFacts', 'timeAdvanced', 'completedBeatIds', 'skippedBeatIds', 'endDay'], `event result ${id}`);
    if (result.schemaVersion !== 1 || !nonemptyV1(result.summary) || !(result.timeAdvanced === null || nonemptyV1(result.timeAdvanced)) || typeof result.endDay !== 'boolean') {
      throw new Error(`Event result ${id} is invalid.`);
    }
    stringArrayV1(result.completedBeatIds, `Event ${id} completedBeatIds`);
    stringArrayV1(result.skippedBeatIds, `Event ${id} skippedBeatIds`);

    const statePatch = await readYamlObjectV1(source, `${base}/state-patch.yaml`);
    exactV1(statePatch, ['schemaVersion', 'changes'], `state patch ${id}`);
    if (statePatch.schemaVersion !== 1 || !Array.isArray(statePatch.changes)) throw new Error(`State patch ${id} is invalid.`);

    const parsedEvent: SettlementEventV1 = {
      id,
      title: event.title,
      locationId: event.locationId as string | null,
      participantIds,
      summary: result.summary,
      learnedFacts: stringArrayV1(result.learnedFacts, `Event ${id} learnedFacts`),
      timeAdvanced: result.timeAdvanced as string | null,
      patches: statePatch.changes.map(parseDomainPatchV1),
    };
    await validateEventReferencesV1(source, parsedEvent);
    events.push(parsedEvent);
  }
  return Object.freeze(events);
}

async function validateEventReferencesV1(source: DaySourceV1, event: SettlementEventV1): Promise<void> {
  for (const characterId of event.participantIds) await source.read(`characters/${characterId}/timeline.md`);
  if (event.locationId !== null) await source.read(`locations/${event.locationId}/timeline.md`);
  for (const patch of event.patches) {
    if (patch.op === 'set-character-status' || patch.op === 'move-character') {
      await source.read(`characters/${patch.characterId}/state.yaml`);
      if (patch.op === 'move-character' && patch.locationId !== null) await source.read(`locations/${patch.locationId}/state.yaml`);
    } else if (patch.op === 'set-location-status') {
      await source.read(`locations/${patch.locationId}/state.yaml`);
    } else if (patch.op === 'set-arc-stage') {
      await source.read(`arcs/${patch.arcId}/state.yaml`);
      await source.read(`arcs/${patch.arcId}/timeline.md`);
    }
  }
}

function assertEventDirectoryClosureV1(source: DaySourceV1, day: string, ids: readonly string[]): void {
  const prefix = `days/${day}/events/`;
  const files = ['dialogue.md', 'event.yaml', 'result.yaml', 'scene.md', 'state-patch.yaml', 'user-action.md'];
  const expected = ['index.yaml', ...ids.flatMap((id) => files.map((file) => `${id}/${file}`))].sort();
  const actual = source.paths.filter((documentPath) => documentPath.startsWith(prefix)).map((documentPath) => documentPath.slice(prefix.length)).sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error('Event directory does not match event index.');
}

async function readYamlObjectV1(source: DaySourceV1, documentPath: string): Promise<Record<string, unknown>> {
  const value = YAML.parse(await source.read(documentPath));
  if (!recordV1(value)) throw new Error(`${documentPath} must contain a YAML object.`);
  return value;
}

async function readJsonObjectV1(source: DaySourceV1, documentPath: string): Promise<Record<string, unknown>> {
  const value = JSON.parse(await source.read(documentPath));
  if (!recordV1(value)) throw new Error(`${documentPath} must contain a JSON object.`);
  return value;
}

async function requiredNonemptyTextV1(source: DaySourceV1, documentPath: string): Promise<string> {
  const text = await source.read(documentPath);
  if (text.trim() === '') throw new Error(`${documentPath} must be non-empty.`);
  return text;
}

async function rootSourceV1(root: string): Promise<DaySourceV1> {
  const paths: string[] = [];
  const walk = async (directory: string, prefix: string): Promise<void> => {
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      const relative = prefix === '' ? entry.name : `${prefix}/${entry.name}`;
      if (entry.isDirectory()) await walk(path.join(directory, entry.name), relative);
      else if (entry.isFile()) paths.push(relative);
    }
  };
  await walk(root, '');
  return {
    paths,
    async read(documentPath) {
      try { return new TextDecoder('utf-8', { fatal: true }).decode(await readFile(path.join(root, ...documentPath.split('/')))); }
      catch { throw new Error(`Day document is missing or invalid UTF-8: ${documentPath}.`); }
    },
  };
}

function stringArrayV1(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || value.some((item) => !nonemptyV1(item))) throw new Error(`${label} must be an array of non-empty strings.`);
  return value as string[];
}

function exactV1(value: Record<string, unknown>, keys: readonly string[], label: string): void {
  if (Object.keys(value).length !== keys.length || keys.some((key) => !(key in value))) throw new Error(`${label} has invalid fields.`);
}

const recordV1 = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const nonemptyV1 = (value: unknown): value is string => typeof value === 'string' && value.trim() !== '';
