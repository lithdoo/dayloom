import { createHash } from 'node:crypto';
import type { DraftDocumentV1 } from './draft-format';
import type { PublishedWorld } from '../world/read';
import { readTextDocument } from '../world/read';

export interface SessionAssignmentV1 {
  readonly schemaVersion: 1; readonly fingerprint: string; readonly kind: DraftDocumentV1['kind'];
  readonly baseRootTreeHash: string | null; readonly ids: Readonly<Record<string, string>>;
}

export function allocateSessionAssignmentV1(draft: DraftDocumentV1, contentHashes: Readonly<Record<string, string>>, base: PublishedWorld | null, reservedIds: ReadonlySet<string> = new Set()): SessionAssignmentV1 {
  const ids: Record<string, string> = {};
  if (draft.kind === 'init') {
    assignKeys(ids, 'character', draft.characters); assignKeys(ids, 'location', draft.locations); assignKeys(ids, 'arc', draft.arcs);
    assignOrdered(ids, 'fact', draft.initialFacts); assignOrdered(ids, 'thread', draft.unresolvedThreads); assignOrdered(ids, 'seed', draft.storySeeds);
    assignNestedTriggers(ids, draft.locations);
  } else if (draft.kind === 'planning') assignOrdered(ids, 'beat', draft.beats);
  else if (draft.kind === 'play') assignOrdered(ids, 'event', draft.events);
  else allocateRevise(ids, draft.operations, base, reservedIds);
  const baseRootTreeHash = base?.commit.rootTreeHash ?? null;
  const fingerprint = createHash('sha256').update(JSON.stringify({ contentHashes: Object.fromEntries(Object.entries(contentHashes).sort(([left], [right]) => left.localeCompare(right, 'en'))), baseRootTreeHash })).digest('hex');
  return Object.freeze({ schemaVersion: 1, fingerprint, kind: draft.kind, baseRootTreeHash, ids: Object.freeze(ids) });
}

function rows(value: unknown): Array<Record<string, unknown>> { return Array.isArray(value) ? value.filter((item): item is Record<string, unknown> => !!item && typeof item === 'object' && !Array.isArray(item)) : []; }
function assignKeys(output: Record<string, string>, prefix: string, value: unknown): void { rows(value).forEach((item, index) => { if (typeof item.key === 'string') output[`${prefix}:${item.key}`] = `${prefix}${index + 1}`; }); }
function assignOrdered(output: Record<string, string>, prefix: string, value: unknown): void { rows(value).forEach((item, index) => { output[`${prefix}:${String(item.key ?? index + 1)}`] = `${prefix}${index + 1}`; }); }
function assignNestedTriggers(output: Record<string, string>, value: unknown): void { for (const location of rows(value)) rows(location.triggers).forEach((_trigger, index) => { output[`trigger:${String(location.key)}:${index + 1}`] = `trigger${index + 1}`; }); }
function allocateRevise(output: Record<string, string>, value: unknown, base: PublishedWorld | null, reservedIds: ReadonlySet<string>): void {
  const used: Record<string, Set<number>> = { character: numbers([...reservedIds, ...(base?.profileV1.characterIds ?? [])], 'character'), location: numbers([...reservedIds, ...(base?.profileV1.locationIds ?? [])], 'location'), arc: numbers([...reservedIds, ...(base?.profileV1.arcIds ?? [])], 'arc'), seed: numbers([...reservedIds], 'seed') };
  for (const [index, operation] of rows(value).entries()) {
    const kind = operation.op === 'create-character' ? 'character' : operation.op === 'create-location' ? 'location' : operation.op === 'create-arc' ? 'arc' : operation.op === 'add-story-seed' ? 'seed' : null;
    if (kind) output[`operation:${index + 1}`] = `${kind}${take(used[kind])}`;
  }
}
function numbers(ids: readonly string[], prefix: string): Set<number> { return new Set(ids.map((id) => Number(new RegExp(`^${prefix}([1-9][0-9]*)$`).exec(id)?.[1] ?? 0)).filter(Boolean)); }
function take(used: Set<number>): number { let value = 1; while (used.has(value)) value += 1; used.add(value); return value; }

export async function readHistoricalAssignmentIdsV1(worldRoot: string, base: PublishedWorld | null): Promise<ReadonlySet<string>> {
  const ids = new Set<string>(); if (!base) return ids;
  for (const entry of base.tree.entries) {
    if (!/^audit\/sessions\/[^/]+\/assignment\.json$/.test(entry.path)) continue;
    try {
      const value: unknown = JSON.parse(await readTextDocument(worldRoot, base.tree, entry.path));
      if (value && typeof value === 'object' && !Array.isArray(value)) { const mapping = (value as { ids?: unknown }).ids; if (mapping && typeof mapping === 'object' && !Array.isArray(mapping)) for (const id of Object.values(mapping)) if (typeof id === 'string') ids.add(id); }
    } catch { throw new Error(`Historical assignment is invalid: ${entry.path}`); }
  }
  return Object.freeze(ids);
}
