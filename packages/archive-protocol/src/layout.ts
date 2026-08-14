import { parseBlobHashV1 } from './blob';import { stableId } from './parse';
export const ARCHIVE_LAYOUT_V2=Object.freeze({manifest:'manifest.json',current:'current.json',commits:'commits/',trees:'objects/trees/sha256/',blobs:'objects/blobs/sha256/',operations:'operations/',locks:'.locks/',logs:'logs/'});
export function formatCommitObjectPathV2(id:string):string{return`commits/${stableId(id,'layout','id')}.json`}
export function formatTreeObjectPathV1(hash:string):string{return`objects/trees/sha256/${parseBlobHashV1(hash)}.json`}
export function formatBlobObjectPathV1(hash:string):string{return`objects/blobs/sha256/${parseBlobHashV1(hash)}`}
export function formatOperationPathV2(id:string):string{return`operations/${stableId(id,'layout','id')}/operation.json`}
