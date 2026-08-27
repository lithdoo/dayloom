const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {spawnSync}=require('node:child_process');
const {createSealedControlOperationV1,SealedControlProtocolError}=require('../dist/session/sealed-control-operation');
const {parseTurnVerdictV1,parseTurnVerdictToolInputV1}=require('../dist/session/control-protocol');
const {resolvePackagedBoundaries}=require('../dist/promptpile/binaries');
const {nodeProcessRunner}=require('../dist/promptpile/conversation');
const {DRAFT_READ_TOOLS,startSessionFileRuntimeV1}=require('../dist/promptpile/session-file-runtime');
const {buildResponseThoughtV2,buildArbiterThoughtV2}=require('../dist/session/prompts/turn-v2');

const temporary=(t)=>{const root=fs.mkdtempSync(path.join(os.tmpdir(),'sealed-control-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));return root;};
const create=(root)=>createSealedControlOperationV1({root,mode:'turn-verdict',serverId:'turn_control',toolName:'turn_verdict',context:{},serverScript:path.join(root,'server.js'),parse:parseTurnVerdictV1});

test('sealed control refuses Final until one valid result is sealed',async(t)=>{
  const root=temporary(t),control=await create(root);
  assert.throws(()=>control.assertReadyForFinal(),(error)=>error instanceof SealedControlProtocolError&&error.code==='PROTOCOL_INCOMPLETE');
  fs.writeFileSync(path.join(root,'sealed.json'),JSON.stringify({response:{verdict:'ACCEPT'},draft:{verdict:'UPDATE',evidence:'The user explicitly requested this change.'}}));
  fs.writeFileSync(path.join(root,'control-state.json'),JSON.stringify({schemaVersion:1,status:'sealed',calls:1,message:null}));
  control.assertReadyForFinal();
  assert.equal((await control.finish()).draft.verdict,'UPDATE');
});

test('sealed control fails closed for a protocol violation or malformed result',async(t)=>{
  const root=temporary(t),control=await create(root);
  fs.writeFileSync(path.join(root,'control-state.json'),JSON.stringify({schemaVersion:1,status:'violated',calls:2,message:'duplicate'}));
  assert.throws(()=>control.assertReadyForFinal(),/duplicate/);
  fs.writeFileSync(path.join(root,'control-state.json'),JSON.stringify({schemaVersion:1,status:'sealed',calls:1,message:null}));
  fs.writeFileSync(path.join(root,'sealed.json'),JSON.stringify({response:{verdict:'ACCEPT'},draft:{verdict:'DEFER'}}));
  await assert.rejects(()=>control.finish(),(error)=>error instanceof SealedControlProtocolError&&error.code==='RESULT_INVALID');
});

test('Turn verdict schema rejects unsupported combinations and empty evidence',()=>{
  assert.throws(()=>parseTurnVerdictV1({response:{verdict:'REJECT',code:'UNKNOWN',evidence:'x'},draft:{verdict:'DEFER'}}));
  assert.throws(()=>parseTurnVerdictV1({response:{verdict:'ACCEPT'},draft:{verdict:'UPDATE',evidence:' '}}));
  assert.deepEqual(parseTurnVerdictV1({response:{verdict:'ACCEPT'},draft:{verdict:'KEEP'}}),{response:{verdict:'ACCEPT'},draft:{verdict:'KEEP'}});
  assert.deepEqual(parseTurnVerdictToolInputV1({response_verdict:'ACCEPT',rejection_code:'NONE',response_evidence:'',draft_verdict:'UPDATE',draft_evidence:'The user chose science fiction.'}),{response:{verdict:'ACCEPT'},draft:{verdict:'UPDATE',evidence:'The user chose science fiction.'}});
  assert.throws(()=>parseTurnVerdictToolInputV1({response_verdict:'ACCEPT',rejection_code:'NONE',response_evidence:'',draft_verdict:'UPDATE',draft_evidence:''}));
});

test('Turn response and arbitration retain the active Session policy',()=>{
  assert.match(buildResponseThoughtV2('init'),/Dayloom Init Session/);
  assert.match(buildArbiterThoughtV2('init'),/Dayloom Init Session/);
  assert.match(buildArbiterThoughtV2('init'),/PHASE_DRIFT/);
  assert.match(buildArbiterThoughtV2('init'),/片段、关键词和仍需追问的部分意图同样必须先记录/);
});

test('real sealed control runtime exposes read-only Draft tools and closes one verdict ToolCall', {timeout:30_000}, async(t)=>{
  const root=temporary(t),controlRoot=path.join(root,'control'),draft=path.join(root,'draft'),work=path.join(root,'work');
  fs.mkdirSync(draft,{recursive:true});fs.mkdirSync(work,{recursive:true});fs.writeFileSync(path.join(draft,'brief.md'),'# Brief\n');fs.writeFileSync(path.join(draft,'evidence.md'),'# Evidence\n');
  const boundaries=await resolvePackagedBoundaries(),control=await createSealedControlOperationV1({root:controlRoot,mode:'turn-verdict',serverId:'turn_control',toolName:'turn_verdict',context:{},serverScript:path.resolve(__dirname,'../dist/promptpile/operation-control-server.js'),parse:parseTurnVerdictV1});
  const runtime=await startSessionFileRuntimeV1({runtimeRoot:path.join(controlRoot,'file-runtime'),promptpileMcpBin:boundaries.promptpileMcpBin,filesystemMcp:boundaries.filesystemMcp,runner:nodeProcessRunner,servers:[{id:'draft',root:draft,writable:false,tools:DRAFT_READ_TOOLS},control.server],workspaces:[{serverId:'draft',root:draft,writeAllowed:false,writePaths:[],maxFiles:2,maxFileBytes:4096,maxTotalBytes:8192}],finalGates:[control],maxToolCallsPerThought:8,maxToolResultLineBytes:32*1024});
  t.after(()=>runtime.close());assert.equal(runtime.binding.toolNames.includes('mcp__draft__write_file'),false);assert.equal(runtime.binding.toolNames.includes('mcp__turn_control__turn_verdict'),true);
  const exported=fs.readFileSync(runtime.binding.toolsFile,'utf8');assert.match(exported,/properties\.response_verdict/);assert.match(exported,/properties\.draft_verdict/);assert.doesNotMatch(exported,/anyOf/);
  const calls=path.join(work,'[1]assistant.calls.jsonl'),toolCall={id:'verdict1',type:'function',function:{name:'mcp__turn_control__turn_verdict',arguments:JSON.stringify({response_verdict:'ACCEPT',rejection_code:'NONE',response_evidence:'',draft_verdict:'UPDATE',draft_evidence:'The user selected science fiction.'})}};fs.writeFileSync(calls,`${JSON.stringify(toolCall)}\n`);
  const hook=path.resolve(__dirname,'../dist/promptpile/session-file-hook.js'),env={...process.env,PROMPTPILE_HAS_TOOL_CALLS:'1',PROMPTPILE_ASSISTANT_CALL_FILE:calls,PROMPTPILE_OUTPUT_DIRECTORY:work},result=spawnSync(process.execPath,[hook,path.join(controlRoot,'file-runtime','hook.json')],{encoding:'utf8',env,timeout:20_000});assert.equal(result.status,0,result.stderr);runtime.assertReadyForFinal(work);assert.equal((await control.finish()).draft.verdict,'UPDATE');await runtime.close();
});
