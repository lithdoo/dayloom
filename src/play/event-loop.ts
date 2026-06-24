import fs from 'fs';
import os from 'os';
import path from 'path';
import { connectOrStartGateway } from '../daily/mcp-gateway';
import { assertAllowedPlayerContextRoot, exportReadonlyTools } from '../daily/mcp-tools';
import { readDailyUserInput } from '../daily/read-user-input';
import { createFilteredStreamOutput } from '../shared/filtered-stream-output';
import { callPlayAi } from './ai';
import { buildPlayContext } from './player-context';
import { parseEventResult, parseEventStatus, parseGeneratedEvent, parseReplan } from './parse-assistant';
import { applyEventResult, applyReplan, buildResultReplan, eventId, eventRoot, finishPlay, initializePlay, loadPlan, loadState, nextExecutableBeat, savePlan, saveState } from './state';
import { normalizeReplanPayload, validateEventResult, validateEventStatus, validateGeneratedEvent, validateReplan } from './validate';
import type { EventResult, EventStatus, PlayOptions, ReplanPayload } from './types';
import { withLoading } from '../utils/loading';

export async function runPlayLoop(worldRoot:string,day:string,options:PlayOptions={}):Promise<void>{
  if(!process.env.DEEPSEEK_API_KEY?.trim())throw new Error('DEEPSEEK_API_KEY is not set. Play requires an API key.');
  initializePlay(worldRoot,day);
  const serviceRoot=fs.mkdtempSync(path.join(os.tmpdir(),'day-loom-play-service-'));
  const contextRoot=path.join(serviceRoot,'player-context');
  const toolsFile=path.join(serviceRoot,'readonly.tools.toml');
  let gateway:Awaited<ReturnType<typeof connectOrStartGateway>>|undefined;
  const maxTools=options.maxToolRounds??8;
  const maxRounds=options.maxEventRounds??20;
  try{
    await withLoading('正在准备游玩上下文...',async loading=>{
      buildPlayContext(worldRoot,day,contextRoot);
      loading.update('正在启动只读服务...');
      gateway=await connectOrStartGateway(serviceRoot,contextRoot,options.mcpBaseUrl,options.mcpToken);
      loading.update('正在准备只读工具...');
      await exportReadonlyTools(gateway.baseUrl,gateway.token,toolsFile);
      await assertAllowedPlayerContextRoot(gateway.baseUrl,gateway.token,contextRoot,serviceRoot);
    });
    if(!gateway)throw new Error('Failed to initialize readonly gateway');
    while(true){
      const state=loadState(worldRoot,day);
      const plan=loadPlan(worldRoot,day);
      if(state.step==='complete'||state.phase==='settling')return;
      if(state.step==='ready'){
        const beat=nextExecutableBeat(plan);
        if(!beat){
          if(plan.beats.some(b=>b.status==='pending'||b.status==='active'))throw new Error('No executable beat; check depends_on references');
          finishPlay(worldRoot,day,state);
          process.stdout.write('All planned events resolved. Day is ready for settlement.\n');
          return;
        }
        await generate(worldRoot,day,plan,state,beat.id,toolsFile,gateway.baseUrl,gateway.token,maxTools,contextRoot);
        continue;
      }
      if(state.step==='waiting_user'){
        const exited=await dialogue(worldRoot,day,state.active_event!,toolsFile,gateway.baseUrl,gateway.token,maxTools,maxRounds,contextRoot);
        if(exited){process.stdout.write('Play progress saved.\n');return;}
        continue;
      }
      if(state.step==='resolving'){await resolveEvent(worldRoot,day,state.active_event!,state.active_beat!,toolsFile,gateway.baseUrl,gateway.token,maxTools,contextRoot);continue;}
      if(state.step==='replanning'){await replan(worldRoot,day,state.active_event!,state.active_beat!,toolsFile,gateway.baseUrl,gateway.token,maxTools,contextRoot);continue;}
      throw new Error('Unsupported play step: '+state.step);
    }
  }finally{
    if(gateway)await gateway.stop();
    if(!options.keepSession)fs.rmSync(serviceRoot,{recursive:true,force:true});
    else process.stderr.write('Play service session preserved at: '+serviceRoot+'\n');
  }
}

