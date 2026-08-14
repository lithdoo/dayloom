import { lstat, mkdir, readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import {
  formatBlobObjectPathV1, formatCommitObjectPathV2, formatTreeObjectPathV1,
  hashRootTreeV1, parseArchiveCommitV2, parseArchiveManifestV2, parseCurrentPointerV2,
  parseRootTreeV1, parseWorldDocumentPathV1, validateCurrentCommitRelationV2, verifyBlobV1,
  type ArchiveCommitV2, type ArchiveManifestV2, type RootTreeV1,
} from '@dayloom/archive-protocol';
import type { CoreWorldState } from '../state';

export interface PlayPlanV0 { intent: string; beats: Array<{ id: string; intent: string }> }
export interface PersistedPlayV1 {
  version: 1;
  beats: Array<{ id: string; intent: string; status: 'pending' | 'completed' | 'skipped'; eventId: string | null }>;
  events: Array<{ id: string; beatId: string | null; userInput: string; assistantOutput: string }>;
}
export interface CanonV0 { premise: string; rules: string; style: string; userRole: string }
export interface PlayContextV0 extends CanonV0 { plan: PlayPlanV0 }
export interface PublishedWorld {
  manifest: Readonly<ArchiveManifestV2>; commit: Readonly<ArchiveCommitV2>; tree: Readonly<RootTreeV1>;
  view: Extract<CoreWorldState, { status: 'published' }>;
  canon: Readonly<CanonV0>; lastSettledSummary: string | null; playContext: PlayContextV0 | null;
}
export type ClassifiedWorld =
  | { state: Extract<CoreWorldState, { status: 'uninitialized' }>; published: null }
  | { state: Extract<CoreWorldState, { status: 'invalid' }>; published: null }
  | { state: Extract<CoreWorldState, { status: 'published' }>; published: PublishedWorld };

const DAY_ID = /^day[1-9][0-9]*$/;
const mediaTypeFor = (documentPath: string): 'application/json' | 'text/markdown' | null => {
  if (/^canon\/(premise|rules|style|user-role)\.md$/.test(documentPath) || /^days\/day[1-9][0-9]*\/summary\.md$/.test(documentPath)) return 'text/markdown';
  if (/^days\/day[1-9][0-9]*\/(plan|play)\.json$/.test(documentPath)) return 'application/json';
  return null;
};
export function parseDayId(value: unknown): string {
  if (typeof value !== 'string' || !DAY_ID.test(value)) throw new Error('Core2 Day ID is invalid.');
  return value;
}
export function nextDay(lastSettledDay: string | null): string {
  return lastSettledDay === null ? 'day1' : `day${Number(parseDayId(lastSettledDay).slice(3)) + 1}`;
}

async function regularBytes(root: string, relative: string): Promise<Uint8Array> {
  const target = path.join(root, ...relative.split('/'));
  const stat = await lstat(target);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`${relative} must be a regular file.`);
  return readFile(target);
}
async function json(root: string, relative: string): Promise<unknown> {
  return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(await regularBytes(root, relative)));
}
async function hasDurableEvidence(root: string): Promise<boolean> {
  for (const relative of ['manifest.json', 'current.json']) {
    try { await lstat(path.join(root, relative)); return true; } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  }
  const inspect = async (directory: string): Promise<boolean> => {
    try {
      const stat = await lstat(directory);
      if (!stat.isDirectory() || stat.isSymbolicLink()) return true;
    } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false; throw error; }
    let entries;
    try { entries = await readdir(directory, { withFileTypes: true }); }
    catch (error) { throw error; }
    for (const entry of entries) {
      if (!entry.isDirectory()) return true;
      if (await inspect(path.join(directory, entry.name))) return true;
    }
    return false;
  };
  for (const relative of ['commits', 'objects', 'operations']) if (await inspect(path.join(root, relative))) return true;
  return false;
}

export async function classifyWorld(root: string): Promise<ClassifiedWorld> {
  await mkdir(root, { recursive: true });
  if (!await hasDurableEvidence(root)) return { state: Object.freeze({ status: 'uninitialized' }), published: null };
  try {
    const published = await readPublishedWorld(root);
    return { state: published.view, published };
  } catch (error) {
    return { state: Object.freeze({ status: 'invalid', error: Object.freeze({ code: 'WORLD_INVALID', message: error instanceof Error ? error.message : 'Published World is invalid.' }) }), published: null };
  }
}

