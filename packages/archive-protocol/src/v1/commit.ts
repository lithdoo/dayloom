import {
  exactKeysV1,
  integerV1,
  parseHashV1,
  parseNullableObjectIdV1,
  parseObjectIdV1,
  recordV1,
  schemaVersionV1,
  timestampV1,
} from './common.js';
import { parseWorldControlV1, type WorldControlV1 } from './control.js';

export interface ArchiveCommitV1 {
  schemaVersion: 1;
  id: string;
  revision: number;
  parentCommitId: string | null;
  operationId: string;
  createdAt: string;
  rootTreeHash: string;
  control: WorldControlV1;
}

export function parseArchiveCommitV1(value: unknown): Readonly<ArchiveCommitV1> {
  const o = recordV1(value, 'ArchiveCommitV1');
  exactKeysV1(o, ['schemaVersion', 'id', 'revision', 'parentCommitId', 'operationId', 'createdAt', 'rootTreeHash', 'control'], 'ArchiveCommitV1');
  schemaVersionV1(o.schemaVersion, 'ArchiveCommitV1');
  return Object.freeze({
    schemaVersion: 1,
    id: parseObjectIdV1(o.id, 'commit', 'ArchiveCommitV1.id'),
    revision: integerV1(o.revision, 'ArchiveCommitV1.revision', 1),
    parentCommitId: parseNullableObjectIdV1(o.parentCommitId, 'commit', 'ArchiveCommitV1.parentCommitId'),
    operationId: parseObjectIdV1(o.operationId, 'op', 'ArchiveCommitV1.operationId'),
    createdAt: timestampV1(o.createdAt, 'ArchiveCommitV1.createdAt'),
    rootTreeHash: parseHashV1(o.rootTreeHash, 'ArchiveCommitV1.rootTreeHash'),
    control: parseWorldControlV1(o.control, 'ArchiveCommitV1.control'),
  });
}
