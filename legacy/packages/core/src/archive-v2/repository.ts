import path from 'node:path';
import {
  ArchiveProtocolError,
  buildCandidateTreeV1,
  classifyOperationRecoveryV2,
  compareWorldDocumentPathsV1,
  createRootTreeV1,
  encodeRootTreeCanonicalV1,
  hashBlobV1,
  hashRootTreeV1,
  normalizeWorldDocumentPathV1,
  parseArchiveCommitV2,
  parseArchiveManifestV2,
  parseArchiveMediaTypeV1,
  parseArchiveOperationV2,
  parseCurrentPointerV2,
  parseRootTreeV1,
  parseStagingManifestV1,
  validateCommitParentRelationV2,
  validateContentV1,
  validateCurrentCommitRelationV2,
  validateOperationStagingRelationV2,
  validatePreparedTargetRelationV2,
  verifyBlobV1,
  type ArchiveCommitV2,
  type ArchiveMediaTypeV1,
  type ArchiveOperationV2,
  type CurrentPointerV2,
  type RootTreeV1,
  type StagedChangeV1,
  type StagingManifestV1,
} from '@dayloom/archive-protocol';
import { createRuntimeError } from '../errors';
import { systemClock } from '../infrastructure/clock';
import { createSystemIdGenerator, prefixedId } from '../infrastructure/ids';
import { noopCoreLogger } from '../infrastructure/logger';
import { createNodeCoreFileSystem } from '../infrastructure/node-filesystem';
import { encodeJson, writeAtomicBytes, writeAtomicText } from '../archive/atomic-file';
import { acquirePublishLock } from '../archive/publish-lock';
import { ArchiveV2Paths } from './paths';
import { assertDayloomMutationAllowed } from './profile';
import { ArchiveSessionWorkspace } from '../archive/session-workspace';
import type {
  ArchiveV2Inspection, ArchiveV2ReadResult, ArchiveV2Repository, ArchiveV2RepositoryOptions,
  CoreSessionRecordV1, CoreSessionStatusV1, PrepareWorldOperationV2,
} from './types';

export class FileArchiveV2Repository implements ArchiveV2Repository {
  private readonly filesystem; private readonly clock; private readonly ids; private readonly logger;
  private readonly paths: ArchiveV2Paths; private readonly lockStaleAfterMs: number;
  constructor(options: ArchiveV2RepositoryOptions) {
    this.filesystem=options.filesystem??createNodeCoreFileSystem();this.clock=options.clock??systemClock;this.ids=options.ids??createSystemIdGenerator();this.logger=options.logger??noopCoreLogger;this.paths=new ArchiveV2Paths(options.worldRoot);this.lockStaleAfterMs=options.lockStaleAfterMs??30_000;
  }

  async readCurrent(): Promise<ArchiveV2ReadResult> {
    try {
      const hasManifest=await this.filesystem.exists(this.paths.manifest()),hasCurrent=await this.filesystem.exists(this.paths.current());
      if(!hasCurrent){const manifest=hasManifest?parseArchiveManifestV2(await this.readJson(this.paths.manifest())):null;return{status:'uninitialized',manifest};}
      if(!hasManifest)throw new Error('current.json requires manifest.json.');
      const manifest=parseArchiveManifestV2(await this.readJson(this.paths.manifest()));const pointer=parseCurrentPointerV2(await this.readJson(this.paths.current()));const commit=await this.readCommit(pointer.commitId);validateCurrentCommitRelationV2({current:pointer,commit});
      const tree=await this.readTree(commit.rootTreeHash);const parent=commit.parentCommitId===null?null:await this.readCommit(commit.parentCommitId);validateCommitParentRelationV2({child:commit,parent});
      for(const entry of tree.entries){const bytes=await this.requireBytes(this.paths.blob(entry.blobHash));verifyBlobV1(bytes,entry.blobHash,entry.bytes);validateContentV1(bytes,entry.mediaType,entry.bytes);}
      const result={status:'ready' as const,manifest,pointer,commit,tree};try{await this.reconcilePublished(pointer,commit);}catch(error){this.logger.error('Published diagnostic reconciliation failed.',error,{operationId:commit.operationId});}return result;
    } catch(error){return{status:'invalid',error:this.asError(error)};}
  }

