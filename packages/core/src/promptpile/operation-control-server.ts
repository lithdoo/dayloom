import { randomUUID } from 'node:crypto';
import { mkdir, open, readFile, rename, rm } from 'node:fs/promises';
import path from 'node:path';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { assignChangePlanV2, canonicalizeChangePlanV2 } from '../session/change-plan-v2';

interface ContextV1 { mode:'turn-verdict'|'change-plan'; resultPath:string; baseRootTreeHash?:string|null; reservedIds?:string[] }
async function main():Promise<void>{
 const contextPath=process.argv[2];if(!contextPath)throw new Error('Operation control context path is required.');const context=parseContext(JSON.parse(await readFile(contextPath,'utf8')),contextPath);let called=false;
 const server=new McpServer({name:'dayloom-operation-control',version:'1.0.0'});
 if(context.mode==='turn-verdict')server.registerTool('turn_verdict',{description:'Seal the single Turn verdict.',inputSchema:z.strictObject({decision:z.enum(['ACCEPT','REJECT']),draft:z.enum(['KEEP','UPDATE']).nullable(),repairConstraint:z.string().max(16*1024).nullable()})},async(input)=>{
   if(called)throw new Error('Turn verdict is already sealed.');called=true;const verdict=input.decision==='ACCEPT'?{decision:'ACCEPT' as const,draft:input.draft}:{decision:'REJECT' as const,repairConstraint:input.repairConstraint};
   if(input.decision==='ACCEPT'&&(input.draft===null||input.repairConstraint!==null)||input.decision==='REJECT'&&(input.draft!==null||typeof input.repairConstraint!=='string'||input.repairConstraint.trim()===''))throw new Error('Turn verdict fields are inconsistent.');
   await atomicJson(context.resultPath,verdict);return {content:[{type:'text' as const,text:JSON.stringify(verdict)}],structuredContent:verdict};
 });
 else server.registerTool('declare_change_plan',{description:'Validate and seal the complete Change Plan.',inputSchema:z.strictObject({schemaVersion:z.literal(2),sessionKind:z.enum(['init','planning','play','revise']),baseDraftHash:z.string(),baseWorldCommitId:z.string().nullable(),targetDay:z.string().nullable(),changes:z.array(z.record(z.string(),z.unknown()))})},async(input)=>{
   if(called)throw new Error('Change Plan is already sealed.');called=true;const plan=canonicalizeChangePlanV2(input),assignment=assignChangePlanV2(plan,context.baseRootTreeHash??null,new Set(context.reservedIds??[]));await atomicJson(context.resultPath,{plan,assignment});return {content:[{type:'text' as const,text:JSON.stringify(assignment)}],structuredContent:assignment};
 });
 await server.connect(new StdioServerTransport());
}
function parseContext(value:unknown,contextPath:string):ContextV1{if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('Operation control context is invalid.');const row=value as Record<string,unknown>,expected=row.mode==='turn-verdict'?['mode','resultPath']:['mode','resultPath','baseRootTreeHash','reservedIds'],actual=Object.keys(row).sort();if(actual.length!==expected.length||actual.some((key,index)=>key!==[...expected].sort()[index])||!['turn-verdict','change-plan'].includes(String(row.mode))||typeof row.resultPath!=='string'||!path.isAbsolute(row.resultPath)||path.dirname(row.resultPath)!==path.dirname(path.resolve(contextPath)))throw new Error('Operation control context is invalid.');if(row.mode==='change-plan'&&(row.baseRootTreeHash!==null&&typeof row.baseRootTreeHash!=='string'||!Array.isArray(row.reservedIds)||row.reservedIds.some((item)=>typeof item!=='string')))throw new Error('Operation control context is invalid.');return row as unknown as ContextV1;}
async function atomicJson(target:string,value:unknown):Promise<void>{await mkdir(path.dirname(target),{recursive:true});const temporary=`${target}.tmp-${randomUUID()}`,handle=await open(temporary,'wx');try{await handle.writeFile(`${JSON.stringify(value,null,2)}\n`);await handle.sync();}finally{await handle.close();}try{await rename(temporary,target);}finally{await rm(temporary,{force:true}).catch(()=>undefined);}}
void main().catch((error)=>{process.stderr.write(`${error instanceof Error?error.message:String(error)}\n`);process.exitCode=1;});
