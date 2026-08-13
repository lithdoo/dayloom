import { parseCurrentPointerV2, type CurrentPointerV2 } from './current';
import { parseArchiveOperationV2, type ArchiveOperationV2 } from './operation';
export type OperationRecoveryClassificationV2='already-published'|'not-published'|'superseded'|'not-prepared';
export function classifyOperationRecoveryV2(input:{operation:ArchiveOperationV2;current:CurrentPointerV2|null}):OperationRecoveryClassificationV2{
 const operation=parseArchiveOperationV2(input.operation);const current=input.current===null?null:parseCurrentPointerV2(input.current);if(operation.status!=='prepared')return'not-prepared';if(current?.commitId===operation.targetCommitId)return'already-published';if(current?.revision===operation.baseRevision&&current?.commitId===operation.baseCommitId)return'not-published';if(current===null&&operation.baseRevision===0&&operation.baseCommitId===null)return'not-published';return'superseded';
}