  async readPublishedDocument(rawPath:string):Promise<Uint8Array|null>{const canonical=normalizeWorldDocumentPathV1(rawPath),current=await this.requireReady();const entry=current.tree.entries.find(e=>e.path===canonical);return entry?this.requireBytes(this.paths.blob(entry.blobHash)):null;}
  async listPublishedDocuments(){return(await this.requireReady()).tree.entries;}

  async beginWorldOperation(input:{type:string;operationId?:string}){
    const id=input.operationId??this.ids.nextOperationId();return this.withOperationLock(id,async()=>{const current=await this.readCurrent();if(current.status==='invalid')throw current.error;if(await this.filesystem.exists(this.paths.operationMeta(id)))throw createRuntimeError('ARCHIVE_CONFLICT','World operation id already exists.',{operationId:id});
    await this.assertPhysicalPath(this.paths.operation(id));const now=this.clock.now().toISOString(),base=current.status==='ready'?current:null;const operation=parseArchiveOperationV2({schemaVersion:2,id,type:input.type,status:'open',baseRevision:base?.pointer.revision??0,baseCommitId:base?.commit.id??null,baseRootTreeHash:base?.tree?hashRootTreeV1(base.tree):null,targetCommitId:null,targetRootTreeHash:null,createdAt:now,updatedAt:now,lastError:null});
    const staging=parseStagingManifestV1({schemaVersion:1,baseRevision:operation.baseRevision,baseCommitId:operation.baseCommitId,baseRootTreeHash:operation.baseRootTreeHash,changes:[]});await this.filesystem.makeDirectory(this.paths.stagingFiles(id));await this.atomicJson(this.paths.stagingIndex(id),staging,id);await this.atomicJson(this.paths.operationMeta(id),operation,id);return operation;});
  }
  async readOperation(id:string){return parseArchiveOperationV2(await this.readJson(this.paths.operationMeta(id)));}
  async stageManifest(id:string,manifest:{worldId:string;title:string}){return this.withOperationLock(id,async()=>{const operation=await this.requireOpen(id);if(operation.baseRevision!==0)throw new Error('Manifest can only be staged for initialization.');const value=parseArchiveManifestV2({schemaVersion:2,...manifest,createdAt:operation.createdAt});await this.atomicJson(this.paths.stagedManifest(id),value,id);});}
  async inspectStaging(id:string){return parseStagingManifestV1(await this.readJson(this.paths.stagingIndex(id)));}

  async putDocument(id:string,rawPath:string,bytes:Uint8Array,mediaType:ArchiveMediaTypeV1){return this.withOperationLock(id,async()=>{
    const operation=await this.requireOpen(id),current=await this.readCurrent(),published=new Set(current.status==='ready'?current.tree.entries.map(e=>e.path):[]);const documentPath=assertDayloomMutationAllowed(rawPath,published,operation.type);const media=parseArchiveMediaTypeV1(mediaType);validateContentV1(bytes,media);const hash=hashBlobV1(bytes),fileId=prefixedId('file_',hash);const target=this.paths.stagingFile(id,fileId),temporary=`${target}.tmp-${id}`;await this.assertPhysicalPath(target);await this.assertPhysicalPath(temporary);if(await this.filesystem.exists(target))verifyBlobV1(await this.filesystem.readBytes(target),hash,bytes.byteLength);else await writeAtomicBytes(this.filesystem,target,temporary,bytes);
    return this.replaceChange(id,{op:'put',path:documentPath,mediaType:media,bytes:bytes.byteLength,sha256:hash,fileId});
  });}
  async deleteDocument(id:string,rawPath:string){return this.withOperationLock(id,async()=>{const operation=await this.requireOpen(id),current=await this.readCurrent(),published=new Set(current.status==='ready'?current.tree.entries.map(e=>e.path):[]);return this.replaceChange(id,{op:'delete',path:assertDayloomMutationAllowed(rawPath,published,operation.type)});});}
  async readEffectiveDocument(id:string,rawPath:string){const canonical=normalizeWorldDocumentPathV1(rawPath),staging=await this.inspectStaging(id),change=staging.changes.find(c=>c.path===canonical);if(change?.op==='delete')return null;if(change?.op==='put')return this.requireBytes(this.paths.stagingFile(id,change.fileId));const base=await this.loadBaseTree(staging),entry=base.entries.find(e=>e.path===canonical);return entry?this.requireBytes(this.paths.blob(entry.blobHash)):null;}
  async listEffectiveDocuments(id:string){const staging=await this.inspectStaging(id),base=await this.loadBaseTree(staging);return buildCandidateTreeV1({baseTree:base,staging}).entries;}

