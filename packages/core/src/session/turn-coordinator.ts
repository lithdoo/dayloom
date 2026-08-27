import { randomUUID } from 'node:crypto';
import { compareAndSwapAggregateHeadV1, type AggregateHeadV1 } from './aggregate-head';
import type { MarkdownDraftSnapshotV2 } from './markdown-draft-snapshot';
import type { PreparedConversationRevisionV1 } from './conversation-revision';
import type { OperationDispositionV1, TurnAuditV1, TurnVerdictV1 } from './turn-record';
import type { ValidationIssueV1 } from './diagnostics';

export type OperationKindV1='response'|'arbitration'|'draft-curation'|'submission-conversion'|'submission-repair'|'submission-review';
export type OperationStageV1='thought'|'observe'|'check'|'final'|'verify'|'materialize'|'validate'|'publish';
export type TurnTerminalStatusV1=Exclude<TurnAuditV1['terminalStatus'],null>;
export type CoreOperationEventV2=
 |{type:'operation.started';sessionId:string;turnId:string|null;operationId:string;groupId:string;kind:OperationKindV1;attempt:number}
 |{type:'operation.stage';sessionId:string;turnId:string|null;operationId:string;stage:OperationStageV1}
 |{type:'operation.delta';sessionId:string;turnId:string|null;operationId:string;channel:'thought'|'observe'|'check'|'response';text:string}
 |{type:'operation.diagnostics';sessionId:string;turnId:string|null;operationId:string;items:readonly ValidationIssueV1[]}
 |{type:'operation.produced';sessionId:string;turnId:string|null;operationId:string;artifactId:string}
 |{type:'operation.finished';sessionId:string;turnId:string|null;operationId:string;disposition:OperationDispositionV1;message?:string}
 |{type:'turn.commit';sessionId:string;turnId:string;commit:'response'|'draft';headRevision:number}
 |{type:'turn.terminal';sessionId:string;turnId:string;status:TurnTerminalStatusV1};

export interface ProducedResponseV1{generationId:string;operationId:string;responseText:string;stagedConversationRoot:string}
export interface ProducedCurationV1{operationId:string;snapshot:Readonly<MarkdownDraftSnapshotV2>}
export interface TurnCoordinatorEffectsV1{
 generate(operationId:string,attempt:1|2,repairConstraint:string|null):Promise<ProducedResponseV1>;
 arbitrate(operationId:string,response:ProducedResponseV1,attempt:1|2):Promise<{operationId:string;verdict:TurnVerdictV1}>;
 prepareConversation(response:ProducedResponseV1):Promise<PreparedConversationRevisionV1>;
 discardResponse(response:ProducedResponseV1):Promise<void>;
 curate(operationId:string,input:{turnId:string;accepted:ProducedResponseV1;baseDraftHash:string;attempt:1|2}):Promise<ProducedCurationV1>;
 persist(record:Readonly<TurnAuditV1>):Promise<void>;
 emit(event:CoreOperationEventV2):void;
 cancelled():boolean;
}
export interface RunTurnCoordinatorInputV1{slotRoot:string;sessionId:string;userInput:string;base:Readonly<AggregateHeadV1>;effects:TurnCoordinatorEffectsV1}
export interface RunTurnCoordinatorResultV1{status:TurnTerminalStatusV1;head:Readonly<AggregateHeadV1>;record:Readonly<TurnAuditV1>}

