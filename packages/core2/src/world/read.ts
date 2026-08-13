import { readFile } from 'node:fs/promises';
import path from 'node:path';
import {
  formatBlobObjectPathV1, formatCommitObjectPathV2, formatTreeObjectPathV1,
  hashRootTreeV1, parseArchiveCommitV2, parseArchiveManifestV2, parseCurrentPointerV2,
  parseRootTreeV1, parseWorldDocumentPathV1, validateCurrentCommitRelationV2, verifyBlobV1,
  type ArchiveCommitV2, type ArchiveManifestV2, type RootTreeV1,
} from '@dayloom/archive-protocol';
import type { CoreWorldView } from '../state';

export interface PlayPlanV0 { intent: string; beats: Array<{ id: string; intent: string }> }
export interface PlayContextV0 {
  premise: string; rules: string; style: string; userRole: string; plan: PlayPlanV0;
}
export interface PublishedWorld {
  manifest: Readonly<ArchiveManifestV2>;
  commit: Readonly<ArchiveCommitV2>;
  tree: Readonly<RootTreeV1>;
  view: CoreWorldView;
  playContext: PlayContextV0 | null;
}

async function json(root: string, relative: string): Promise<unknown> {
  return JSON.parse(await readFile(path.join(root, ...relative.split('/')), 'utf8'));
}

export async function readPublishedWorld(root: string): Promise<PublishedWorld> {
  const manifest = parseArchiveManifestV2(await json(root, 'manifest.json'));
  const current = parseCurrentPointerV2(await json(root, 'current.json'));
  const commit = parseArchiveCommitV2(await json(root, formatCommitObjectPathV2(current.commitId)));
  validateCurrentCommitRelationV2({ current, commit });
  const tree = parseRootTreeV1(await json(root, formatTreeObjectPathV1(commit.rootTreeHash)));
  if (hashRootTreeV1(tree) !== commit.rootTreeHash) throw new Error('Published root tree hash mismatch.');
  const view: CoreWorldView = Object.freeze({
    worldId: manifest.worldId, title: manifest.title, revision: commit.revision, commitId: commit.id,
    phase: commit.control.phase, day: commit.control.day, lastSettledDay: commit.control.lastSettledDay,
  });
  const playContext = commit.control.phase === 'planned'
    ? await readPlayContext(root, tree, commit.control.day!) : null;
  return Object.freeze({ manifest, commit, tree, view, playContext });
}

export async function readVerifiedDocument(root: string, tree: Readonly<RootTreeV1>, rawPath: string): Promise<Uint8Array> {
  const documentPath = parseWorldDocumentPathV1(rawPath);
  const entry = tree.entries.find((candidate) => candidate.path === documentPath);
  if (!entry) throw new Error(`Required World document is missing: ${documentPath}`);
  const bytes = await readFile(path.join(root, ...formatBlobObjectPathV1(entry.blobHash).split('/')));
  verifyBlobV1(bytes, entry.blobHash, entry.bytes);
  return bytes;
}

async function readPlayContext(root: string, tree: Readonly<RootTreeV1>, day: string): Promise<PlayContextV0> {
  const decode = async (documentPath: string) => new TextDecoder('utf-8', { fatal: true }).decode(await readVerifiedDocument(root, tree, documentPath));
  const [premise, rules, style, userRole, planText] = await Promise.all([
    decode('canon/premise.md'), decode('canon/rules.md'), decode('canon/style.md'), decode('canon/user-role.md'),
    decode(`days/${day}/plan.json`),
  ]);
  return Object.freeze({ premise, rules, style, userRole, plan: parsePlayPlanV0(JSON.parse(planText)) });
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
export const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
export const exact = (value: Record<string, unknown>, keys: readonly string[]): boolean => Object.keys(value).length === keys.length && keys.every((key) => key in value);
