const test=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const os=require('node:os');const path=require('node:path');
const {createDayloomRuntime,createArchiveV2Repository,createFakeSessionFactory}=require('../../dist');
function root(){return fs.mkdtempSync(path.join(os.tmpdir(),'dayloom-v2-runtime-'));}

test('default Runtime uses one durable V2 operation from Session start through submit',async(t)=>{
 const worldRoot=root();t.after(()=>fs.rmSync(worldRoot,{recursive:true,force:true}));const archive=createArchiveV2Repository({worldRoot});const runtime=await createDayloomRuntime({worldRoot,archiveV2Repository:archive,sessionFactory:createFakeSessionFactory({submitResult:{kind:'init',world:{id:'world_runtime',title:'Runtime'},canon:{premise:'P',rules:'R',style:'S',userRole:'U'}}})});
 const started=await runtime.executeCommand({command:'init',operationId:'cmd_start'});assert.equal(started.ok,true);assert.equal((await archive.readCurrent()).status,'uninitialized');const session=await archive.readActiveSession();assert.ok(session);assert.notEqual(session.archiveOperationId,'cmd_start');
 const submitted=await runtime.executeCommand({command:'submit',operationId:'cmd_submit'});assert.equal(submitted.ok,true);const current=await archive.readCurrent();assert.equal(current.status,'ready');assert.equal(current.commit.operationId,session.archiveOperationId);assert.equal(current.pointer.revision,1);assert.equal((await archive.readOperation(session.archiveOperationId)).status,'published');assert.equal(await archive.readActiveSession(),null);assert.equal(new TextDecoder().decode(await archive.readPublishedDocument('canon/user-role.md')),'U');
});

test('default Runtime cancel aborts the same operation without publishing current',async(t)=>{
 const worldRoot=root();t.after(()=>fs.rmSync(worldRoot,{recursive:true,force:true}));const archive=createArchiveV2Repository({worldRoot});const runtime=await createDayloomRuntime({worldRoot,archiveV2Repository:archive,sessionFactory:createFakeSessionFactory()});await runtime.executeCommand({command:'init'});const session=await archive.readActiveSession();const result=await runtime.executeCommand({command:'cancel'});assert.equal(result.ok,true);assert.equal((await archive.readOperation(session.archiveOperationId)).status,'aborted');assert.equal((await archive.readCurrent()).status,'uninitialized');assert.equal(runtime.getSnapshot().world.revision,0);
});

test('settle and abandon publish semantic history documents with coherent control state',async(t)=>{
 const worldRoot=root();t.after(()=>fs.rmSync(worldRoot,{recursive:true,force:true}));const archive=createArchiveV2Repository({worldRoot});const runtime=await createDayloomRuntime({worldRoot,archiveV2Repository:archive,sessionFactory:createFakeSessionFactory()});
 for(const command of ['init','submit','daily','submit','play','submit','settle'])assert.equal((await runtime.executeCommand({command})).ok,true,command);
 let current=await archive.readCurrent();assert.equal(current.status,'ready');assert.equal(current.commit.control.day,'day_0002');assert.equal(current.commit.control.lastSettledDay,'day_0001');assert.match(new TextDecoder().decode(await archive.readPublishedDocument('days/day_0001/settlement.md')),/Settled day_0001/);
 for(const command of ['daily','submit','abandon-day'])assert.equal((await runtime.executeCommand({command})).ok,true,command);
 current=await archive.readCurrent();assert.equal(current.commit.control.day,'day_0001');assert.equal(current.commit.control.lastSettledDay,'day_0001');assert.match(new TextDecoder().decode(await archive.readPublishedDocument('days/day_0002/abandoned.md')),/Abandoned day_0002/);
});
