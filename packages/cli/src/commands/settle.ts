import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import YAML from 'yaml';
import { buildTargetControlV1, hashDayloomPatchV1 } from '@dayloom/archive-protocol';
import type { ParsedInvocationV1 } from '../cli/argv.js';
import { cliErrorV1 } from '../cli/errors.js';
import { buildPatchFromTargetTreeV1, changedAfterFilesV1 } from '../patch/build.js';
import { materializeWorkspaceV1, scanWorkspaceV1 } from '../workspace/files.js';
import type { DomainPatchV1 } from '../world/domain-patch.js';
import { readSettlementEventsV1, type SettlementEventV1 } from '../world/day-validator.js';
import { assertPinnedWorldUnchangedV1, publishV1, validatePreparedPublicationV1 } from '../world/publish.js';
import { validateWorldProfileWorkspaceV1 } from '../world/domain-validator.js';
import type { PublishedHeadV1 } from '../world/read.js';
import { assertRequestedBaseV1 } from './base.js';

export async function runSettleV1(
  worldRoot: string,
  invocation: Readonly<ParsedInvocationV1>,
  head: PublishedHeadV1,
): Promise<unknown> {
  assertRequestedBaseV1(invocation.baseCommitId, head);
  const day = head.commit.control.day;
  if (day === null) throw cliErrorV1('NOT_AVAILABLE', 'settle requires a current day.');

  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), 'dayloom-settle-v1-'));
  try {
    await materializeWorkspaceV1({ worldRoot, tree: head.tree, workspaceRoot });
    let events: readonly SettlementEventV1[];
    try {
      events = await readSettlementEventsV1(workspaceRoot, day);
      await applySettlementV1(workspaceRoot, day, events);
    } catch (error) {
      throw cliErrorV1('VALIDATION_FAILED', error instanceof Error ? error.message : 'Settlement input is invalid.');
    }

    const workspace = await scanWorkspaceV1(workspaceRoot);
    try { validateWorldProfileWorkspaceV1(workspace); }
    catch (error) { throw cliErrorV1('VALIDATION_FAILED', error instanceof Error ? error.message : 'Settlement target World is invalid.'); }
    const patch = buildPatchFromTargetTreeV1({
      command: 'settle',
      baseCommitId: head.commit.id,
      baseTree: head.tree,
      targetTree: workspace.tree,
      draftSnapshotHash: null,
      beforeControl: head.commit.control,
      afterControl: buildTargetControlV1('settle', head.commit.control),
    });

    const publication = {
      worldRoot,
      base: head,
      patch,
      targetTree: workspace.tree,
      afterFiles: changedAfterFilesV1(patch, workspace),
    };
    validatePreparedPublicationV1(publication);
    if (invocation.dryRun) {
      await assertPinnedWorldUnchangedV1(worldRoot, head);
      return {
        mode: 'dry-run',
        baseCommitId: head.commit.id,
        patchHash: hashDayloomPatchV1(patch),
        patch,
        changedPaths: patch.changes.length,
        controlChanged: true,
        eventsSettled: events.length,
      };
    }

    return await publishV1(publication);
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
}

async function applySettlementV1(root: string, day: string, events: readonly SettlementEventV1[]): Promise<void> {
  if (events.length === 0) throw new Error('Settlement requires at least one event.');
  const structured = new Map<string, Record<string, unknown>>();
  const changed = new Set<string>();
  const writes = new Set<string>();

  const object = async (documentPath: string): Promise<Record<string, unknown>> => {
    const cached = structured.get(documentPath);
    if (cached) return cached;
    const value = await readYamlObjectV1(root, documentPath);
    structured.set(documentPath, value);
    return value;
  };

  const applied: DomainPatchV1[] = [];
  for (const event of events) {
    for (const patch of event.patches) {
      const target = patchTargetV1(patch);
      if (writes.has(target)) throw new Error(`Settlement contains conflicting writes to ${target}.`);
      writes.add(target);
      await applyDomainPatchV1(patch, object, changed);
      applied.push(patch);
    }
  }

  const lastAdvance = [...events].reverse().find((event) => event.timeAdvanced !== null)?.timeAdvanced ?? null;
  const calendar = await object('state/calendar.yaml');
  calendar.currentDay = day;
  if (lastAdvance !== null) calendar.elapsed = lastAdvance;
  changed.add('state/calendar.yaml');

  const facts = await object('memory/facts.yaml');
  const factItems = arrayFieldV1(facts, 'facts', 'memory/facts.yaml');
  const learned = events.flatMap((event) => event.learnedFacts);
  const addedFactIds = learned.map((text, index) => {
    const id = `fact${factItems.length + index + 1}`;
    factItems.push({ id, text, origin: 'settlement', sourceEventIds: events.filter((event) => event.learnedFacts.includes(text)).map((event) => event.id) });
    return id;
  });
  if (learned.length !== 0) changed.add('memory/facts.yaml');

  const important = await object('memory/important-events.yaml');
  const importantItems = arrayFieldV1(important, 'events', 'memory/important-events.yaml');
  const addedImportantEventIds = events.map((event, index) => {
    const id = `important-event${importantItems.length + index + 1}`;
    importantItems.push({ id, text: event.summary, origin: 'settlement', sourceEventIds: [event.id] });
    return id;
  });
  changed.add('memory/important-events.yaml');

  const seeds = await object('story-seeds/active.yaml');
  const seedItems = arrayFieldV1(seeds, 'seeds', 'story-seeds/active.yaml');
  const seedId = `seed${seedItems.length + 1}`;
  const seedText = `Continue from: ${events.at(-1)!.summary}`;
  seedItems.push({ id: seedId, text: seedText, origin: 'settlement', sourceEventIds: events.map((event) => event.id) });
  changed.add('story-seeds/active.yaml');

  for (const documentPath of changed) await writeYamlV1(root, documentPath, structured.get(documentPath)!);
  await appendTimelinesV1(root, events);

  await writeTextV1(root, `days/${day}/summary.md`, `${events.map((event) => event.summary).join('\n\n')}\n`);
  await writeTextV1(root, `days/${day}/diary.md`, `${events.map((event) => `- ${event.title}: ${event.summary}`).join('\n')}\n`);
  await writeYamlV1(root, `days/${day}/settlement.yaml`, {
    schemaVersion: 1,
    day,
    eventIds: events.map((event) => event.id),
    appliedPatches: applied,
    addedFactIds,
    addedImportantEventIds,
    resolvedThreadIds: [],
    createdThreadIds: [],
    createdStorySeedIds: [seedId],
  });
  await writeYamlV1(root, `days/${day}/next-day-seed.yaml`, {
    schemaVersion: 1,
    day,
    text: seedText,
    sourceEventIds: events.map((event) => event.id),
  });
}