async function generate(worldRoot:string,day:string,plan:any,state:any,beatId:string,tools:string,base:string,token:string|undefined,max:number,context:string):Promise<void>{
  const beat=plan.beats.find((b:any)=>b.id===beatId);
  const id=eventId(state.next_event_number);
  buildPlayContext(worldRoot,day,context);
  const reply=await withLoading('正在生成事件...',()=>callPlayAi('play-event-generator','# Event request\n\nEvent ID: '+id+'\nSource beat: '+JSON.stringify(beat)+'\nCurrent plan: '+JSON.stringify(plan,null,2),tools,base,token,max));
  const event=parseGeneratedEvent(reply);
  validateGeneratedEvent(event,id,beatId);
  beat.status='active';
  savePlan(worldRoot,plan);
  const dir=eventRoot(worldRoot,day,id);
  fs.mkdirSync(dir,{recursive:true});
  writeJson(path.join(dir,'event.json'),event);
  fs.writeFileSync(path.join(dir,'transcript.md'),'# '+event.title+'\n\n'+event.opening+'\n\n'+event.situation+'\n','utf8');
  state.active_event=id;state.active_beat=beatId;state.step='waiting_user';saveState(worldRoot,state);
}

async function dialogue(worldRoot:string,day:string,id:string,tools:string,base:string,token:string|undefined,maxTools:number,maxRounds:number,context:string):Promise<boolean>{
  const dir=eventRoot(worldRoot,day,id);
  const event=JSON.parse(fs.readFileSync(path.join(dir,'event.json'),'utf8'));
  let transcript=fs.readFileSync(path.join(dir,'transcript.md'),'utf8');
  process.stdout.write('\n--- '+event.title+' ---\n\n'+event.opening+'\n\n'+event.situation+'\n');
  if(event.suggested_actions.length)process.stdout.write(event.suggested_actions.map((x:string,i:number)=>(i+1)+'. '+x).join('\n')+'\n');
  while(true){
    const rounds=(transcript.match(/^## User$/gm)??[]).length;
    if(rounds>=maxRounds)throw new Error('Event exceeded max dialogue rounds ('+maxRounds+')');
    const input=await readDailyUserInput();
    if(input===undefined||input==='/exit')return true;
    if(input==='/status'){process.stdout.write(fs.readFileSync(path.join(dir,'event.json'),'utf8'));continue;}
    if(input==='/end-day'){
      const status:EventStatus={status:'resolved',situation:'The player explicitly ended the day.',needs_user_action:false,resolution_summary:'The player explicitly ended the current day.',end_day:true};
      const machine='```event-status\n'+JSON.stringify(status,null,2)+'\n```';
      transcript+='\n## User\n\n/end-day\n\n## Assistant\n\nThe day ends here.\n\n'+machine+'\n';
      fs.writeFileSync(path.join(dir,'transcript.md'),transcript,'utf8');
      writeJson(path.join(dir,'status.json'),status);
      const state=loadState(worldRoot,day);state.step='resolving';saveState(worldRoot,state);
      return false;
    }
    transcript+='\n## User\n\n'+input+'\n';
    fs.writeFileSync(path.join(dir,'transcript.md'),transcript,'utf8');
    buildPlayContext(worldRoot,day,context);
    process.stdout.write('\nAI> ');
    const stream=createFilteredStreamOutput({hiddenBlocks:['event-status']});
    const reply=await callPlayAi('play-event-dialogue','# Event\n\n'+JSON.stringify(event,null,2)+'\n\n# Transcript\n\n'+transcript,tools,base,token,maxTools,text=>stream.push(text));
    stream.flush();process.stdout.write('\n');
    transcript+='\n## Assistant\n\n'+reply+'\n';
    fs.writeFileSync(path.join(dir,'transcript.md'),transcript,'utf8');
    let status:EventStatus;
    try{status=parseEventStatus(reply);validateEventStatus(status);}catch(error){process.stderr.write('Warning: invalid event-status metadata; continuing the event: '+(error instanceof Error?error.message:String(error))+'\n');continue;}
    writeJson(path.join(dir,'status.json'),status);
    if(status.status==='resolved'){const state=loadState(worldRoot,day);state.step='resolving';saveState(worldRoot,state);return false;}
  }
}

async function resolveEvent(worldRoot:string,day:string,id:string,beatId:string,tools:string,base:string,token:string|undefined,max:number,context:string):Promise<void>{
  const dir=eventRoot(worldRoot,day,id);
  const resultFile=path.join(dir,'result.json');
  const plan=loadPlan(worldRoot,day);
  const statusFile=path.join(dir,'status.json');
  const finalStatus:EventStatus=fs.existsSync(statusFile)?JSON.parse(fs.readFileSync(statusFile,'utf8')):{status:'resolved',situation:'Resolved event',needs_user_action:false,end_day:false,resolution_summary:'Resolved event'};
  validateEventStatus(finalStatus);
  let result:EventResult;
  if(fs.existsSync(resultFile))result=JSON.parse(fs.readFileSync(resultFile,'utf8'));
  else{
    buildPlayContext(worldRoot,day,context);
    const status=JSON.stringify(finalStatus,null,2);
    const reply=await withLoading('正在整理事件结果...',()=>callPlayAi('play-event-resolver','# Event\n'+fs.readFileSync(path.join(dir,'event.json'),'utf8')+'\n# Final event status\n'+status+'\n# Current plan\n'+JSON.stringify(plan,null,2)+'\n# Transcript\n'+fs.readFileSync(path.join(dir,'transcript.md'),'utf8'),tools,base,token,max));
    result=parseEventResult(reply);
  }
  if(finalStatus.end_day)result.end_day=true;
  validateEventResult(result,id,beatId,plan);
  writeJson(resultFile,result);
  const patchFile=path.join(dir,'state.patch.json');
  const appliedFile=path.join(dir,'state.patch.applied');
  if(!fs.existsSync(patchFile))writeJson(patchFile,result.state_patch);
  if(!fs.existsSync(appliedFile)){applyEventResult(worldRoot,day,result);fs.writeFileSync(appliedFile,new Date().toISOString()+'\n','utf8');}
  const state=loadState(worldRoot,day);state.step='replanning';saveState(worldRoot,state);
}

async function replan(worldRoot:string,day:string,id:string,beatId:string,tools:string,base:string,token:string|undefined,max:number,context:string):Promise<void>{
  const dir=eventRoot(worldRoot,day,id);
  const plan=loadPlan(worldRoot,day);
  const result=JSON.parse(fs.readFileSync(path.join(dir,'result.json'),'utf8')) as EventResult;
  validateEventResult(result,id,beatId,plan);
  const replanFile=path.join(dir,'replan.json');
  let payload:ReplanPayload;
  if(result.end_day){payload=buildResultReplan(plan,result);}
  else{
    let proposed:ReplanPayload;
    if(fs.existsSync(replanFile))proposed=JSON.parse(fs.readFileSync(replanFile,'utf8'));
    else{
      buildPlayContext(worldRoot,day,context);
      const validBeatIds=plan.beats.map(beat=>beat.id);
      const remainingInsertSlots=Math.max(0,plan.max_events-plan.beats.length);
      const reply=await withLoading('正在更新后续计划...',()=>callPlayAi('play-replanner','# Replan constraints\nValid existing beat IDs: '+validBeatIds.join(', ')+'\nRemaining insert slots: '+remainingInsertSlots+'\ninsert.after may only use a valid existing beat ID. New beat IDs are assigned by the system and cannot be referenced.\n\n# Current plan\n'+JSON.stringify(plan,null,2)+'\n# Event result\n'+JSON.stringify(result,null,2),tools,base,token,max));
      proposed=parseReplan(reply);
    }
    const normalized=normalizeReplanPayload(proposed,plan);
    for(const warning of normalized.warnings)process.stderr.write('Warning: '+warning+'\n');
    payload=buildResultReplan(plan,result,normalized.payload);
  }
  validateReplan(payload,plan);
  writeJson(replanFile,payload);
  const appliedFile=path.join(dir,'replan.applied');
  if(!fs.existsSync(appliedFile)){
    const next=applyReplan(plan,payload);
    for(const beat of next.beats)if(beat.status==='active')beat.status='pending';
    savePlan(worldRoot,next);
    fs.writeFileSync(appliedFile,new Date().toISOString()+'\n','utf8');
  }
  const state=loadState(worldRoot,day);
  if(!state.completed_events.includes(id))state.completed_events.push(id);
  state.active_event=null;state.active_beat=null;state.next_event_number++;
  if(result.end_day){finishPlay(worldRoot,day,state);process.stdout.write('Day ended. World is ready for settlement.\n');return;}
  state.step='ready';saveState(worldRoot,state);
}

function writeJson(file:string,value:unknown):void{fs.writeFileSync(file,JSON.stringify(value,null,2)+'\n','utf8');}
