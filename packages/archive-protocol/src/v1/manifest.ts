import {
  exactKeysV1,
  parseObjectIdV1,
  recordV1,
  schemaVersionV1,
  stringV1,
  timestampV1,
} from './common.js';

export interface ArchiveManifestV1 {
  schemaVersion: 1;
  worldId: string;
  title: string;
  createdAt: string;
}

export function parseArchiveManifestV1(value: unknown): Readonly<ArchiveManifestV1> {
  const o = recordV1(value, 'ArchiveManifestV1');
  exactKeysV1(o, ['schemaVersion', 'worldId', 'title', 'createdAt'], 'ArchiveManifestV1');
  schemaVersionV1(o.schemaVersion, 'ArchiveManifestV1');
  return Object.freeze({
    schemaVersion: 1,
    worldId: parseObjectIdV1(o.worldId, 'world', 'ArchiveManifestV1.worldId'),
    title: stringV1(o.title, 'ArchiveManifestV1.title'),
    createdAt: timestampV1(o.createdAt, 'ArchiveManifestV1.createdAt'),
  });
}
