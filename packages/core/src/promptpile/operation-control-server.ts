import { randomUUID } from 'node:crypto';
import { mkdir, open, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { assignChangePlanV2, canonicalizeChangePlanV2 } from '../session/change-plan-v2';
import { parseTurnVerdictToolInputV1, TurnVerdictToolInputShapeV1 } from '../session/control-protocol';

interface ContextV1 { mode:'turn-verdict'|'change-plan'; resultPath:string; statePath:string; baseRootTreeHash?:string|null; reservedIds?:string[] }
async function main():Promise<void>{
 const contextPath=process.argv[2];if(!contextPath)throw new Error('Operation control context path is required.');const context=parseContext(JSON.parse(await readFile(contextPath,'utf8')),contextPath);let called=false;
 const server=new McpServer({name:'dayloom-operation-control',version:'1.0.0'});
 if(context.mode==='turn-verdict')server.registerTool('turn_verdict',{description:'Seal the single Turn verdict.',inputSchema:TurnVerdictToolInputShapeV1},async(input)=>{
   if(called){await state(context,'violated',2,'Turn verdict was called more than once.');throw new Error('Turn verdict is already sealed.');}called=true;const verdict=parseTurnVerdictToolInputV1(input);
   await atomicJson(context.resultPath,verdict);await state(context,'sealed',1,null);return {content:[{type:'text' as const,text:JSON.stringify(verdict)}],structuredContent:verdict};
 });
 else server.registerTool('declare_change_plan',{description:'Validate and seal the complete Change Plan.',inputSchema:{schemaVersion:z.literal(2),sessionKind:z.enum(['init','planning','play','revise']),baseDraftHash:z.string(),baseWorldCommitId:z.string().nullable(),targetDay:z.string().nullable(),changes:z.array(z.record(z.string(),z.unknown()))}},async(input)=>{
   if(called){await state(context,'violated',2,'Change Plan was called more than once.');throw new Error('Change Plan is already sealed.');}called=true;const plan=canonicalizeChangePlanV2(input),assignment=assignChangePlanV2(plan,context.baseRootTreeHash??null,new Set(context.reservedIds??[]));const result={plan,assignment};await atomicJson(context.resultPath,result);await state(context,'sealed',1,null);return {content:[{type:'text' as const,text:JSON.stringify(assignment)}],structuredContent:assignment};
 });
 await server.connect(new StdioServerTransport());
}
function parseContext(value:unknown,contextPath:string):ContextV1{if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('Operation control context is invalid.');const row=value as Record<string,unknown>,expected=row.mode==='turn-verdict'?['mode','resultPath','statePath']:['mode','resultPath','statePath','baseRootTreeHash','reservedIds'],actual=Object.keys(row).sort(),directory=path.dirname(path.resolve(contextPath));if(actual.length!==expected.length||actual.some((key,index)=>key!==[...expected].sort()[index])||!['turn-verdict','change-plan'].includes(String(row.mode))||typeof row.resultPath!=='string'||!path.isAbsolute(row.resultPath)||path.dirname(row.resultPath)!==directory||typeof row.statePath!=='string'||!path.isAbsolute(row.statePath)||path.dirname(row.statePath)!==directory)throw new Error('Operation control context is invalid.');if(row.mode==='change-plan'&&(row.baseRootTreeHash!==null&&typeof row.baseRootTreeHash!=='string'||!Array.isArray(row.reservedIds)||row.reservedIds.some((item)=>typeof item!=='string')))throw new Error('Operation control context is invalid.');return row as unknown as ContextV1;}
async function atomicJson(target:string,value:unknown):Promise<void>{await mkdir(path.dirname(target),{recursive:true});const temporary=`${target}.tmp-${randomUUID()}`,handle=await open(temporary,'wx');try{await handle.writeFile(`${JSON.stringify(value,null,2)}\n`);await handle.sync();}finally{await handle.close();}try{await rename(temporary,target);}finally{await rm(temporary,{force:true}).catch(()=>undefined);}}
async function state(context:ContextV1,status:'sealed'|'violated',calls:number,message:string|null):Promise<void>{await writeFile(context.statePath,`${JSON.stringify({schemaVersion:1,status,calls,message},null,2)}\n`,'utf8');}
void main().catch((error)=>{process.stderr.write(`${error instanceof Error?error.message:String(error)}\n`);process.exitCode=1;});
