import {
  encodeCanonicalJsonV1,
  exactKeysV1,
  parseHashV1,
  parseObjectIdV1,
  recordV1,
  schemaVersionV1,
  timestampV1,
} from './common.js';
import { parseDayloomCommandV1, type DayloomPatchV1 } from './patch.js';

export interface ArchiveOperationV1 {
  schemaVersion: 1;
  id: string;
  command: DayloomPatchV1['command'];
  patchHash: string;
  createdAt: string;
}

export function parseArchiveOperationV1(value: unknown): Readonly<ArchiveOperationV1> {
  const o = recordV1(value, 'ArchiveOperationV1');
  exactKeysV1(o, ['schemaVersion', 'id', 'command', 'patchHash', 'createdAt'], 'ArchiveOperationV1');
  schemaVersionV1(o.schemaVersion, 'ArchiveOperationV1');
  return Object.freeze({
    schemaVersion: 1,
    id: parseObjectIdV1(o.id, 'op', 'ArchiveOperationV1.id'),
    command: parseDayloomCommandV1(o.command, 'ArchiveOperationV1.command'),
    patchHash: parseHashV1(o.patchHash, 'ArchiveOperationV1.patchHash'),
    createdAt: timestampV1(o.createdAt, 'ArchiveOperationV1.createdAt'),
  });
}

export function encodeArchiveOperationV1(value: ArchiveOperationV1): Uint8Array {
  const operation = parseArchiveOperationV1(value);
  return encodeCanonicalJsonV1({
    schemaVersion: 1,
    id: operation.id,
    command: operation.command,
    patchHash: operation.patchHash,
    createdAt: operation.createdAt,
  });
}