export async function runTurnCoordinatorV1(input:RunTurnCoordinatorInputV1):Promise<RunTurnCoordinatorResultV1>{
 const turnId=`turn_${randomUUID().replaceAll('-','')}`,groupId=turnId,e=input.effects;let head=input.base;
 const record:TurnAuditV1={schemaVersion:1,turnId,sessionId:input.sessionId,userInput:input.userInput,baseConversationId:input.base.activeSession!.conversationId,baseDraftHash:input.base.draftHash,generationAttempts:[],acceptedGenerationId:null,draftVerdict:null,resultDraftHash:null,curationAttempts:[],terminalStatus:null};
 const terminal=async(status:TurnTerminalStatusV1)=>{record.terminalStatus=status;await e.persist(record);e.emit({type:'turn.terminal',sessionId:input.sessionId,turnId,status});return Object.freeze({status,head,record:Object.freeze(record)});};
 let repair:string|null=null;
 for(let n=1;n<=2;n++){const attempt=n as 1|2,responseOp=`op_${randomUUID().replaceAll('-','')}`;e.emit({type:'operation.started',sessionId:input.sessionId,turnId,operationId:responseOp,groupId,kind:'response',attempt});let response:ProducedResponseV1;
  try{response=await e.generate(responseOp,attempt,repair);if(response.operationId!==responseOp)throw new Error('Response operation identity mismatch.');if(Buffer.byteLength(response.responseText)>1024*1024)throw new Error('Response exceeds 1 MiB.');e.emit({type:'operation.produced',sessionId:input.sessionId,turnId,operationId:responseOp,artifactId:response.generationId});}
  catch(error){e.emit({type:'operation.finished',sessionId:input.sessionId,turnId,operationId:responseOp,disposition:e.cancelled()?'cancelled':'failed',message:message(error)});return terminal(e.cancelled()?'cancelled':'failed');}
  const generation={generationId:response.generationId,operationId:responseOp,attempt,responseText:response.responseText,complete:true,disposition:'discarded' as OperationDispositionV1,verdict:null as TurnVerdictV1|null};record.generationAttempts.push(generation);await e.persist(record);
  if(e.cancelled()){generation.disposition='cancelled';await discard(e,response);e.emit({type:'operation.finished',sessionId:input.sessionId,turnId,operationId:responseOp,disposition:'cancelled'});return terminal('cancelled');}
  const arbOp=`op_${randomUUID().replaceAll('-','')}`;e.emit({type:'operation.started',sessionId:input.sessionId,turnId,operationId:arbOp,groupId,kind:'arbitration',attempt});let verdict:TurnVerdictV1;
  try{const result=await e.arbitrate(arbOp,response,attempt);if(result.operationId!==arbOp)throw new Error('Arbitration operation identity mismatch.');verdict=result.verdict;e.emit({type:'operation.produced',sessionId:input.sessionId,turnId,operationId:arbOp,artifactId:`verdict_${turnId}_${attempt}`});e.emit({type:'operation.finished',sessionId:input.sessionId,turnId,operationId:arbOp,disposition:'committed'});}
  catch(error){e.emit({type:'operation.finished',sessionId:input.sessionId,turnId,operationId:arbOp,disposition:'failed',message:message(error)});generation.disposition=e.cancelled()?'cancelled':'discarded';await discard(e,response);e.emit({type:'operation.finished',sessionId:input.sessionId,turnId,operationId:responseOp,disposition:generation.disposition});return terminal(e.cancelled()?'cancelled':'failed');}
  generation.verdict=verdict;await e.persist(record);
  if(verdict.response.verdict==='REJECT'){generation.disposition='superseded';await discard(e,response);e.emit({type:'operation.finished',sessionId:input.sessionId,turnId,operationId:responseOp,disposition:'superseded'});repair=`${verdict.response.code}: ${verdict.response.evidence}`;if(attempt===2)return terminal('policy-rejected');continue;}
  if(e.cancelled()){generation.disposition='cancelled';await discard(e,response);e.emit({type:'operation.finished',sessionId:input.sessionId,turnId,operationId:responseOp,disposition:'cancelled'});return terminal('cancelled');}
  if(verdict.draft.verdict==='DEFER')throw new Error('Accepted response cannot defer its Draft verdict.');let prepared:PreparedConversationRevisionV1;try{prepared=await e.prepareConversation(response);}catch(error){await discard(e,response);generation.disposition='discarded';e.emit({type:'operation.finished',sessionId:input.sessionId,turnId,operationId:responseOp,disposition:'discarded',message:message(error)});return terminal('failed');}const draftVerdict=verdict.draft.verdict,nextA:AggregateHeadV1={schemaVersion:1,revision:head.revision+1,draftHash:head.draftHash,activeSession:{sessionId:input.sessionId,conversationId:prepared.conversationId,pendingDraftSync:draftVerdict==='UPDATE'?{turnId,acceptedGenerationId:response.generationId,baseDraftHash:head.draftHash,verdict:'UPDATE'}:null}};
  try{head=await compareAndSwapAggregateHeadV1({slotRoot:input.slotRoot,expectedRevision:head.revision,next:nextA});}catch(error){await prepared.rollback();await discard(e,response);generation.disposition='discarded';e.emit({type:'operation.finished',sessionId:input.sessionId,turnId,operationId:responseOp,disposition:'discarded',message:message(error)});return terminal('failed');}await prepared.commit();await discard(e,response);
  record.acceptedGenerationId=response.generationId;record.draftVerdict=draftVerdict;generation.disposition='committed';await e.persist(record);e.emit({type:'turn.commit',sessionId:input.sessionId,turnId,commit:'response',headRevision:head.revision});e.emit({type:'operation.finished',sessionId:input.sessionId,turnId,operationId:responseOp,disposition:'committed'});
  if(draftVerdict==='KEEP')return terminal('committed');
  const curateOp=`op_${randomUUID().replaceAll('-','')}`;e.emit({type:'operation.started',sessionId:input.sessionId,turnId,operationId:curateOp,groupId,kind:'draft-curation',attempt:1});
  try{const curated=await e.curate(curateOp,{turnId,accepted:response,baseDraftHash:record.baseDraftHash,attempt:1});if(curated.operationId!==curateOp)throw new Error('Curation operation identity mismatch.');e.emit({type:'operation.produced',sessionId:input.sessionId,turnId,operationId:curateOp,artifactId:curated.snapshot.hash});if(e.cancelled())throw new Error('cancelled');const nextB:AggregateHeadV1={schemaVersion:1,revision:head.revision+1,draftHash:curated.snapshot.hash,activeSession:{sessionId:input.sessionId,conversationId:prepared.conversationId,pendingDraftSync:null}};head=await compareAndSwapAggregateHeadV1({slotRoot:input.slotRoot,expectedRevision:head.revision,next:nextB});record.resultDraftHash=curated.snapshot.hash;record.curationAttempts.push({operationId:curateOp,attempt:1,disposition:'committed',baseDraftHash:record.baseDraftHash,resultDraftHash:curated.snapshot.hash,diagnostics:[]});await e.persist(record);e.emit({type:'turn.commit',sessionId:input.sessionId,turnId,commit:'draft',headRevision:head.revision});e.emit({type:'operation.finished',sessionId:input.sessionId,turnId,operationId:curateOp,disposition:'committed'});return terminal('committed');}
  catch(error){record.curationAttempts.push({operationId:curateOp,attempt:1,disposition:e.cancelled()?'cancelled':'failed',baseDraftHash:record.baseDraftHash,resultDraftHash:null,diagnostics:[]});await e.persist(record);e.emit({type:'operation.finished',sessionId:input.sessionId,turnId,operationId:curateOp,disposition:e.cancelled()?'cancelled':'failed',message:message(error)});return terminal('draft-sync-pending');}
 }
 return terminal('policy-rejected');
}
function message(error:unknown):string{return error instanceof Error?error.message:String(error);}
async function discard(e:TurnCoordinatorEffectsV1,response:ProducedResponseV1):Promise<void>{try{await e.discardResponse(response);}catch{/* transient cleanup is not an authority transition */}}