export async function readPublishedWorld(root: string): Promise<PublishedWorld> {
  const manifest = parseArchiveManifestV2(await json(root, 'manifest.json'));
  const current = parseCurrentPointerV2(await json(root, 'current.json'));
  const commit = parseArchiveCommitV2(await json(root, formatCommitObjectPathV2(current.commitId)));
  validateCurrentCommitRelationV2({ current, commit });
  const tree = parseRootTreeV1(await json(root, formatTreeObjectPathV1(commit.rootTreeHash)));
  if (hashRootTreeV1(tree) !== commit.rootTreeHash) throw new Error('Published root tree hash mismatch.');
  return validatePublishedProfile(root, manifest, commit, tree);
}

export async function validatePublishedProfile(root: string, manifest: Readonly<ArchiveManifestV2>, commit: Readonly<ArchiveCommitV2>, tree: Readonly<RootTreeV1>): Promise<PublishedWorld> {
  const control = commit.control;
  if (control.phase === 'idle' && control.day !== null) throw new Error('Idle World must not have a current day.');
  if (control.lastSettledDay !== null) parseDayId(control.lastSettledDay);
  if (control.day !== null) {
    parseDayId(control.day);
    if (control.day !== nextDay(control.lastSettledDay)) throw new Error('Current day does not follow lastSettledDay.');
  }
  const canon = Object.freeze({
    premise: await readTextDocument(root, tree, 'canon/premise.md'),
    rules: await readTextDocument(root, tree, 'canon/rules.md'),
    style: await readTextDocument(root, tree, 'canon/style.md'),
    userRole: await readTextDocument(root, tree, 'canon/user-role.md'),
  });
  let lastSettledSummary: string | null = null;
  if (control.lastSettledDay !== null) {
    await readDayDocuments(root, tree, control.lastSettledDay, true);
    lastSettledSummary = await readSummary(root, tree, control.lastSettledDay);
  }
  let playContext: PlayContextV0 | null = null;
  if (control.day !== null) {
    const day = control.day, planPath = `days/${day}/plan.json`;
    const plan = parsePlayPlanV0(await readJsonDocument(root, tree, planPath));
    const hasPlay = hasDocument(tree, `days/${day}/play.json`), hasSummary = hasDocument(tree, `days/${day}/summary.md`);
    if (control.phase === 'planned' && (hasPlay || hasSummary)) throw new Error('Planned current day contains completed Play documents.');
    if (control.phase === 'awaiting-settle') await readDayDocuments(root, tree, day, true, plan);
    playContext = control.phase === 'planned' ? Object.freeze({ ...canon, plan }) : null;
  }
  const view = Object.freeze({ status: 'published' as const, worldId: manifest.worldId, title: manifest.title, revision: commit.revision, commitId: commit.id, phase: control.phase, day: control.day, lastSettledDay: control.lastSettledDay });
  return Object.freeze({ manifest, commit, tree, view, canon, lastSettledSummary, playContext });
}

function entryFor(tree: Readonly<RootTreeV1>, rawPath: string) {
  const documentPath = parseWorldDocumentPathV1(rawPath);
  const entry = tree.entries.find((candidate) => candidate.path === documentPath);
  if (!entry) throw new Error(`Required World document is missing: ${documentPath}`);
  const expected = mediaTypeFor(documentPath);
  if (expected !== null && entry.mediaType !== expected) throw new Error(`World document mediaType is invalid: ${documentPath}`);
  return entry;
}
export function hasDocument(tree: Readonly<RootTreeV1>, rawPath: string): boolean { return tree.entries.some((entry) => entry.path === rawPath); }
export async function readVerifiedDocument(root: string, tree: Readonly<RootTreeV1>, rawPath: string): Promise<Uint8Array> {
  const entry = entryFor(tree, rawPath);
  const bytes = await regularBytes(root, formatBlobObjectPathV1(entry.blobHash));
  verifyBlobV1(bytes, entry.blobHash, entry.bytes);
  return bytes;
}
export async function readTextDocument(root: string, tree: Readonly<RootTreeV1>, rawPath: string): Promise<string> {
  return new TextDecoder('utf-8', { fatal: true }).decode(await readVerifiedDocument(root, tree, rawPath));
}
async function readJsonDocument(root: string, tree: Readonly<RootTreeV1>, rawPath: string): Promise<unknown> {
  return JSON.parse(await readTextDocument(root, tree, rawPath));
}
async function readSummary(root: string, tree: Readonly<RootTreeV1>, day: string): Promise<string> {
  const summary = await readTextDocument(root, tree, `days/${day}/summary.md`);
  if (summary.trim() === '') throw new Error('Day summary must be non-empty.');
  return summary;
}
async function readDayDocuments(root: string, tree: Readonly<RootTreeV1>, day: string, completed: boolean, knownPlan?: PlayPlanV0) {
  const plan = knownPlan ?? parsePlayPlanV0(await readJsonDocument(root, tree, `days/${day}/plan.json`));
  if (completed) {
    parsePersistedPlayV1(await readJsonDocument(root, tree, `days/${day}/play.json`), plan);
    await readSummary(root, tree, day);
  }
  return plan;
}

