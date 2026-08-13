const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createArchiveV2Repository, NodeCoreFileSystem } = require('../../dist');
const { createFailureFilesystem } = require('../helpers/failure-filesystem.js');

function fixture(name) {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),`dayloom-v2-${name}-`));
  return {root,cleanup:()=>fs.rmSync(root,{recursive:true,force:true})};
}
const markdown=(text)=>new TextEncoder().encode(text);

test('V2 operation stages, prepares, publishes, and survives restart',async(t)=>{
  const f=fixture('flow');t.after(f.cleanup);const repo=createArchiveV2Repository({worldRoot:f.root});
  const op=await repo.beginWorldOperation({type:'init',operationId:'op_init'});
  await repo.stageManifest(op.id,{worldId:'world_test',title:'Test World'});
  await repo.putDocument(op.id,'canon/premise.md',markdown('# Premise\n'),'text/markdown');
  assert.equal(new TextDecoder().decode(await repo.readEffectiveDocument(op.id,'canon/premise.md')),'# Premise\n');
  const prepared=await repo.prepare(op.id,{phase:'idle',day:null,lastSettledDay:null});
  assert.equal(prepared.status,'prepared');assert.equal((await repo.readCurrent()).status,'uninitialized');
  const published=await repo.publish(op.id);assert.equal(published.status,'ready');assert.equal(published.commit.operationId,op.id);
  const restarted=createArchiveV2Repository({worldRoot:f.root});assert.equal(new TextDecoder().decode(await restarted.readPublishedDocument('canon/premise.md')),'# Premise\n');
  assert.equal((await restarted.readOperation(op.id)).status,'published');
});

test('staging index is the only staged visibility switch',async(t)=>{
  const f=fixture('staging-fault');t.after(f.cleanup);const injected=createFailureFilesystem(new NodeCoreFileSystem());const repo=createArchiveV2Repository({worldRoot:f.root,filesystem:injected.filesystem});const op=await repo.beginWorldOperation({type:'init'});
  injected.failNext('rename',new Error('index switch failed'),(_source,target)=>target.endsWith(path.join('staging','index.json')));
  await assert.rejects(repo.putDocument(op.id,'canon/premise.md',markdown('new'),'text/markdown'),/index switch failed/);
  assert.equal(await repo.readEffectiveDocument(op.id,'canon/premise.md'),null);assert.equal((await repo.inspectStaging(op.id)).changes.length,0);
});

test('prepared operation is immutable and protects its graph from GC',async(t)=>{
  const f=fixture('prepared');t.after(f.cleanup);const repo=createArchiveV2Repository({worldRoot:f.root});const op=await repo.beginWorldOperation({type:'init'});await repo.putDocument(op.id,'canon/rules.md',markdown('rules'),'text/markdown');const prepared=await repo.prepare(op.id,{phase:'idle',day:null,lastSettledDay:null});
  await assert.rejects(repo.putDocument(op.id,'canon/style.md',markdown('style'),'text/markdown'),/frozen/);const inspection=await repo.inspect();assert.deepEqual(inspection.preparedCommits,[prepared.targetCommitId]);assert.equal(inspection.orphanCommits.length,0);assert.equal((await repo.collectGarbage({delete:true})).deleted.length,0);
});

test('OCC preserves a superseded prepared candidate',async(t)=>{
  const f=fixture('occ');t.after(f.cleanup);const repo=createArchiveV2Repository({worldRoot:f.root});const init=await repo.beginWorldOperation({type:'init'});await repo.stageManifest(init.id,{worldId:'world_occ',title:'OCC'});await repo.putDocument(init.id,'canon/premise.md',markdown('base'),'text/markdown');await repo.prepare(init.id,{phase:'idle',day:null,lastSettledDay:null});await repo.publish(init.id);
  const a=await repo.beginWorldOperation({type:'revise'}),b=await repo.beginWorldOperation({type:'revise'});await repo.putDocument(a.id,'canon/premise.md',markdown('A'),'text/markdown');await repo.putDocument(b.id,'canon/premise.md',markdown('B'),'text/markdown');await repo.prepare(a.id,{phase:'idle',day:null,lastSettledDay:null});await repo.prepare(b.id,{phase:'idle',day:null,lastSettledDay:null});await repo.publish(b.id);await assert.rejects(repo.publish(a.id),error=>error.code==='ARCHIVE_CONFLICT');assert.equal(new TextDecoder().decode(await repo.readPublishedDocument('canon/premise.md')),'B');assert.equal((await repo.readOperation(a.id)).status,'prepared');
});

test('durable Session owns one World operation and is restart discoverable',async(t)=>{
  const f=fixture('session');t.after(f.cleanup);const repo=createArchiveV2Repository({worldRoot:f.root});const session=await repo.createSession({kind:'init',sessionId:'session_one'});await repo.putDocument(session.archiveOperationId,'canon/premise.md',markdown('turn 1'),'text/markdown');await repo.putDocument(session.archiveOperationId,'canon/premise.md',markdown('turn 2'),'text/markdown');const restarted=createArchiveV2Repository({worldRoot:f.root});assert.equal((await restarted.readActiveSession()).archiveOperationId,session.archiveOperationId);await restarted.abort(session.archiveOperationId);await restarted.updateSessionStatus(session.archiveOperationId,'cancelled');assert.equal(await restarted.readActiveSession(),null);assert.equal((await restarted.readCurrent()).status,'uninitialized');
});

test('historical play documents require revise and paths are portable',async(t)=>{
  const f=fixture('policy');t.after(f.cleanup);const repo=createArchiveV2Repository({worldRoot:f.root});const init=await repo.beginWorldOperation({type:'init'});await repo.stageManifest(init.id,{worldId:'world_policy',title:'Policy'});await repo.putDocument(init.id,'days/day_0001/play.md',markdown('history'),'text/markdown');await repo.prepare(init.id,{phase:'awaiting-settle',day:'day_0001',lastSettledDay:null});await repo.publish(init.id);const play=await repo.beginWorldOperation({type:'play'});await assert.rejects(repo.putDocument(play.id,'days/day_0001/play.md',markdown('rewrite'),'text/markdown'),/explicit revise/);await assert.rejects(repo.putDocument(play.id,'canon/CON.md',markdown('bad'),'text/markdown'));
});
