import { createHash } from 'node:crypto';
import type { CoreSessionKind } from '../state';

export const CHANGE_RESOURCE_KINDS_V2 = ['world-profile','world-state','character','location','arc','fact','thread','story-seed','location-trigger','day-plan','plan-beat','event','canon-field','character-profile','location-profile','arc-profile','world-variable','character-status','character-location','location-status','arc-stage'] as const;
export type ChangeResourceKindV2 = typeof CHANGE_RESOURCE_KINDS_V2[number];
export type ChangeEvidenceRefV2 =
  | { source:'brief'; startLine:number; endLine:number; sha256:string }
  | { source:'evidence'; turnId:string; field:'user-input'|'accepted-response'|'curator-note'; sha256:string }
  | { source:'published'; path:string; startLine:number; endLine:number; sha256:string }
  | { source:'legacy-import'; path:string; sha256:string };
export type ChangeIntentV2 = { localKey:string; action:'create'; resourceKind:ChangeResourceKindV2; targetId:null; parentLocalKey:string|null; evidence:ChangeEvidenceRefV2[] } | { localKey:string; action:'update'|'remove'; resourceKind:ChangeResourceKindV2; targetId:string; parentLocalKey:null; evidence:ChangeEvidenceRefV2[] };
export interface ChangePlanV2 { schemaVersion:2; sessionKind:CoreSessionKind; baseDraftHash:string; baseWorldCommitId:string|null; targetDay:string|null; changes:ChangeIntentV2[] }
export interface ChangePlanAssignmentV2 { schemaVersion:2; planHash:string; baseRootTreeHash:string|null; assignedIds:Readonly<Record<string,string>> }

const HASH=/^[0-9a-f]{64}$/, KEY=/^[a-z][a-z0-9-]{0,63}$/, ID=/^[A-Za-z][A-Za-z0-9_-]{0,127}$/, SAFE_PATH=/^[A-Za-z0-9._/-]+$/;
const matrix: Record<CoreSessionKind,Record<'create'|'update'|'remove',readonly ChangeResourceKindV2[]>>={
  init:{create:['world-profile','world-state','character','location','arc','fact','thread','story-seed','location-trigger'],update:[],remove:[]},
  planning:{create:['day-plan','plan-beat'],update:[],remove:[]},
  play:{create:['event'],update:['world-variable','character-status','character-location','location-status','arc-stage'],remove:[]},
  revise:{create:['character','location','arc','story-seed','location-trigger'],update:['canon-field','character-profile','location-profile','arc-profile','world-variable','character-status','character-location','location-status','arc-stage'],remove:['story-seed']},
};
const prefixes:Partial<Record<ChangeResourceKindV2,string>>={character:'character',location:'location',arc:'arc',fact:'fact',thread:'thread','story-seed':'seed','location-trigger':'trigger','plan-beat':'beat',event:'event'};

