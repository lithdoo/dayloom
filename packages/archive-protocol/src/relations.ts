import { parseArchiveCommitV2, type ArchiveCommitV2 } from './commit';
import { parseCurrentPointerV2, type CurrentPointerV2 } from './current';
import { protocolError } from './errors';
import { parseArchiveOperationV2, type ArchiveOperationV2 } from './operation';
import { parseStagingManifestV1, type StagingManifestV1 } from './staging';
import { hashRootTreeV1, parseRootTreeV1, type RootTreeV1 } from './tree';

export function validateCurrentCommitRelationV2(input:{current:CurrentPointerV2;commit:ArchiveCommitV2}):void{
 const current=parseCurrentPointerV2(input.current),commit=parseArchiveCommitV2(input.commit);
 if(current.commitId!==commit.id||current.revision!==commit.revision)protocolError('ARCHIVE_PROTOCOL_REFERENCE_INVALID','Current pointer does not identify the supplied commit revision.');
}

export function validateCommitParentRelationV2(input:{child:ArchiveCommitV2;parent:ArchiveCommitV2|null}):void{
 const child=parseArchiveCommitV2(input.child),parent=input.parent===null?null:parseArchiveCommitV2(input.parent);
 if(parent===null){if(child.parentCommitId!==null||child.revision!==1)protocolError('ARCHIVE_PROTOCOL_REFERENCE_INVALID','The first commit must have revision 1 and no parent.');return;}
 if(child.parentCommitId!==parent.id||child.revision!==parent.revision+1)protocolError('ARCHIVE_PROTOCOL_REFERENCE_INVALID','Child commit does not immediately follow its declared parent.');
}

export function validateOperationStagingRelationV2(input:{operation:ArchiveOperationV2;staging:StagingManifestV1}):void{
 const operation=parseArchiveOperationV2(input.operation),staging=parseStagingManifestV1(input.staging);
 if(operation.baseRevision!==staging.baseRevision||operation.baseCommitId!==staging.baseCommitId||operation.baseRootTreeHash!==staging.baseRootTreeHash)protocolError('ARCHIVE_PROTOCOL_REFERENCE_INVALID','Operation and staging do not pin the same base.');
}

export function validatePreparedTargetRelationV2(input:{operation:ArchiveOperationV2;targetCommit:ArchiveCommitV2;candidateTree:RootTreeV1}):void{
 const operation=parseArchiveOperationV2(input.operation),target=parseArchiveCommitV2(input.targetCommit),candidate=parseRootTreeV1(input.candidateTree);if(operation.status!=='prepared'&&operation.status!=='published')protocolError('ARCHIVE_PROTOCOL_REFERENCE_INVALID','Prepared target relation requires a prepared or published operation.');
 const candidateHash=hashRootTreeV1(candidate),expectedRevision=operation.baseRevision+1;
 if(target.id!==operation.targetCommitId||target.operationId!==operation.id||target.parentCommitId!==operation.baseCommitId||target.revision!==expectedRevision||target.rootTreeHash!==operation.targetRootTreeHash||candidateHash!==operation.targetRootTreeHash)protocolError('ARCHIVE_PROTOCOL_REFERENCE_INVALID','Prepared target does not match the operation and candidate tree.');
}