async function applyDomainPatchV1(
  patch: DomainPatchV1,
  object: (path: string) => Promise<Record<string, unknown>>,
  changed: Set<string>,
): Promise<void> {
  if (patch.op === 'set-world-variable') {
    const documentPath = 'state/variables.yaml';
    const doc = await object(documentPath);
    if (!recordV1(doc.variables)) throw new Error('state/variables.yaml.variables must be an object.');
    expectV1(doc.variables[patch.key] ?? null, patch.expected, patch.op);
    doc.variables[patch.key] = patch.value;
    changed.add(documentPath);
    return;
  }
  if (patch.op === 'set-character-status') {
    const documentPath = `characters/${patch.characterId}/state.yaml`;
    const doc = await object(documentPath);
    expectV1(doc.status, patch.expected, patch.op);
    doc.status = patch.value;
    changed.add(documentPath);
    return;
  }
  if (patch.op === 'move-character') {
    const documentPath = `characters/${patch.characterId}/state.yaml`;
    const doc = await object(documentPath);
    expectV1(doc.locationId ?? null, patch.expectedLocationId, patch.op);
    doc.locationId = patch.locationId;
    changed.add(documentPath);
    return;
  }
  if (patch.op === 'set-location-status') {
    const documentPath = `locations/${patch.locationId}/state.yaml`;
    const doc = await object(documentPath);
    expectV1(doc.status, patch.expected, patch.op);
    doc.status = patch.value;
    changed.add(documentPath);
    return;
  }
  const documentPath = `arcs/${patch.arcId}/state.yaml`;
  const doc = await object(documentPath);
  expectV1(doc.stage, patch.expected, patch.op);
  doc.stage = patch.value;
  changed.add(documentPath);
}

async function appendTimelinesV1(root: string, events: readonly SettlementEventV1[]): Promise<void> {
  const additions = new Map<string, string[]>();
  for (const event of events) {
    for (const id of event.participantIds) pushV1(additions, `characters/${id}/timeline.md`, `- ${event.id}: ${event.summary}`);
    if (event.locationId !== null) pushV1(additions, `locations/${event.locationId}/timeline.md`, `- ${event.id}: ${event.summary}`);
    for (const patch of event.patches) if (patch.op === 'set-arc-stage') pushV1(additions, `arcs/${patch.arcId}/timeline.md`, `- ${event.id}: ${event.summary}`);
  }
  for (const [documentPath, lines] of additions) {
    const current = await requiredTextV1(root, documentPath);
    const prefix = current.trim() === '' ? '' : `${current.trimEnd()}\n`;
    await writeTextV1(root, documentPath, `${prefix}${lines.join('\n')}\n`);
  }
}

function patchTargetV1(patch: DomainPatchV1): string {
  if (patch.op === 'set-world-variable') return `world-variable:${patch.key}`;
  if (patch.op === 'set-character-status') return `character:${patch.characterId}:status`;
  if (patch.op === 'move-character') return `character:${patch.characterId}:location`;
  if (patch.op === 'set-location-status') return `location:${patch.locationId}:status`;
  return `arc:${patch.arcId}:stage`;
}

async function readYamlObjectV1(root: string, documentPath: string): Promise<Record<string, unknown>> {
  const value = YAML.parse(await requiredTextV1(root, documentPath));
  if (!recordV1(value)) throw new Error(`${documentPath} must contain a YAML object.`);
  return value;
}

async function requiredTextV1(root: string, documentPath: string): Promise<string> {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(await readFile(path.join(root, ...documentPath.split('/'))));
  } catch {
    throw new Error(`Settlement document is missing or invalid UTF-8: ${documentPath}.`);
  }
}

async function writeYamlV1(root: string, documentPath: string, value: unknown): Promise<void> {
  await writeTextV1(root, documentPath, YAML.stringify(value).trimEnd() + '\n');
}

async function writeTextV1(root: string, documentPath: string, text: string): Promise<void> {
  const target = path.join(root, ...documentPath.split('/'));
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, text, 'utf8');
}

function arrayFieldV1(doc: Record<string, unknown>, key: string, label: string): unknown[] {
  const value = doc[key];
  if (!Array.isArray(value)) throw new Error(`${label}.${key} must be an array.`);
  return value;
}

function expectV1(actual: unknown, expected: unknown, operation: string): void {
  if (!Object.is(actual, expected)) throw new Error(`${operation} precondition failed.`);
}

function pushV1(map: Map<string, string[]>, key: string, value: string): void {
  const values = map.get(key) ?? [];
  values.push(value);
  map.set(key, values);
}

const recordV1 = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