export function canonicalizeChangePlanV2(value: unknown): Readonly<ChangePlanV2> {
  const root=object(value,['schemaVersion','sessionKind','baseDraftHash','baseWorldCommitId','targetDay','changes'],'ChangePlan');
  if(root.schemaVersion!==2||!['init','planning','play','revise'].includes(String(root.sessionKind))||typeof root.baseDraftHash!=='string'||!HASH.test(root.baseDraftHash)) fail('Invalid Change Plan header.');
  if(root.baseWorldCommitId!==null&&!ID.test(String(root.baseWorldCommitId))) fail('Invalid baseWorldCommitId.'); if(root.targetDay!==null&&typeof root.targetDay!=='string') fail('Invalid targetDay.');
  if(!Array.isArray(root.changes)||root.changes.length<1||root.changes.length>1024) fail('changes must contain 1-1024 items.');
  const kind=root.sessionKind as CoreSessionKind, keys=new Set<string>(), singletons=new Set<string>();
  const changes=root.changes.map((raw):ChangeIntentV2=>{
    const item=object(raw,['localKey','action','resourceKind','targetId','parentLocalKey','evidence'],'change');
    if(typeof item.localKey!=='string'||!KEY.test(item.localKey)||keys.has(item.localKey)) fail('localKey is invalid or duplicated.'); keys.add(item.localKey);
    if(!['create','update','remove'].includes(String(item.action))||!CHANGE_RESOURCE_KINDS_V2.includes(item.resourceKind as ChangeResourceKindV2)||!matrix[kind][item.action as 'create'|'update'|'remove'].includes(item.resourceKind as ChangeResourceKindV2)) fail('Change action is not allowed for the Session kind.');
    if(item.action==='create'&&item.targetId!==null) fail('create targetId must be null.'); if(item.action!=='create'&&(typeof item.targetId!=='string'||!ID.test(item.targetId))) fail('update/remove targetId is invalid.');
    if(!Array.isArray(item.evidence)||item.evidence.length<1||item.evidence.length>8) fail('evidence must contain 1-8 items.'); const evidence=item.evidence.map(parseEvidence);
    if(!evidence.some((ref)=>ref.source==='brief')) fail('Every change requires brief evidence.');
    if(['world-profile','world-state','day-plan'].includes(String(item.resourceKind))){if(singletons.has(String(item.resourceKind)))fail('Singleton change is duplicated.');singletons.add(String(item.resourceKind));}
    return Object.freeze({localKey:item.localKey,action:item.action,resourceKind:item.resourceKind,targetId:item.targetId,parentLocalKey:item.parentLocalKey,evidence}) as ChangeIntentV2;
  });
  for(const item of changes){if(item.resourceKind==='location-trigger'&&item.action==='create'){const parent=changes.find((candidate)=>candidate.localKey===item.parentLocalKey);if(!parent||parent.action!=='create'||parent.resourceKind!=='location')fail('location-trigger parent must be a created location.');}else if(item.parentLocalKey!==null)fail('Only location-trigger/create accepts parentLocalKey.');}
  return Object.freeze({schemaVersion:2,sessionKind:kind,baseDraftHash:root.baseDraftHash,baseWorldCommitId:root.baseWorldCommitId,targetDay:root.targetDay,changes:Object.freeze(changes)}) as Readonly<ChangePlanV2>;
}
export function hashChangePlanV2(plan:Readonly<ChangePlanV2>):string{return createHash('sha256').update(JSON.stringify(plan)).digest('hex');}
export function assignChangePlanV2(plan:Readonly<ChangePlanV2>,baseRootTreeHash:string|null,reservedIds:ReadonlySet<string>=new Set()):Readonly<ChangePlanAssignmentV2>{
  const used:Record<string,Set<number>>={},assigned:Record<string,string>={}; for(const prefix of Object.values(prefixes))used[prefix!]=numbers(reservedIds,prefix!); const nested=new Map<string,number>();
  for(const change of plan.changes){if(change.action!=='create')continue;const prefix=prefixes[change.resourceKind];if(!prefix)continue;if(prefix==='trigger'){const parent=change.parentLocalKey!,next=(nested.get(parent)??0)+1;nested.set(parent,next);assigned[change.localKey]=`trigger${next}`;}else assigned[change.localKey]=`${prefix}${take(used[prefix])}`;}
  return Object.freeze({schemaVersion:2,planHash:hashChangePlanV2(plan),baseRootTreeHash,assignedIds:Object.freeze(Object.fromEntries(Object.entries(assigned).sort(([a],[b])=>Buffer.compare(Buffer.from(a),Buffer.from(b))))) });
}
function parseEvidence(raw:unknown):ChangeEvidenceRefV2{if(raw===null||typeof raw!=='object'||Array.isArray(raw))fail('Evidence must be an object.');const source=(raw as {source?:unknown}).source;if(source==='brief'){const o=object(raw,['source','startLine','endLine','sha256'],'brief evidence');lines(o);return Object.freeze(o) as ChangeEvidenceRefV2;}if(source==='evidence'){const o=object(raw,['source','turnId','field','sha256'],'turn evidence');if(!ID.test(String(o.turnId))||!['user-input','accepted-response','curator-note'].includes(String(o.field))||!HASH.test(String(o.sha256)))fail('Invalid turn evidence.');return Object.freeze(o) as ChangeEvidenceRefV2;}if(source==='published'){const o=object(raw,['source','path','startLine','endLine','sha256'],'published evidence');lines(o);safePath(o.path);return Object.freeze(o) as ChangeEvidenceRefV2;}if(source==='legacy-import'){const o=object(raw,['source','path','sha256'],'legacy evidence');safePath(o.path);if(!HASH.test(String(o.sha256)))fail('Invalid evidence hash.');return Object.freeze(o) as ChangeEvidenceRefV2;}fail('Unknown evidence source.');}
function lines(o:Record<string,unknown>):void{if(!Number.isSafeInteger(o.startLine)||(o.startLine as number)<1||!Number.isSafeInteger(o.endLine)||(o.endLine as number)<(o.startLine as number)||!HASH.test(String(o.sha256)))fail('Invalid evidence line range.');}
function safePath(value:unknown):void{const text=String(value);if(!SAFE_PATH.test(text)||text.startsWith('/')||text.includes('//')||text.split('/').some((part)=>part==='.'||part==='..'))fail('Invalid evidence path.');}
function object(value:unknown,keys:readonly string[],label:string):Record<string,any>{if(value===null||typeof value!=='object'||Array.isArray(value))fail(`${label} must be an object.`);const o=value as Record<string,any>,actual=Object.keys(o).sort(),expected=[...keys].sort();if(actual.length!==expected.length||actual.some((key,index)=>key!==expected[index]))fail(`${label} has unknown or missing fields.`);return o;}
function numbers(ids:ReadonlySet<string>,prefix:string):Set<number>{return new Set([...ids].map((id)=>Number(new RegExp(`^${prefix}([1-9][0-9]*)$`).exec(id)?.[1]??0)).filter(Boolean));}function take(used:Set<number>):number{let value=1;while(used.has(value))value++;used.add(value);return value;}function fail(message:string):never{throw new Error(message);}