  async prepare(id:string,control:PrepareWorldOperationV2){return this.withOperationLock(id,async()=>{
    const operation=await this.requireOpen(id),staging=await this.inspectStaging(id);validateOperationStagingRelationV2({operation,staging});for(const change of staging.changes)if(change.op==='put'){const bytes=await this.requireBytes(this.paths.stagingFile(id,change.fileId));verifyBlobV1(bytes,change.sha256,change.bytes);validateContentV1(bytes,change.mediaType,change.bytes);await this.writeImmutable(this.paths.blob(change.sha256),bytes,id);}
    const candidate=buildCandidateTreeV1({baseTree:await this.loadBaseTree(staging),staging}),treeHash=hashRootTreeV1(candidate);await this.writeImmutable(this.paths.tree(treeHash),encodeRootTreeCanonicalV1(candidate),id);const now=operation.createdAt;const commitIdentity=hashBlobV1(Buffer.from(JSON.stringify({operationId:id,revision:operation.baseRevision+1,parentCommitId:operation.baseCommitId,rootTreeHash:treeHash,control})));const commitId=prefixedId('commit_',commitIdentity);const commit=parseArchiveCommitV2({schemaVersion:2,id:commitId,revision:operation.baseRevision+1,parentCommitId:operation.baseCommitId,operationId:id,createdAt:now,rootTreeHash:treeHash,control});await this.writeImmutable(this.paths.commit(commitId),Buffer.from(encodeJson(commit)),id);
    const finalStaging=await this.filesystem.readText(this.paths.stagingIndex(id));if(finalStaging!==encodeJson(staging))throw createRuntimeError('ARCHIVE_CONFLICT','Staging changed while preparing.');const prepared=parseArchiveOperationV2({...operation,status:'prepared',targetCommitId:commitId,targetRootTreeHash:treeHash,updatedAt:this.clock.now().toISOString()});validatePreparedTargetRelationV2({operation:prepared,targetCommit:commit,candidateTree:candidate});await this.atomicJson(this.paths.operationMeta(id),prepared,id);return prepared;
  });}

  async publish(id:string):Promise<ArchiveV2ReadResult>{
    const operation=await this.readOperation(id);if(operation.status!=='prepared')throw new Error('Only a prepared operation can publish.');const lock=await acquirePublishLock({filesystem:this.filesystem,lockPath:this.paths.publishLock(),clock:this.clock,staleAfterMs:this.lockStaleAfterMs});
    try{const current=await this.readCurrent();if(current.status==='invalid')throw current.error;if((current.status==='ready'&&(current.pointer.revision!==operation.baseRevision||current.pointer.commitId!==operation.baseCommitId))||(current.status==='uninitialized'&&(operation.baseRevision!==0||operation.baseCommitId!==null)))throw createRuntimeError('ARCHIVE_CONFLICT','World operation base is no longer current.');const commit=await this.readCommit(operation.targetCommitId!);const tree=await this.readTree(operation.targetRootTreeHash!);validatePreparedTargetRelationV2({operation,targetCommit:commit,candidateTree:tree});await this.verifyTreeBlobs(tree);
      if(current.status==='uninitialized')await this.ensureManifest(id);const pointer=parseCurrentPointerV2({schemaVersion:2,revision:commit.revision,commitId:commit.id,updatedAt:this.clock.now().toISOString()});await this.atomicJson(this.paths.current(),pointer,id);try{await this.reconcilePublished(pointer,commit);}catch(error){this.logger.error('Published operation reconciliation failed.',error,{operationId:id});}return this.readCurrent();
    }finally{try{await lock.release();}catch(error){this.logger.error('Publish lock release failed.',error);}}
  }
  async abort(id:string,message='World operation aborted.'){const operation=await this.readOperation(id);if(operation.status==='published')throw new Error('Published operation cannot be aborted.');const aborted=parseArchiveOperationV2({...operation,status:'aborted',targetCommitId:operation.targetCommitId,targetRootTreeHash:operation.targetRootTreeHash,updatedAt:this.clock.now().toISOString(),lastError:{source:'runtime',code:'OPERATION_FAILED',message}});await this.atomicJson(this.paths.operationMeta(id),aborted,id);return aborted;}

