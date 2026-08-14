import { createHash } from 'node:crypto';
import { parseBlobHashV1 } from './blob';
import { protocolError } from './errors';
import { parseArchiveMediaTypeV1, type ArchiveMediaTypeV1 } from './media';
import { deepFreeze, exactKeys, integer, record, schemaVersion } from './parse';
import { compareWorldDocumentPathsV1, parseWorldDocumentPathV1, portableCollisionKeyV1 } from './path';

export interface DocumentTreeEntryV1 { path:string; blobHash:string; mediaType:ArchiveMediaTypeV1; bytes:number }
export interface RootTreeV1 { schemaVersion:1; entries:DocumentTreeEntryV1[] }
export interface RootTreeDiffV1 { added:readonly DocumentTreeEntryV1[]; removed:readonly DocumentTreeEntryV1[]; changed:readonly {before:DocumentTreeEntryV1;after:DocumentTreeEntryV1}[] }

export function parseRootTreeV1(value:unknown):Readonly<RootTreeV1>{
  const o=record(value,'RootTreeV1','ARCHIVE_PROTOCOL_TREE_INVALID'); exactKeys(o,['schemaVersion','entries'],'RootTreeV1','ARCHIVE_PROTOCOL_TREE_INVALID'); schemaVersion(o.schemaVersion,1,'RootTreeV1');
  if(!Array.isArray(o.entries)) protocolError('ARCHIVE_PROTOCOL_TREE_INVALID','RootTreeV1.entries must be an array.');
  const entries=o.entries.map((item,index)=>parseEntry(item,index)); validateEntries(entries); return deepFreeze({schemaVersion:1,entries});
}
function parseEntry(value:unknown,index:number):DocumentTreeEntryV1{
  const s=`RootTreeV1.entries[${index}]`,o=record(value,s,'ARCHIVE_PROTOCOL_TREE_INVALID'); exactKeys(o,['path','blobHash','mediaType','bytes'],s,'ARCHIVE_PROTOCOL_TREE_INVALID');
  return {path:parseWorldDocumentPathV1(o.path),blobHash:parseBlobHashV1(o.blobHash,`${s}.blobHash`),mediaType:parseArchiveMediaTypeV1(o.mediaType),bytes:integer(o.bytes,s,'bytes',0,'ARCHIVE_PROTOCOL_TREE_INVALID')};
}
function validateEntries(entries:DocumentTreeEntryV1[]):void{
  const canonical=new Set<string>(),portable=new Set<string>(); let previous:string|undefined;
  for(const entry of entries){
    if(canonical.has(entry.path)) protocolError('ARCHIVE_PROTOCOL_TREE_INVALID','Root tree contains a duplicate path.',{path:entry.path}); canonical.add(entry.path);
    const key=portableCollisionKeyV1(entry.path); if(portable.has(key)) protocolError('ARCHIVE_PROTOCOL_PATH_COLLISION','Root tree contains a portable path collision.',{path:entry.path}); portable.add(key);
    if(previous!==undefined&&compareWorldDocumentPathsV1(previous,entry.path)>=0) protocolError('ARCHIVE_PROTOCOL_TREE_INVALID','Root tree entries are not in canonical order.',{path:entry.path}); previous=entry.path;
  }
}
export function createRootTreeV1(entries:readonly DocumentTreeEntryV1[]):Readonly<RootTreeV1>{
  const sorted=entries.map((entry)=>({...entry})).sort((a,b)=>compareWorldDocumentPathsV1(a.path,b.path)); return parseRootTreeV1({schemaVersion:1,entries:sorted});
}
export function encodeRootTreeCanonicalV1(tree:RootTreeV1):Uint8Array{
  const parsed=parseRootTreeV1(tree); const entries=parsed.entries.map(({path,blobHash,mediaType,bytes})=>({path,blobHash,mediaType,bytes})); return new TextEncoder().encode(JSON.stringify({schemaVersion:1,entries})+'\n');
}
export function hashRootTreeV1(tree:RootTreeV1):string{return createHash('sha256').update(encodeRootTreeCanonicalV1(tree)).digest('hex');}
export function diffRootTreesV1(a:RootTreeV1,b:RootTreeV1):Readonly<RootTreeDiffV1>{
  const left=parseRootTreeV1(a),right=parseRootTreeV1(b),lm=new Map(left.entries.map(e=>[e.path,e])),rm=new Map(right.entries.map(e=>[e.path,e])); const added:DocumentTreeEntryV1[]=[],removed:DocumentTreeEntryV1[]=[],changed:{before:DocumentTreeEntryV1;after:DocumentTreeEntryV1}[]=[];
  for(const [path,entry] of rm) { const before=lm.get(path); if(!before) added.push(entry); else if(before.blobHash!==entry.blobHash||before.mediaType!==entry.mediaType||before.bytes!==entry.bytes) changed.push({before,after:entry}); }
  for(const [path,entry] of lm) if(!rm.has(path)) removed.push(entry); return deepFreeze({added,removed,changed});
}
