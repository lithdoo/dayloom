import type { CoreEvent } from '@dayloom/core';
import type { TuiMessage,TuiPresentationItem,TuiWorkingItem } from '../types.js';
export interface PresentationOperation{sessionId:string;operationId:string|null;closed:boolean}
export interface PresentationState{items:readonly TuiPresentationItem[];operation:PresentationOperation|null;operationKinds?:Readonly<Record<string,string>>}
const MAX=64_000;
export function reducePresentation(state:PresentationState,event:Exclude<CoreEvent,{type:'state.changed'}>):PresentationState{
 const scope=state.operation;if(!scope||scope.closed||event.sessionId!==scope.sessionId)return state;const kinds={...(state.operationKinds??{})};
 if(event.type==='operation.started'){if(kinds[event.operationId])return state;kinds[event.operationId]=event.kind;const work:TuiWorkingItem={kind:'working',id:`operation:${event.sessionId}:${event.operationId}`,sessionId:event.sessionId,operationId:event.operationId,phase:null,stepIndex:null,text:'',truncated:false,status:'streaming',workPath:null,pathStatus:'live',detail:label(event.kind,event.attempt)};return{...state,operationKinds:kinds,items:[...state.items,work]};}
 if(event.type==='turn.commit')return state;
 if(event.type==='turn.terminal')return{...state,operation:{...scope,closed:true}};
 const index=state.items.findIndex((item)=>isWorking(item)&&item.operationId===event.operationId);if(index<0)return state;const work=state.items[index] as TuiWorkingItem,kind=kinds[event.operationId];
 if(event.type==='operation.stage')return replace(state,index,{...work,detail:event.stage});
 if(event.type==='operation.diagnostics')return replace(state,index,{...work,detail:`${event.items.filter((item)=>item.severity==='error').length} errors, ${event.items.filter((item)=>item.severity==='advisory').length} advisories`});
 if(event.type==='operation.delta'){
  if(event.channel==='response'){let messageIndex=state.items.findIndex((item)=>!isWorking(item)&&item.operationId===event.operationId),items=[...state.items];if(messageIndex<0){const message:TuiMessage={id:`response:${event.operationId}`,operationId:event.operationId,role:'assistant',text:'',status:'streaming'};items.push(message);messageIndex=items.length-1;}const message=items[messageIndex] as TuiMessage;if(message.status!=='streaming')return state;items[messageIndex]={...message,text:message.text+event.text};return{...state,items};}
  const combined=work.text+event.text,truncated=combined.length>MAX;return replace(state,index,{...work,phase:event.channel,stepIndex:null,text:truncated?combined.slice(-MAX):combined,truncated:work.truncated||truncated});
 }
 if(event.type==='operation.produced'){if(kind!=='response')return replace(state,index,{...work,status:'completed',phase:null,text:'',detail:'produced'});const messageIndex=state.items.findIndex((item)=>!isWorking(item)&&item.operationId===event.operationId);return messageIndex<0?state:replace(state,messageIndex,{...(state.items[messageIndex] as TuiMessage),status:'verifying'});}
 if(event.type==='operation.finished'){const status=event.disposition==='committed'?'completed':event.disposition==='abandoned'?'cancelled':'failed';let next=replace(state,index,{...work,status,pathStatus:'expired',phase:null,text:'',detail:event.message??event.disposition});if(kind==='response'){const messageIndex=next.items.findIndex((item)=>!isWorking(item)&&item.operationId===event.operationId);if(messageIndex>=0){const message=next.items[messageIndex] as TuiMessage,nextStatus=event.disposition==='committed'?'accepted':event.disposition==='superseded'?'superseded':event.disposition==='abandoned'?'abandoned':'error';next=replace(next,messageIndex,{...message,status:nextStatus});}}return next;}
 return state;
}
export function closePresentation(state:PresentationState):PresentationState{return state.operation?{...state,operation:{...state.operation,closed:true}}:state;}
export function isWorking(item:TuiPresentationItem):item is TuiWorkingItem{return'kind'in item&&item.kind==='working';}
function replace(state:PresentationState,index:number,item:TuiPresentationItem):PresentationState{const items=[...state.items];items[index]=item;return{...state,items};}
function label(kind:string,attempt:number){return`${kind} · attempt ${attempt}`;}
