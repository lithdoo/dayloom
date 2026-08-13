const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
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
  const f=fixture('policy');t.after(f.cleanup);const repo=createArchiveV2Repository({worldRoot:f.root});const init=await repo.beginWorldOperation({type:'init'});await repo.stageManifest(init.id,{worldId:'world_policy',title:'Policy'});await repo.putDocument(init.id,'days/day_0001/play.json',markdown('{"events":[]}'),'application/json');await repo.prepare(init.id,{phase:'awaiting-settle',day:'day_0001',lastSettledDay:null});await repo.publish(init.id);const play=await repo.beginWorldOperation({type:'play'});await assert.rejects(repo.putDocument(play.id,'days/day_0001/play.json',markdown('{"events":[]}'),'application/json'),/explicit revise/);await assert.rejects(repo.putDocument(play.id,'canon/CON.md',markdown('bad'),'text/markdown'));
});

test('effective reads remain pinned when another operation publishes',async(t)=>{
  const f=fixture('pinned');t.after(f.cleanup);const repo=createArchiveV2Repository({worldRoot:f.root});const init=await repo.beginWorldOperation({type:'init'});await repo.stageManifest(init.id,{worldId:'world_pinned',title:'Pinned'});await repo.putDocument(init.id,'canon/premise.md',markdown('C1'),'text/markdown');await repo.prepare(init.id,{phase:'idle',day:null,lastSettledDay:null});await repo.publish(init.id);
  const pinned=await repo.beginWorldOperation({type:'revise'}),other=await repo.beginWorldOperation({type:'revise'});await repo.putDocument(other.id,'canon/premise.md',markdown('C2'),'text/markdown');await repo.prepare(other.id,{phase:'idle',day:null,lastSettledDay:null});await repo.publish(other.id);assert.equal(new TextDecoder().decode(await repo.readEffectiveDocument(pinned.id,'canon/premise.md')),'C1');assert.equal(new TextDecoder().decode(await repo.readPublishedDocument('canon/premise.md')),'C2');
});

test('prepare retry is byte deterministic after a failed prepared switch',async(t)=>{
  const f=fixture('prepare-retry');t.after(f.cleanup);let now=new Date('2026-01-01T00:00:00.000Z');const injected=createFailureFilesystem(new NodeCoreFileSystem());const repo=createArchiveV2Repository({worldRoot:f.root,filesystem:injected.filesystem,clock:{now:()=>now}});const op=await repo.beginWorldOperation({type:'init'});await repo.stageManifest(op.id,{worldId:'world_retry',title:'Retry'});await repo.putDocument(op.id,'canon/premise.md',markdown('stable'),'text/markdown');injected.failNext('rename',new Error('prepared switch failed'),(_source,target)=>target.endsWith('operation.json'));await assert.rejects(repo.prepare(op.id,{phase:'idle',day:null,lastSettledDay:null}),/prepared switch failed/);now=new Date('2027-01-01T00:00:00.000Z');const prepared=await repo.prepare(op.id,{phase:'idle',day:null,lastSettledDay:null});assert.equal(prepared.status,'prepared');await repo.publish(op.id);assert.equal((await repo.readCurrent()).status,'ready');
});

test('publish rejects a prepared graph whose blob disappeared',async(t)=>{
  const f=fixture('publish-verify');t.after(f.cleanup);const repo=createArchiveV2Repository({worldRoot:f.root});const op=await repo.beginWorldOperation({type:'init'});await repo.stageManifest(op.id,{worldId:'world_verify',title:'Verify'});await repo.putDocument(op.id,'canon/premise.md',markdown('blob'),'text/markdown');const prepared=await repo.prepare(op.id,{phase:'idle',day:null,lastSettledDay:null});const tree=JSON.parse(fs.readFileSync(path.join(f.root,'objects','trees','sha256',`${prepared.targetRootTreeHash}.json`),'utf8'));fs.rmSync(path.join(f.root,'objects','blobs','sha256',tree.entries[0].blobHash));await assert.rejects(repo.publish(op.id),/missing/);assert.equal((await repo.readCurrent()).status,'uninitialized');
});

test('GC recomputes prepared roots after a stale dry-run',async(t)=>{
  const f=fixture('gc-race');t.after(f.cleanup);const repo=createArchiveV2Repository({worldRoot:f.root});const content=markdown('reused'),orphan=crypto.createHash('sha256').update(content).digest('hex');fs.mkdirSync(path.join(f.root,'objects','blobs','sha256'),{recursive:true});fs.writeFileSync(path.join(f.root,'objects','blobs','sha256',orphan),content);const dry=await repo.collectGarbage();assert.ok(dry.candidates.some(x=>x.includes(orphan)));const op=await repo.beginWorldOperation({type:'init'});await repo.stageManifest(op.id,{worldId:'world_gc_race',title:'GC'});await repo.putDocument(op.id,'canon/premise.md',content,'text/markdown');await repo.prepare(op.id,{phase:'idle',day:null,lastSettledDay:null});const deleted=await repo.collectGarbage({delete:true});assert.equal(fs.existsSync(path.join(f.root,'objects','blobs','sha256',orphan)),true);assert.equal(deleted.deleted.some(x=>x.includes(orphan)),false);
});

