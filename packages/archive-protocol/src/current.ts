import { deepFreeze, exactKeys, integer, record, schemaVersion, stableId, timestamp } from './parse';
export interface CurrentPointerV2 { schemaVersion: 2; revision: number; commitId: string; updatedAt: string }
export function parseCurrentPointerV2(value: unknown): Readonly<CurrentPointerV2> {
  const o=record(value,'CurrentPointerV2'); exactKeys(o,['schemaVersion','revision','commitId','updatedAt'],'CurrentPointerV2'); schemaVersion(o.schemaVersion,2,'CurrentPointerV2');
  return deepFreeze({schemaVersion:2,revision:integer(o.revision,'CurrentPointerV2','revision',1),commitId:stableId(o.commitId,'CurrentPointerV2','commitId'),updatedAt:timestamp(o.updatedAt,'CurrentPointerV2','updatedAt')});
}