  async createSession(input:{sessionId?:string;kind:'init'|'planning'|'play'|'revise';operationType?:string}){const lock=await acquirePublishLock({filesystem:this.filesystem,lockPath:this.paths.sessionLock(),clock:this.clock,staleAfterMs:this.lockStaleAfterMs});try{if(await this.readActiveSession())throw createRuntimeError('SESSION_ALREADY_ACTIVE','A durable Session is already active.');const operation=await this.beginWorldOperation({type:input.operationType??input.kind});const now=this.clock.now().toISOString();const record=this.parseSession({schemaVersion:1,sessionId:input.sessionId??this.ids.nextSessionId(),kind:input.kind,archiveOperationId:operation.id,status:'active',createdAt:now,updatedAt:now});await this.atomicJson(this.paths.session(operation.id),record,operation.id);return record;}finally{await lock.release();}}
  async readActiveSession(){const active:Readonly<CoreSessionRecordV1>[]=[];for(const id of await this.safeList(this.paths.operations())){const target=this.paths.session(id);if(!await this.filesystem.exists(target))continue;const session=this.parseSession(await this.readJson(target));if(session.archiveOperationId!==id)throw createRuntimeError('ARCHIVE_REFERENCE_INVALID','Session operation reference mismatch.');if(session.status==='active'||session.status==='submitting')active.push(session);}if(active.length>1)throw createRuntimeError('ARCHIVE_REFERENCE_INVALID','Multiple durable active Sessions exist.');return active[0]??null;}
  async updateSessionStatus(id:string,status:CoreSessionStatusV1){const operation=await this.readOperation(id),target=this.paths.session(id),current=this.parseSession(await this.readJson(target));const next=this.parseSession({...current,status,updatedAt:this.clock.now().toISOString()});await this.atomicJson(target,next,operation.id);return next;}
  sessionWorkspace(id:string){return new ArchiveSessionWorkspace(this.filesystem,this.paths.workspace(id),this.paths.root);}
  async reconcileSessions(){const current=await this.readCurrent();for(const id of await this.safeList(this.paths.operations())){const target=this.paths.session(id);if(!await this.filesystem.exists(target))continue;const session=this.parseSession(await this.readJson(target));if(session.archiveOperationId!==id)throw createRuntimeError('ARCHIVE_REFERENCE_INVALID','Session operation reference mismatch.');if(session.status!=='active'&&session.status!=='submitting')continue;const operation=await this.readOperation(id);if(current.status==='ready'&&operation.targetCommitId===current.pointer.commitId)await this.updateSessionStatus(id,'completed');else await this.updateSessionStatus(id,'interrupted');}}