export function parsePlayPlanV0(value: unknown): PlayPlanV0 {
  if (!isRecord(value) || !exact(value, ['intent', 'beats']) || typeof value.intent !== 'string' || value.intent.trim() === '' || !Array.isArray(value.beats)) throw new Error('PlayPlanV0 is invalid.');
  const ids = new Set<string>();
  const beats = value.beats.map((item) => {
    if (!isRecord(item) || !exact(item, ['id', 'intent']) || typeof item.id !== 'string' || item.id.trim() === '' || typeof item.intent !== 'string' || item.intent.trim() === '' || ids.has(item.id)) throw new Error('PlayPlanV0 beat is invalid.');
    ids.add(item.id); return Object.freeze({ id: item.id, intent: item.intent });
  });
  return Object.freeze({ intent: value.intent, beats: Object.freeze(beats) as unknown as PlayPlanV0['beats'] });
}
export function parsePersistedPlayV1(value: unknown, plan: PlayPlanV0): PersistedPlayV1 {
  if (!isRecord(value) || !exact(value, ['version', 'beats', 'events']) || value.version !== 1 || !Array.isArray(value.beats) || !Array.isArray(value.events) || value.beats.length !== plan.beats.length) throw new Error('PersistedPlayV1 is invalid.');
  const events = new Map<string, PersistedPlayV1['events'][number]>();
  const parsedEvents = value.events.map((item) => {
    if (!isRecord(item) || !exact(item, ['id', 'beatId', 'userInput', 'assistantOutput']) || !nonempty(item.id) || !(item.beatId === null || nonempty(item.beatId)) || !nonempty(item.userInput) || !nonempty(item.assistantOutput) || events.has(item.id)) throw new Error('PersistedPlayV1 event is invalid.');
    const event = { id: item.id, beatId: item.beatId, userInput: item.userInput, assistantOutput: item.assistantOutput };
    events.set(event.id, event); return event;
  });
  const planIds = new Set(plan.beats.map((beat) => beat.id));
  for (const event of parsedEvents) if (event.beatId !== null && !planIds.has(event.beatId)) throw new Error('PersistedPlayV1 event relation is invalid.');
  const beats = value.beats.map((item, index) => {
    const expected = plan.beats[index];
    if (!isRecord(item) || !exact(item, ['id', 'intent', 'status', 'eventId']) || item.id !== expected.id || item.intent !== expected.intent || !['pending', 'completed', 'skipped'].includes(item.status as string) || !(item.eventId === null || nonempty(item.eventId))) throw new Error('PersistedPlayV1 beat is invalid.');
    if (item.eventId !== null) { const event = events.get(item.eventId); if (!event || event.beatId !== item.id) throw new Error('PersistedPlayV1 beat relation is invalid.'); }
    return { id: item.id, intent: item.intent, status: item.status as PersistedPlayV1['beats'][number]['status'], eventId: item.eventId };
  });
  return Object.freeze({ version: 1, beats, events: parsedEvents });
}
function nonempty(value: unknown): value is string { return typeof value === 'string' && value.trim() !== ''; }
export const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
export const exact = (value: Record<string, unknown>, keys: readonly string[]): boolean => Object.keys(value).length === keys.length && keys.every((key) => key in value);
