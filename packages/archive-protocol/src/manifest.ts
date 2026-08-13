import { deepFreeze, exactKeys, record, schemaVersion, stableId, string, timestamp } from './parse';
export interface ArchiveManifestV2 { schemaVersion: 2; worldId: string; title: string; createdAt: string }
export function parseArchiveManifestV2(value: unknown): Readonly<ArchiveManifestV2> {
  const o = record(value, 'ArchiveManifestV2'); exactKeys(o, ['schemaVersion','worldId','title','createdAt'], 'ArchiveManifestV2'); schemaVersion(o.schemaVersion, 2, 'ArchiveManifestV2');
  return deepFreeze({ schemaVersion: 2, worldId: stableId(o.worldId,'ArchiveManifestV2','worldId'), title: string(o.title,'ArchiveManifestV2','title'), createdAt: timestamp(o.createdAt,'ArchiveManifestV2','createdAt') });
}
