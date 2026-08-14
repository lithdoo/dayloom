import type { ArchiveV2ReadResult, ArchiveV2Repository } from '../archive-v2';
import type { RuntimeOperations, RuntimeSessionBoundary } from '../runtime/types';
import type { WorldSnapshot } from '../types';
import { submissionDocuments } from './submission-documents';

const bytes=(text:string)=>new TextEncoder().encode(text);
export function createArchiveV2RuntimeOperations(options:{archive:ArchiveV2Repository}):RuntimeOperations {
  let activeWorldOperationId:string|null=null;
  const snapshot=(previous:WorldSnapshot,read:ArchiveV2ReadResult):WorldSnapshot=>{
    if(read.status!=='ready')throw read.status==='invalid'?read.error:new Error('Publication did not create a current World.');
    return {...previous,phase:read.commit.control.phase,worldId:read.manifest.worldId,revision:read.pointer.revision,commitId:read.pointer.commitId,day:read.commit.control.day,lastSettledDay:read.commit.control.lastSettledDay,initialized:true,invalid:null,invalidReason:null};
  };
  return {
    async prepareSessionStart(request):Promise<RuntimeSessionBoundary>{
      const record=await options.archive.createSession({kind:request.kind,operationType:request.kind});activeWorldOperationId=record.archiveOperationId;
      return {workspace:options.archive.sessionWorkspace(record.archiveOperationId),publish:async()=>({...request.target,revision:request.previous.revision,commitId:request.previous.commitId,initialized:request.previous.initialized}),abort:async(error)=>{await options.archive.abort(record.archiveOperationId,error.message);await options.archive.updateSessionStatus(record.archiveOperationId,'cancelled');activeWorldOperationId=null;}};
    },
    async submitSession(request){
      const session=await options.archive.readActiveSession(),id=session?.archiveOperationId??activeWorldOperationId;if(!id)throw new Error('No durable Session WorldOperation.');await options.archive.updateSessionStatus(id,'submitting');if(request.submission.kind==='init')await options.archive.stageManifest(id,{worldId:request.submission.world.id,title:request.submission.world.title});for(const document of submissionDocuments(request.submission))await options.archive.putDocument(id,document.path,bytes(document.text),document.mediaType);await options.archive.prepare(id,{phase:publishedPhase(request.target.phase),day:request.target.day,lastSettledDay:request.target.lastSettledDay});const result=snapshot(request.previous,await options.archive.publish(id));await options.archive.updateSessionStatus(id,'completed');activeWorldOperationId=null;return result;
    },
    async cancelSession(request){const session=await options.archive.readActiveSession(),id=session?.archiveOperationId??activeWorldOperationId;if(!id)throw new Error('No durable Session WorldOperation.');await options.archive.abort(id);await options.archive.updateSessionStatus(id,'cancelled');activeWorldOperationId=null;return {...request.target,revision:request.previous.revision,commitId:request.previous.commitId,initialized:request.previous.initialized,worldId:request.previous.worldId};},
    async executeStableCommand(request){const operation=await options.archive.beginWorldOperation({type:request.command,operationId:request.operationId});let day=request.target.day,lastSettledDay=request.target.lastSettledDay;if(request.command==='settle'&&request.previous.day){await options.archive.putDocument(operation.id,dayDocumentPath(request.previous.day,'settlement'),bytes(`# Settled ${request.previous.day}\n`),'text/markdown');lastSettledDay=request.previous.day;day=nextDay(request.previous.day);}if(request.command==='abandon-day'&&request.previous.day)await options.archive.putDocument(operation.id,dayDocumentPath(request.previous.day,'abandoned'),bytes(`# Abandoned ${request.previous.day}\n`),'text/markdown');await options.archive.prepare(operation.id,{phase:publishedPhase(request.target.phase),day,lastSettledDay});return snapshot(request.previous,await options.archive.publish(operation.id));},
  };
}
function publishedPhase(phase:WorldSnapshot['phase']):'idle'|'planned'|'awaiting-settle'{if(phase==='planned'||phase==='awaiting-settle')return phase;return'idle';}
import { dayDocumentPath } from '../archive-v2';
function nextDay(day:string):string{const match=/^day_(\d+)$/.exec(day);if(!match)throw new Error('Invalid current day.');return`day_${String(Number(match[1])+1).padStart(match[1].length,'0')}`;}
