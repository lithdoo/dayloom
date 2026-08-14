import { parseBlobHashV1 } from './blob';
import { protocolError } from './errors';
import { parseArchiveMediaTypeV1, type ArchiveMediaTypeV1 } from './media';
import { deepFreeze, exactKeys, integer, nullable, record, schemaVersion, stableId } from './parse';
import { compareWorldDocumentPathsV1, parseWorldDocumentPathV1, portableCollisionKeyV1 } from './path';
import { createRootTreeV1, hashRootTreeV1, parseRootTreeV1, type DocumentTreeEntryV1, type RootTreeV1 } from './tree';
export type StagedChangeV1={op:'put';path:string;mediaType:ArchiveMediaTypeV1;bytes:number;sha256:string;fileId:string}|{op:'delete';path:string};
export interface StagingManifestV1{schemaVersion:1;baseRevision:number;baseCommitId:string|null;baseRootTreeHash:string|null;changes:StagedChangeV1[]}
export function parseStagingManifestV1(value:unknown):Readonly<StagingManifestV1>{
 const o=record(value,'StagingManifestV1'); exactKeys(o,['schemaVersion','baseRevision','baseCommitId','baseRootTreeHash','changes'],'StagingManifestV1'); schemaVersion(o.schemaVersion,1,'StagingManifestV1'); if(!Array.isArray(o.changes)) protocolError('ARCHIVE_PROTOCOL_SHAPE_INVALID','StagingManifestV1.changes must be an array.');
 const changes=o.changes.map((item,i)=>parseChange(item,i)); let previous:string|undefined; const portable=new Set<string>(); for(const change of changes){const key=portableCollisionKeyV1(change.path);if(portable.has(key))protocolError('ARCHIVE_PROTOCOL_PATH_COLLISION','Staging changes contain a path collision.',{path:change.path});portable.add(key);if(previous!==undefined&&compareWorldDocumentPathsV1(previous,change.path)>=0)protocolError('ARCHIVE_PROTOCOL_SHAPE_INVALID','Staging changes must be in canonical order.');previous=change.path;}
 const baseRevision=integer(o.baseRevision,'StagingManifestV1','baseRevision',0); const baseCommitId=nullable(o.baseCommitId,v=>stableId(v,'StagingManifestV1','baseCommitId')); const baseRootTreeHash=nullable(o.baseRootTreeHash,v=>parseBlobHashV1(v,'baseRootTreeHash')); validateBaseReferences(baseRevision,baseCommitId,baseRootTreeHash);
 return deepFreeze({schemaVersion:1,baseRevision,baseCommitId,baseRootTreeHash,changes});
}
function parseChange(value:unknown,index:number):StagedChangeV1{const s=`StagingManifestV1.changes[${index}]`,o=record(value,s);if(o.op==='put'){exactKeys(o,['op','path','mediaType','bytes','sha256','fileId'],s);return{op:'put',path:parseWorldDocumentPathV1(o.path),mediaType:parseArchiveMediaTypeV1(o.mediaType),bytes:integer(o.bytes,s,'bytes',0),sha256:parseBlobHashV1(o.sha256,`${s}.sha256`),fileId:stableId(o.fileId,s,'fileId')}}if(o.op==='delete'){exactKeys(o,['op','path'],s);return{op:'delete',path:parseWorldDocumentPathV1(o.path)}}protocolError('ARCHIVE_PROTOCOL_SHAPE_INVALID',`${s}.op must be put or delete.`);}

function validateBaseReferences(revision:number,commitId:string|null,treeHash:string|null):void{
 const isEmpty=revision===0;const refsAreEmpty=commitId===null&&treeHash===null;const refsAreComplete=commitId!==null&&treeHash!==null;
 if((isEmpty&&!refsAreEmpty)||(!isEmpty&&!refsAreComplete))protocolError('ARCHIVE_PROTOCOL_REFERENCE_INVALID','Staging base revision and references must be either wholly empty or wholly populated.');
}

export function applyStagedChangesV1(tree:RootTreeV1,changes:readonly StagedChangeV1[]):Readonly<RootTreeV1>{
 const base=parseRootTreeV1(tree);const parsed=parseStagingManifestV1({schemaVersion:1,baseRevision:0,baseCommitId:null,baseRootTreeHash:null,changes}).changes;const entries=new Map<string,DocumentTreeEntryV1>(base.entries.map(e=>[e.path,e]));
 for(const change of parsed){if(change.op==='delete')entries.delete(change.path);else entries.set(change.path,{path:change.path,blobHash:change.sha256,mediaType:change.mediaType,bytes:change.bytes});}
 return createRootTreeV1([...entries.values()]);
}

export function buildCandidateTreeV1(input:{baseTree:RootTreeV1;staging:StagingManifestV1}):Readonly<RootTreeV1>{
 const base=parseRootTreeV1(input.baseTree);const staging=parseStagingManifestV1(input.staging);const actualHash=hashRootTreeV1(base);
 if(staging.baseRevision===0){if(base.entries.length!==0)protocolError('ARCHIVE_PROTOCOL_REFERENCE_INVALID','Initialization staging requires an empty base tree.');}
 else if(actualHash!==staging.baseRootTreeHash)protocolError('ARCHIVE_PROTOCOL_REFERENCE_INVALID','Staging baseRootTreeHash does not identify the supplied base tree.',{expected:staging.baseRootTreeHash,actual:actualHash});
 return applyStagedChangesV1(base,staging.changes);
}

/** @deprecated Use buildCandidateTreeV1 for transaction semantics. */
export function overlayRootTreeV1(base:RootTreeV1,staging:StagingManifestV1):Readonly<RootTreeV1>{return buildCandidateTreeV1({baseTree:base,staging});}