test('restart marks an unfinished durable Session interrupted and preserves workspace',async(t)=>{
  const f=fixture('restart-interrupted');t.after(f.cleanup);const repo=createArchiveV2Repository({worldRoot:f.root});const session=await repo.createSession({kind:'init'});const workspace=repo.sessionWorkspace(session.archiveOperationId);await workspace.writeCheckpoint({step:1});await workspace.appendTranscript({sequence:1,role:'user',text:'hello',messageId:null});const restarted=createArchiveV2Repository({worldRoot:f.root});await restarted.reconcileSessions();assert.equal((await restarted.readActiveSession()),null);const raw=JSON.parse(fs.readFileSync(path.join(f.root,'operations',session.archiveOperationId,'workspace','session.json'),'utf8'));assert.equal(raw.status,'interrupted');assert.deepEqual(await restarted.sessionWorkspace(session.archiveOperationId).readCheckpoint(),{step:1});assert.equal((await restarted.readOperation(session.archiveOperationId)).status,'open');
});

test('cross-process Session claim admits only one active Session',async(t)=>{
  const f=fixture('session-claim');t.after(f.cleanup);const a=createArchiveV2Repository({worldRoot:f.root}),b=createArchiveV2Repository({worldRoot:f.root});const results=await Promise.allSettled([a.createSession({kind:'init'}),b.createSession({kind:'init'})]);assert.equal(results.filter(x=>x.status==='fulfilled').length,1);assert.equal(results.filter(x=>x.status==='rejected').length,1);
});

test('immutable object and manifest publication retries leave no partial final file',async(t)=>{
  const f=fixture('immutable-atomic');t.after(f.cleanup);const injected=createFailureFilesystem(new NodeCoreFileSystem()),repo=createArchiveV2Repository({worldRoot:f.root,filesystem:injected.filesystem});const op=await repo.beginWorldOperation({type:'init'});await repo.stageManifest(op.id,{worldId:'world_atomic',title:'Atomic'});const content=markdown('atomic'),hash=crypto.createHash('sha256').update(content).digest('hex');await repo.putDocument(op.id,'canon/premise.md',content,'text/markdown');injected.failNext('link',new Error('blob link failed'),(_source,target)=>target.endsWith(hash));await assert.rejects(repo.prepare(op.id,{phase:'idle',day:null,lastSettledDay:null}),/blob link failed/);assert.equal(fs.existsSync(path.join(f.root,'objects','blobs','sha256',hash)),false);await repo.prepare(op.id,{phase:'idle',day:null,lastSettledDay:null});injected.failNext('link',new Error('manifest link failed'),(_source,target)=>target.endsWith('manifest.json'));await assert.rejects(repo.publish(op.id),/manifest link failed/);assert.equal(fs.existsSync(path.join(f.root,'manifest.json')),false);assert.equal((await repo.readCurrent()).status,'uninitialized');assert.equal((await repo.publish(op.id)).status,'ready');
});

test('inspect rejects a malformed prepared graph instead of rooting it',async(t)=>{
  const f=fixture('inspect-graph');t.after(f.cleanup);const repo=createArchiveV2Repository({worldRoot:f.root});const op=await repo.beginWorldOperation({type:'init'});await repo.stageManifest(op.id,{worldId:'world_inspect',title:'Inspect'});await repo.putDocument(op.id,'canon/premise.md',markdown('inspect'),'text/markdown');const prepared=await repo.prepare(op.id,{phase:'idle',day:null,lastSettledDay:null});const tree=JSON.parse(fs.readFileSync(path.join(f.root,'objects','trees','sha256',`${prepared.targetRootTreeHash}.json`),'utf8'));fs.rmSync(path.join(f.root,'objects','blobs','sha256',tree.entries[0].blobHash));const inspection=await repo.inspect();const result=inspection.operations.find(x=>x.id===op.id);assert.ok(result.error);assert.equal(inspection.preparedCommits.includes(prepared.targetCommitId),false);
});

test('physical symlink escape is rejected',async(t)=>{
  const f=fixture('symlink-root'),outside=fixture('symlink-outside');t.after(f.cleanup);t.after(outside.cleanup);fs.symlinkSync(outside.root,path.join(f.root,'operations'),'junction');const repo=createArchiveV2Repository({worldRoot:f.root});await assert.rejects(repo.beginWorldOperation({type:'init'}),error=>error.code==='ARCHIVE_REFERENCE_INVALID'&&/outside the world root/.test(error.message));
});

test('published graph remains readable when diagnostic operation metadata is corrupt',async(t)=>{
  const f=fixture('diagnostic-only');t.after(f.cleanup);const repo=createArchiveV2Repository({worldRoot:f.root});const op=await repo.beginWorldOperation({type:'init'});await repo.stageManifest(op.id,{worldId:'world_diagnostic',title:'Diagnostic'});await repo.putDocument(op.id,'canon/premise.md',markdown('valid graph'),'text/markdown');await repo.prepare(op.id,{phase:'idle',day:null,lastSettledDay:null});await repo.publish(op.id);fs.writeFileSync(path.join(f.root,'operations',op.id,'operation.json'),'{broken');const read=await repo.readCurrent();assert.equal(read.status,'ready');assert.equal(new TextDecoder().decode(await repo.readPublishedDocument('canon/premise.md')),'valid graph');
});
