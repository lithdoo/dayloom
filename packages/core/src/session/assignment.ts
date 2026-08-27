import type { PublishedWorld } from '../world/read';
import { readTextDocument } from '../world/read';

export async function readHistoricalAssignmentIdsV1(worldRoot: string, base: PublishedWorld | null): Promise<ReadonlySet<string>> {
  const ids = new Set<string>(); if (!base) return ids;
  for (const entry of base.tree.entries) {
    if (!/^audit\/sessions\/[^/]+\/assignment\.json$/.test(entry.path)) continue;
    try {
      const value: unknown = JSON.parse(await readTextDocument(worldRoot, base.tree, entry.path));
      if (value && typeof value === 'object' && !Array.isArray(value)) { const row=value as {ids?:unknown;assignedIds?:unknown},mapping=row.assignedIds??row.ids; if (mapping && typeof mapping === 'object' && !Array.isArray(mapping)) for (const id of Object.values(mapping)) if (typeof id === 'string') ids.add(id); }
    } catch { throw new Error(`Historical assignment is invalid: ${entry.path}`); }
  }
  return Object.freeze(ids);
}
