import {
  encodeCanonicalJsonV1,
  exactKeysV1,
  integerV1,
  parseObjectIdV1,
  recordV1,
  schemaVersionV1,
  timestampV1,
} from './common.js';

export interface CurrentPointerV1 {
  schemaVersion: 1;
  revision: number;
  commitId: string;
  updatedAt: string;
}

export function parseCurrentPointerV1(value: unknown): Readonly<CurrentPointerV1> {
  const o = recordV1(value, 'CurrentPointerV1');
  exactKeysV1(o, ['schemaVersion', 'revision', 'commitId', 'updatedAt'], 'CurrentPointerV1');
  schemaVersionV1(o.schemaVersion, 'CurrentPointerV1');
  return Object.freeze({
    schemaVersion: 1,
    revision: integerV1(o.revision, 'CurrentPointerV1.revision', 1),
    commitId: parseObjectIdV1(o.commitId, 'commit', 'CurrentPointerV1.commitId'),
    updatedAt: timestampV1(o.updatedAt, 'CurrentPointerV1.updatedAt'),
  });
}

export function encodeCurrentPointerV1(value: CurrentPointerV1): Uint8Array {
  const current = parseCurrentPointerV1(value);
  return encodeCanonicalJsonV1({
    schemaVersion: 1,
    revision: current.revision,
    commitId: current.commitId,
    updatedAt: current.updatedAt,
  });
}
