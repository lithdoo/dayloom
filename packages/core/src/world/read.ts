import { lstat, mkdir, readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import {
  formatCommitObjectPathV2, formatTreeObjectPathV1,
  hashRootTreeV1, parseArchiveCommitV2, parseArchiveManifestV2, parseCurrentPointerV2,
  parseRootTreeV1, validateCurrentCommitRelationV2,
  type ArchiveCommitV2, type ArchiveManifestV2, type RootTreeV1,
} from '@dayloom/archive-protocol';
import type { CoreWorldState } from '../state';
import { DAYLOOM_PROFILE_DESCRIPTOR_PATH, parseDayloomProfileDescriptorV1 } from './profile/descriptor';
import { createVerifiedDocumentReaderV1 } from './profile/document-reader';
import { validateWorldProfileV1, type WorldProfileV1 } from './profile/validate';
import { readStructuredDayEventsV1 } from './profile/events';
import { parseYamlObjectV1 } from './profile/yaml';

export interface PlayPlanV1 { version: 1; intent: string; knownContext: string[]; constraints: string[]; openQuestions: string[]; maxEvents: number; beats: Array<{ id: string; intent: string; priority: 'required' | 'optional'; dependsOn: string[] }> }
export interface Canon { premise: string; rules: string; style: string; userRole: string }
export interface PlayContext extends Canon { plan: PlayPlanV1 }
export interface PublishedWorld {
  manifest: Readonly<ArchiveManifestV2>; commit: Readonly<ArchiveCommitV2>; tree: Readonly<RootTreeV1>;
  profileV1: Readonly<WorldProfileV1>;
  view: Extract<CoreWorldState, { status: 'published' }>;
  canon: Readonly<Canon>; lastSettledSummary: string | null; playContext: PlayContext | null;
}
export type ClassifiedWorld =
  | { state: Extract<CoreWorldState, { status: 'uninitialized' }>; published: null }
  | { state: Extract<CoreWorldState, { status: 'invalid' }>; published: null }
  | { state: Extract<CoreWorldState, { status: 'published' }>; published: PublishedWorld };

const DAY_ID = /^day[1-9][0-9]*$/;
const mediaTypeFor = (documentPath: string): 'application/json' | 'text/markdown' | null => {
  if (documentPath === DAYLOOM_PROFILE_DESCRIPTOR_PATH) return 'application/json';
  if (/^canon\/(premise|rules|style|user-role)\.md$/.test(documentPath) || /^days\/day[1-9][0-9]*\/summary\.md$/.test(documentPath)) return 'text/markdown';
  if (/^days\/day[1-9][0-9]*\/(plan|play)\.json$/.test(documentPath)) return 'application/json';
  return null;
};
export function parseDayId(value: unknown): string {
  if (typeof value !== 'string' || !DAY_ID.test(value)) throw new Error('Core Day ID is invalid.');
  return value;
}
export function nextDay(lastSettledDay: string | null): string {
  return lastSettledDay === null ? 'day1' : `day${BigInt(parseDayId(lastSettledDay).slice(3)) + 1n}`;
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
  parseDayloomProfileDescriptorV1(await readJsonDocument(root, tree, DAYLOOM_PROFILE_DESCRIPTOR_PATH));
  const profileV1 = await validateWorldProfileV1(root, tree);
  const control = commit.control;
  if (control.phase === 'idle' && control.day !== null) throw new Error('Idle World must not have a current day.');
  if (control.lastSettledDay !== null) parseDayId(control.lastSettledDay);
  if (control.day !== null) {
    parseDayId(control.day);
    if (control.day !== nextDay(control.lastSettledDay)) throw new Error('Current day does not follow lastSettledDay.');
  }
  validateDayTreeStructure(tree, control.day, control.lastSettledDay);
  const canon = Object.freeze({
    premise: await readTextDocument(root, tree, 'canon/premise.md'),
    rules: await readTextDocument(root, tree, 'canon/rules.md'),
    style: await readTextDocument(root, tree, 'canon/style.md'),
    userRole: await readTextDocument(root, tree, 'canon/user-role.md'),
  });
  let lastSettledSummary: string | null = null;
  if (control.lastSettledDay !== null) {
    await readSettledDayV1(root, tree, control.lastSettledDay, profileV1);
    lastSettledSummary = await readSummary(root, tree, control.lastSettledDay);
  }
  let playContext: PlayContext | null = null;
  if (control.day !== null) {
    const day = control.day, planPath = `days/${day}/plan.json`;
    const plan = parsePlayPlanV1(await readJsonDocument(root, tree, planPath));
    const hasPlay = hasDocument(tree, `days/${day}/play.json`), hasSummary = hasDocument(tree, `days/${day}/summary.md`), hasStructuredPlay = hasDocument(tree, `days/${day}/play-index.json`);
    if (control.phase === 'planned' && (hasPlay || hasSummary || hasStructuredPlay)) throw new Error('Planned current day contains completed Play documents.');
    if (control.phase === 'awaiting-settle') {
      if (!hasStructuredPlay) throw new Error('Awaiting-settle World is missing structured Play documents.');
      await readStructuredDayEventsV1(root, tree, day, plan, profileV1);
    }
    playContext = control.phase === 'planned' ? Object.freeze({ ...canon, plan }) : null;
  }
  const view = Object.freeze({ status: 'published' as const, worldId: manifest.worldId, title: manifest.title, revision: commit.revision, commitId: commit.id, phase: control.phase, day: control.day, lastSettledDay: control.lastSettledDay });
  return Object.freeze({ manifest, commit, tree, profileV1, view, canon, lastSettledSummary, playContext });
}

function validateDayTreeStructure(tree: Readonly<RootTreeV1>, currentDay: string | null, lastSettledDay: string | null): void {
  const maximumVisibleDay = currentDay === null ? dayNumber(lastSettledDay) : dayNumber(currentDay);
  for (const entry of tree.entries) {
    const match = /^days\/(day[1-9][0-9]*)\//.exec(entry.path);
    if (match && dayNumber(match[1]) > maximumVisibleDay) throw new Error(`Future Core-owned day document is not legal in the visible tree: ${entry.path}`);
  }
}
function dayNumber(day: string | null): bigint { return day === null ? 0n : BigInt(parseDayId(day).slice(3)); }

export function hasDocument(tree: Readonly<RootTreeV1>, rawPath: string): boolean { return tree.entries.some((entry) => entry.path === rawPath); }
export async function readVerifiedDocument(root: string, tree: Readonly<RootTreeV1>, rawPath: string): Promise<Uint8Array> {
  const expected = mediaTypeFor(rawPath);
  return createVerifiedDocumentReaderV1(root, tree).bytes(rawPath, expected ?? undefined);
}
export async function readTextDocument(root: string, tree: Readonly<RootTreeV1>, rawPath: string): Promise<string> {
  const expected = mediaTypeFor(rawPath);
  return createVerifiedDocumentReaderV1(root, tree).text(rawPath, expected ?? undefined);
}
async function readJsonDocument(root: string, tree: Readonly<RootTreeV1>, rawPath: string): Promise<unknown> {
  return createVerifiedDocumentReaderV1(root, tree).json(rawPath);
}
async function readSummary(root: string, tree: Readonly<RootTreeV1>, day: string): Promise<string> {
  const summary = await readTextDocument(root, tree, `days/${day}/summary.md`);
  if (summary.trim() === '') throw new Error('Day summary must be non-empty.');
  return summary;
}
async function readSettledDayV1(root: string, tree: Readonly<RootTreeV1>, day: string, profile: Readonly<WorldProfileV1>): Promise<void> {
  const plan = parsePlayPlanV1(await readJsonDocument(root, tree, `days/${day}/plan.json`));
  const events = await readStructuredDayEventsV1(root, tree, day, plan, profile);
  const reader = createVerifiedDocumentReaderV1(root, tree);
  await readSummary(root, tree, day);
  const diary = await reader.text(`days/${day}/diary.md`, 'text/markdown');
  if (diary.trim() === '') throw new Error('Settled day diary must be non-empty.');
  const settlement = parseYamlObjectV1(await reader.text(`days/${day}/settlement.yaml`, 'application/yaml'), 'SettlementV1');
  const seed = parseYamlObjectV1(await reader.text(`days/${day}/next-day-seed.yaml`, 'application/yaml'), 'NextDaySeedV1');
  if (!isRecord(settlement) || settlement.schemaVersion !== 1 || settlement.day !== day || !Array.isArray(settlement.eventIds) || JSON.stringify(settlement.eventIds) !== JSON.stringify(events.map((event) => event.id))) throw new Error('SettlementV1 is invalid.');
  if (!isRecord(seed) || seed.schemaVersion !== 1 || seed.day !== day || !nonempty(seed.text) || !Array.isArray(seed.sourceEventIds) || JSON.stringify(seed.sourceEventIds) !== JSON.stringify(events.map((event) => event.id))) throw new Error('NextDaySeedV1 is invalid.');
}
export function parsePlayPlanV1(value: unknown): PlayPlanV1 {
  if (!isRecord(value) || !exact(value, ['version', 'intent', 'knownContext', 'constraints', 'openQuestions', 'maxEvents', 'beats']) || value.version !== 1 || !nonempty(value.intent) || !Array.isArray(value.knownContext) || !Array.isArray(value.constraints) || !Array.isArray(value.openQuestions) || !Number.isSafeInteger(value.maxEvents) || (value.maxEvents as number) < 1 || !Array.isArray(value.beats)) throw new Error('PlayPlanV1 is invalid.');
  for (const items of [value.knownContext, value.constraints, value.openQuestions]) if (items.some((item) => !nonempty(item)) || new Set(items).size !== items.length) throw new Error('PlayPlanV1 text collection is invalid.');
  const ids = new Set<string>(), beats = value.beats.map((item, index) => {
    if (!isRecord(item) || !exact(item, ['id', 'intent', 'priority', 'dependsOn']) || item.id !== `beat${index + 1}` || !nonempty(item.intent) || !['required', 'optional'].includes(String(item.priority)) || !Array.isArray(item.dependsOn) || item.dependsOn.some((id) => typeof id !== 'string' || !ids.has(id))) throw new Error('PlayPlanV1 beat is invalid.');
    ids.add(item.id); return { id: item.id, intent: item.intent, priority: item.priority as 'required' | 'optional', dependsOn: item.dependsOn as string[] };
  });
  return Object.freeze({ version: 1, intent: value.intent, knownContext: value.knownContext as string[], constraints: value.constraints as string[], openQuestions: value.openQuestions as string[], maxEvents: value.maxEvents as number, beats });
}
function nonempty(value: unknown): value is string { return typeof value === 'string' && value.trim() !== ''; }
export const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
export const exact = (value: Record<string, unknown>, keys: readonly string[]): boolean => Object.keys(value).length === keys.length && keys.every((key) => key in value);