  async inspect():Promise<ArchiveV2Inspection>{
    const current=await this.readCurrent(),operations:Array<ArchiveV2Inspection['operations'][number]>=[],publishedCommits=new Set<string>(),preparedCommits=new Set<string>(),trees=new Set<string>(),blobs=new Set<string>();
    if(current.status==='ready'){
      let commit:Readonly<ArchiveCommitV2>|null=current.commit;
      while(commit){
        publishedCommits.add(commit.id);trees.add(commit.rootTreeHash);
        const tree=await this.readTree(commit.rootTreeHash);await this.verifyTreeBlobs(tree);for(const e of tree.entries)blobs.add(e.blobHash);
        const parent:Readonly<ArchiveCommitV2>|null=commit.parentCommitId?await this.readCommit(commit.parentCommitId):null;validateCommitParentRelationV2({child:commit,parent});commit=parent;
      }
    }
    for(const id of await this.safeList(this.paths.operations())){
      try{
        const operation=await this.readOperation(id),sessionPath=this.paths.session(id);
        if(await this.filesystem.exists(sessionPath)){const session=this.parseSession(await this.readJson(sessionPath));if(session.archiveOperationId!==id)throw new Error('Session operation reference mismatch.');}
        if(operation.status==='prepared'&&operation.targetCommitId&&operation.targetRootTreeHash){
          const commit=await this.readCommit(operation.targetCommitId),tree=await this.readTree(operation.targetRootTreeHash);validatePreparedTargetRelationV2({operation,targetCommit:commit,candidateTree:tree});await this.verifyTreeBlobs(tree);
          preparedCommits.add(operation.targetCommitId);trees.add(operation.targetRootTreeHash);for(const e of tree.entries)blobs.add(e.blobHash);
        }
        operations.push({id,operation,error:null});
      }catch(error){operations.push({id,operation:null,error:this.asError(error)});}
    }
    const commitIds=(await this.safeList(this.paths.commits())).filter(x=>x.endsWith('.json')).map(x=>x.slice(0,-5)),treeIds=(await this.safeList(this.paths.trees())).filter(x=>x.endsWith('.json')).map(x=>x.slice(0,-5)),blobIds=await this.safeList(this.paths.blobs());return{current,operations,publishedCommits:[...publishedCommits].sort(),preparedCommits:[...preparedCommits].sort(),reachableTrees:[...trees].sort(),reachableBlobs:[...blobs].sort(),orphanCommits:commitIds.filter(x=>!publishedCommits.has(x)&&!preparedCommits.has(x)).sort(),orphanTrees:treeIds.filter(x=>!trees.has(x)).sort(),orphanBlobs:blobIds.filter(x=>!blobs.has(x)).sort()};
  }
  async collectGarbage(options:{delete?:boolean}={}){const candidatesFrom=(inspection:ArchiveV2Inspection)=>[...inspection.orphanCommits.map(x=>path.relative(this.paths.root,this.paths.commit(x))),...inspection.orphanTrees.map(x=>path.relative(this.paths.root,this.paths.tree(x))),...inspection.orphanBlobs.map(x=>path.relative(this.paths.root,this.paths.blob(x)))].sort();if(!options.delete)return{candidates:candidatesFrom(await this.inspect()),deleted:[]};const lock=await acquirePublishLock({filesystem:this.filesystem,lockPath:this.paths.publishLock(),clock:this.clock,staleAfterMs:this.lockStaleAfterMs});try{const inspection=await this.inspect();if(inspection.current.status==='invalid'||inspection.operations.some(entry=>entry.error))throw createRuntimeError('ARCHIVE_REFERENCE_INVALID','GC refuses deletion while Archive diagnostics contain errors.');const candidates=candidatesFrom(inspection),deleted:string[]=[];for(const item of candidates){await this.filesystem.remove(path.join(this.paths.root,item));deleted.push(item);}return{candidates,deleted};}finally{await lock.release();}}

