import fs from 'fs';
import path from 'path';
import type { CurrentPlan, EventResult, PlayState, ReplanPayload } from './types';
interface InitialPlan { day: string; user_intent: string; max_events: number; planned_beats: Array<{ id: string; intent: string; priority: 'required' | 'optional'; depends_on?: string[] }>; }
export const dayRoot = (worldRoot: string, day: string): string => path.join(worldRoot, 'days', day);
export const eventRoot = (worldRoot: string, day: string, eventId: string): string => path.join(dayRoot(worldRoot, day), 'events', eventId);
const planPath = (worldRoot: string, day: string): string => path.join(dayRoot(worldRoot, day), 'plan.current.json');
const statePath = (worldRoot: string, day: string): string => path.join(dayRoot(worldRoot, day), 'play.state.json');
const runtimePath = (worldRoot: string, day: string): string => path.join(dayRoot(worldRoot, day), 'runtime.state.json');
export function initializePlay(worldRoot: string, day: string): { plan: CurrentPlan; state: PlayState } {
  const initialFile = path.join(dayRoot(worldRoot, day), 'plan.initial.json'); if (!fs.existsSync(initialFile)) throw new Error('Missing daily plan: days/' + day + '/plan.initial.json');
  if (!fs.existsSync(planPath(worldRoot, day))) { const initial = JSON.parse(fs.readFileSync(initialFile,'utf8')) as InitialPlan; const plan: CurrentPlan = { day: initial.day, user_intent: initial.user_intent, revision: 0, max_events: initial.max_events, beats: initial.planned_beats.map(b => ({...b,status:'pending'})) }; writeJson(planPath(worldRoot,day),plan); }
  if (!fs.existsSync(statePath(worldRoot, day))) { const state: PlayState = { version:1,day,phase:'playing',next_event_number:1,active_event:null,active_beat:null,step:'ready',completed_events:[] }; writeJson(statePath(worldRoot,day),state); }
  if (!fs.existsSync(runtimePath(worldRoot, day))) writeJson(runtimePath(worldRoot,day),{});
  const phase=loadState(worldRoot,day).phase; setYamlPhase(path.join(worldRoot,'current.yaml'),phase); setYamlPhase(path.join(dayRoot(worldRoot,day),'meta.yaml'),phase);
  return { plan: loadPlan(worldRoot,day), state: loadState(worldRoot,day) };
}
export function loadPlan(worldRoot:string,day:string):CurrentPlan{return JSON.parse(fs.readFileSync(planPath(worldRoot,day),'utf8')) as CurrentPlan;}
export function savePlan(worldRoot:string,plan:CurrentPlan):void{writeJson(planPath(worldRoot,plan.day),plan);}
export function loadState(worldRoot:string,day:string):PlayState{return JSON.parse(fs.readFileSync(statePath(worldRoot,day),'utf8')) as PlayState;}
export function saveState(worldRoot:string,state:PlayState):void{writeJson(statePath(worldRoot,state.day),state);}
export function nextExecutableBeat(plan:CurrentPlan){const completed=new Set(plan.beats.filter(b=>b.status==='completed').map(b=>b.id));return plan.beats.find(b=>b.status==='pending' && (b.depends_on??[]).every(id=>completed.has(id)));}
export function eventId(number:number):string{return 'event_'+String(number).padStart(3,'0');}
function durationMinutes(value:string):number{const hours=value.match(/^(\d+)h$/)?.[1];if(hours)return Number(hours)*60;const minutes=value.match(/^(\d+)m$/)?.[1];return Number(minutes??0);}
export function applyEventResult(worldRoot:string,day:string,result:EventResult):void{
  const runtime=JSON.parse(fs.readFileSync(runtimePath(worldRoot,day),'utf8')) as Record<string,unknown>;
  for(const p of result.state_patch)runtime[p.key]=p.value;
  const elapsed=(typeof runtime.day_elapsed_minutes==='number'?runtime.day_elapsed_minutes:0)+durationMinutes(result.time_advanced);
  runtime.day_elapsed_minutes=elapsed;
  writeJson(runtimePath(worldRoot,day),runtime);
  const log=path.join(worldRoot,'logs','state_changes.jsonl');
  fs.appendFileSync(log,JSON.stringify({type:'event_resolved',day,event:result.event_id,beat:result.source_beat,summary:result.summary,time_advanced:result.time_advanced,end_day:result.end_day??false,completed_beats:result.completed_beats??[],cancelled_beats:result.cancelled_beats??[],state_patch:result.state_patch})+'\n','utf8');
}
export function buildResultReplan(plan:CurrentPlan,result:EventResult,payload:ReplanPayload={operations:[]}):ReplanPayload{
  const completed=new Set(result.completed_beats??(result.completed_source_beat===false?[]:[result.source_beat]));
  const cancelled=new Set(result.cancelled_beats??[]);
  const operations:ReplanPayload['operations']=[];
  const handled=new Set<string>();
  for(const beat of plan.beats){
    if(beat.status==='completed'||beat.status==='cancelled')continue;
    if(completed.has(beat.id)){operations.push({op:'complete',beat_id:beat.id,reason:'Completed by event result'});handled.add(beat.id);}
    else if(cancelled.has(beat.id)){operations.push({op:'cancel',beat_id:beat.id,reason:'Cancelled by event result'});handled.add(beat.id);}
    else if(result.end_day){operations.push({op:'cancel',beat_id:beat.id,reason:'Day ended before this beat was completed'});handled.add(beat.id);}
  }
  if(!result.end_day){
    for(const op of payload.operations){
      if(op.op!=='insert'&&handled.has(op.beat_id))continue;
      if(op.op!=='insert')handled.add(op.beat_id);
      operations.push(op);
    }
  }
  return {operations};
}
export function applyReplan(plan:CurrentPlan,payload:ReplanPayload):CurrentPlan{const next:CurrentPlan=JSON.parse(JSON.stringify(plan));let counter=Math.max(0,...next.beats.map(b=>Number(b.id.match(/\d+/)?.[0]??0)));for(const op of payload.operations){if(op.op==='insert'){counter++;const beat={id:'beat_'+String(counter).padStart(2,'0'),intent:op.intent,priority:op.priority,status:'pending' as const};const index=op.after?next.beats.findIndex(b=>b.id===op.after):-1;next.beats.splice(index>=0?index+1:next.beats.length,0,beat);continue;}const beat=next.beats.find(b=>b.id===op.beat_id);if(!beat)continue;if(op.op==='complete')beat.status='completed';else if(op.op==='cancel')beat.status='cancelled';else if(op.op==='modify')beat.intent=op.intent;}next.revision++;return next;}
export function finishPlay(worldRoot:string,day:string,state:PlayState):void{state.phase='settling';state.step='complete';state.active_event=null;state.active_beat=null;saveState(worldRoot,state);setYamlPhase(path.join(worldRoot,'current.yaml'),'settling');setYamlPhase(path.join(dayRoot(worldRoot,day),'meta.yaml'),'settling');}
function setYamlPhase(file:string,phase:string):void{let text=fs.readFileSync(file,'utf8');text=/^phase:/m.test(text)?text.replace(/^phase:.*$/m,'phase: '+phase):text+'\nphase: '+phase+'\n';fs.writeFileSync(file,text,'utf8');}
function writeJson(file:string,value:unknown):void{fs.mkdirSync(path.dirname(file),{recursive:true});const tmp=file+'.tmp';fs.writeFileSync(tmp,JSON.stringify(value,null,2)+'\n','utf8');fs.renameSync(tmp,file);}
