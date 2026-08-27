const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { openDraftV2 } = require('../dist/session/draft-store-v2');
const { INITIAL_BRIEF_V2, materializeMarkdownDraftSnapshotV2 } = require('../dist/session/markdown-draft-snapshot');
const { compareAndSwapAggregateHeadV1 } = require('../dist/session/aggregate-head');
const { writeTurnRecordV1, readTurnRecordV1 } = require('../dist/session/turn-record');

const temporary = (t) => { const root = fs.mkdtempSync(path.join(os.tmpdir(), 'draft-store-v2-')); t.after(() => fs.rmSync(root, { recursive: true, force: true })); return root; };
const input = (runtimeRoot) => ({ runtimeRoot, kind: 'revise', worldIdentity: 'world1', baseCommitId: 'commit1', baseRootTreeHash: '1'.repeat(64), targetDay: null });

test('DraftStore V2 creates and resumes one immutable Markdown aggregate', async (t) => {
  const runtimeRoot = temporary(t), first = await openDraftV2(input(runtimeRoot)), snapshot = await first.snapshot(), second = await openDraftV2(input(runtimeRoot));
  assert.equal(second.id, first.id); assert.equal((await second.head()).draftHash, snapshot.hash);
  assert.equal(fs.readFileSync(path.join(snapshot.root, 'brief.md'), 'utf8'), INITIAL_BRIEF_V2);
  assert.deepEqual(fs.readdirSync(snapshot.root).sort(), ['brief.md', 'evidence.md']);
});

test('DraftStore V2 mechanically migrates Legacy YAML without changing source bytes', async (t) => {
  const runtimeRoot=temporary(t),request=input(runtimeRoot),identity=`${request.worldIdentity}\0${request.kind}\0global`,slot=createHash('sha256').update(identity).digest('hex'),legacyRoot=path.join(runtimeRoot,'drafts','active',slot),now='2026-01-01T00:00:00.000Z';
  fs.mkdirSync(path.join(legacyRoot,'content'),{recursive:true});
  fs.writeFileSync(path.join(legacyRoot,'meta.json'),`${JSON.stringify({schemaVersion:1,draftId:'legacy1',kind:request.kind,worldIdentity:request.worldIdentity,baseCommitId:request.baseCommitId,baseRootTreeHash:request.baseRootTreeHash,targetDay:null,status:'active',createdAt:now,updatedAt:now},null,2)}\n`);
  fs.writeFileSync(path.join(legacyRoot,'draft.yaml'),'schemaVersion: 1\nkind: revise\noperations: []\n');
  fs.writeFileSync(path.join(legacyRoot,'content','note.md'),'raw```\r\n中');
  fs.writeFileSync(path.join(legacyRoot,'diagnostics.json'),'[]\n');
  const yaml = fs.readFileSync(path.join(legacyRoot, 'draft.yaml'));
  const migrated = await openDraftV2(input(runtimeRoot)), snapshot = await migrated.snapshot(), brief = fs.readFileSync(path.join(snapshot.root, 'brief.md'));
  assert.equal(brief.includes(yaml), true); assert.equal(brief.includes(Buffer.from('raw```\r\n中')), true);
  assert.equal(migrated.meta().sourceFormat, 'submission-v1-import');
  assert.equal(fs.existsSync(path.join(migrated.root, 'draft.yaml')), false);
  assert.equal(fs.existsSync(path.join(migrated.root, 'legacy-v1', 'draft.yaml')), true);
});

test('DraftStore V2 recovery removes every artifact not referenced by Aggregate Head', async (t) => {
  const runtimeRoot = temporary(t), draft = await openDraftV2(input(runtimeRoot)), current = await draft.snapshot();
  const orphan = await materializeMarkdownDraftSnapshotV2({ slotRoot: draft.root, draftId: draft.id, meta: draft.meta(), brief: Buffer.from(`${INITIAL_BRIEF_V2}orphan\n`), evidence: fs.readFileSync(path.join(current.root, 'evidence.md')) });
  const orphanSession = path.join(draft.root, 'sessions', 'session_orphan');
  fs.mkdirSync(path.join(orphanSession, 'conversations', 'conv_orphan'), { recursive: true });
  await openDraftV2(input(runtimeRoot));
  assert.equal(fs.existsSync(orphan.root), false);
  assert.equal(fs.existsSync(orphanSession), false);
  assert.equal(fs.existsSync(path.join(runtimeRoot, 'drafts', 'abandoned-sessions', 'session_orphan')), true);
  assert.equal(fs.existsSync(current.root), true);
});

test('DraftStore V2 fails closed on malformed V2 meta', async (t) => {
  const runtimeRoot = temporary(t), draft = await openDraftV2(input(runtimeRoot));
  const metaPath = path.join(draft.root, 'meta.json'), meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
  fs.writeFileSync(metaPath, JSON.stringify({ ...meta, unexpected: true }));
  await assert.rejects(() => openDraftV2(input(runtimeRoot)), /unknown or missing fields/);
});

test('recovery completes a Turn record when Commit B is already authoritative', async (t) => {
  const runtimeRoot=temporary(t),draft=await openDraftV2(input(runtimeRoot)),base=await draft.snapshot(),sessionId='session1',conversationId='conv1',turnId='turn1',generationId='generation1';
  const sessionRoot=path.join(draft.root,'sessions',sessionId);fs.mkdirSync(path.join(sessionRoot,'conversations',conversationId),{recursive:true});fs.mkdirSync(path.join(sessionRoot,'turns'),{recursive:true});
  let head=await compareAndSwapAggregateHeadV1({slotRoot:draft.root,expectedRevision:0,next:{schemaVersion:1,revision:1,draftHash:base.hash,activeSession:{sessionId,conversationId,pendingDraftSync:{turnId,acceptedGenerationId:generationId,baseDraftHash:base.hash,verdict:'UPDATE'}}}});
  const committed=await materializeMarkdownDraftSnapshotV2({slotRoot:draft.root,draftId:draft.id,meta:draft.meta(),brief:fs.readFileSync(path.join(base.root,'brief.md')),evidence:Buffer.concat([fs.readFileSync(path.join(base.root,'evidence.md')),Buffer.from(`## Turn \`${turnId}\`\n`)])});
  head=await compareAndSwapAggregateHeadV1({slotRoot:draft.root,expectedRevision:head.revision,next:{schemaVersion:1,revision:2,draftHash:committed.hash,activeSession:{sessionId,conversationId,pendingDraftSync:null}}});
  const recordPath=path.join(sessionRoot,'turns',`${turnId}.json`);await writeTurnRecordV1(recordPath,{schemaVersion:1,turnId,sessionId,userInput:'u',baseConversationId:conversationId,baseDraftHash:base.hash,generationAttempts:[{generationId,operationId:'operation1',attempt:1,responseText:'a',complete:true,disposition:'committed',verdict:{decision:'ACCEPT',draft:'UPDATE'}}],acceptedGenerationId:generationId,draftVerdict:'UPDATE',resultDraftHash:null,curationAttempts:[],terminalStatus:'draft-sync-pending'});
  await openDraftV2(input(runtimeRoot));const recovered=await readTurnRecordV1(recordPath);assert.equal(recovered.terminalStatus,'committed');assert.equal(recovered.resultDraftHash,head.draftHash);
});