  private async replaceChange(id:string,change:StagedChangeV1){await this.requireOpen(id);const current=await this.inspectStaging(id),changes=current.changes.filter(c=>c.path!==change.path).concat(change).sort((a,b)=>compareWorldDocumentPathsV1(a.path,b.path));const next=parseStagingManifestV1({...current,changes});await this.atomicJson(this.paths.stagingIndex(id),next,id);return next;}
  private async requireOpen(id:string){const operation=await this.readOperation(id);if(operation.status!=='open')throw new Error('Operation staging is frozen.');return operation;}
  private async requireReady(){const current=await this.readCurrent();if(current.status!=='ready')throw current.status==='invalid'?current.error:new Error('World is uninitialized.');return current;}
  private async loadBaseTree(staging:Readonly<StagingManifestV1>):Promise<Readonly<RootTreeV1>>{return staging.baseRevision===0?createRootTreeV1([]):this.readTree(staging.baseRootTreeHash!);}
  private async readCommit(id:string){const commit=parseArchiveCommitV2(await this.readJson(this.paths.commit(id)));if(commit.id!==id)throw new Error('Commit path identity mismatch.');return commit;}
  private async readTree(hash:string){const bytes=await this.requireBytes(this.paths.tree(hash)),tree=parseRootTreeV1(JSON.parse(new TextDecoder().decode(bytes)));if(hashRootTreeV1(tree)!==hash)throw new Error('Tree path identity mismatch.');return tree;}
  private async ensureManifest(id:string){const staged=this.paths.stagedManifest(id);if(!await this.filesystem.exists(staged))throw new Error('Initialization requires a staged manifest.');const expected=parseArchiveManifestV2(await this.readJson(staged)),bytes=Buffer.from(encodeJson(expected));await this.writeImmutable(this.paths.manifest(),bytes,id);const actual=parseArchiveManifestV2(await this.readJson(this.paths.manifest()));if(actual.worldId!==expected.worldId||actual.title!==expected.title||actual.createdAt!==expected.createdAt)throw createRuntimeError('ARCHIVE_CONFLICT','Archive manifest identity conflict.');}
  private async reconcilePublished(pointer:Readonly<CurrentPointerV2>,commit:Readonly<ArchiveCommitV2>){const target=this.paths.operationMeta(commit.operationId);if(!await this.filesystem.exists(target))return;const operation=await this.readOperation(commit.operationId);if(operation.status==='published')return;if(classifyOperationRecoveryV2({operation,current:pointer})!=='already-published')return;const published=parseArchiveOperationV2({...operation,status:'published',updatedAt:pointer.updatedAt,lastError:null});await this.atomicJson(target,published,operation.id);}
  private async writeImmutable(target:string,bytes:Uint8Array,id:string){await this.assertPhysicalPath(target);if(await this.filesystem.exists(target)){const existing=await this.filesystem.readBytes(target);if(!Buffer.from(existing).equals(Buffer.from(bytes)))throw createRuntimeError('ARCHIVE_CONFLICT','Immutable object identity collision.');return;}const temporary=`${target}.tmp-${id}`;await this.assertPhysicalPath(temporary);await this.filesystem.writeBytes(temporary,bytes,{overwrite:true,flush:true});try{await this.filesystem.link(temporary,target);await this.filesystem.syncDirectory(path.dirname(target));}catch(error){if(!(error instanceof Error&&'code'in error&&(error as NodeJS.ErrnoException).code==='EEXIST'))throw error;const existing=await this.filesystem.readBytes(target);if(!Buffer.from(existing).equals(Buffer.from(bytes)))throw createRuntimeError('ARCHIVE_CONFLICT','Immutable object identity collision.');}finally{await this.filesystem.remove(temporary);}}
  private async verifyTreeBlobs(tree:Readonly<RootTreeV1>){for(const entry of tree.entries){const bytes=await this.requireBytes(this.paths.blob(entry.blobHash));verifyBlobV1(bytes,entry.blobHash,entry.bytes);validateContentV1(bytes,entry.mediaType,entry.bytes);}}
  private async withOperationLock<T>(id:string,action:()=>Promise<T>):Promise<T>{const lock=await acquirePublishLock({filesystem:this.filesystem,lockPath:this.paths.operationLock(id),clock:this.clock,staleAfterMs:this.lockStaleAfterMs});try{return await action();}finally{await lock.release();}}
  private async atomicJson(target:string,value:unknown,id:string){const temporary=`${target}.tmp-${id}`;await this.assertPhysicalPath(target);await this.assertPhysicalPath(temporary);await writeAtomicText(this.filesystem,target,temporary,encodeJson(value));}
  private async readJson(target:string){await this.assertPhysicalPath(target);return JSON.parse(await this.filesystem.readText(target)) as unknown;}
  private async requireBytes(target:string){await this.assertPhysicalPath(target);if(!await this.filesystem.exists(target))throw new Error(`Archive object is missing: ${path.relative(this.paths.root,target)}`);return this.filesystem.readBytes(target);}
  private async safeList(target:string){await this.assertPhysicalPath(target);return this.filesystem.listDirectory(target);}
  private async assertPhysicalPath(target:string){
    await this.filesystem.makeDirectory(this.paths.root);const root=await this.filesystem.realPath(this.paths.root);let existing=target;
    while(!await this.filesystem.exists(existing)){const parent=path.dirname(existing);if(parent===existing)throw new Error('Archive path has no existing ancestor.');existing=parent;}
    const physical=await this.filesystem.realPath(existing),relative=path.relative(root,physical);
    if(relative==='..'||relative.startsWith(`..${path.sep}`)||path.isAbsolute(relative))throw createRuntimeError('ARCHIVE_REFERENCE_INVALID','Archive path resolves outside the world root.');
  }
  private parseSession(value:unknown):Readonly<CoreSessionRecordV1>{if(typeof value!=='object'||value===null)throw new Error('Invalid CoreSessionRecordV1.');const v=value as Record<string,unknown>;if(v.schemaVersion!==1||typeof v.sessionId!=='string'||!['init','planning','play','revise'].includes(String(v.kind))||typeof v.archiveOperationId!=='string'||!['active','submitting','completed','cancelled','interrupted'].includes(String(v.status))||typeof v.createdAt!=='string'||typeof v.updatedAt!=='string')throw new Error('Invalid CoreSessionRecordV1.');return Object.freeze(value as CoreSessionRecordV1);}
  private asError(error:unknown){return error instanceof Error?error:new Error(String(error));}
}
export function createArchiveV2Repository(options:ArchiveV2RepositoryOptions):ArchiveV2Repository{return new FileArchiveV2Repository(options);}
