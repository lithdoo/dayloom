const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  INITIAL_BRIEF_V2, INITIAL_EVIDENCE_V2, hashMarkdownDraftV2,
  anchorAcceptedUserIntentV2, materializeMarkdownDraftSnapshotV2, renderEvidenceBlockV1, renderLegacyDraftImportV1, technicalCheckMarkdownDraftV2,
} = require('../dist/session/markdown-draft-snapshot');
const { compareAndSwapAggregateHeadV1, installAggregateHeadV1, readAggregateHeadV1 } = require('../dist/session/aggregate-head');

const temporary = (t) => { const root = fs.mkdtempSync(path.join(os.tmpdir(), 'markdown-draft-v2-')); t.after(() => fs.rmSync(root, { recursive: true, force: true })); return root; };
const meta = Object.freeze({ schemaVersion: 2, draftId: 'draft_one', sourceFormat: 'markdown-v2', kind: 'revise', worldIdentity: 'world_one', baseCommitId: 'commit_one', baseRootTreeHash: '1'.repeat(64), targetDay: null, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' });

test('evidence renderer preserves exact UTF-8 bytes and chooses the shortest safe fence', () => {
  const input = { turnId: 'turn_one', generationId: 'generation_one', userInput: 'a```b~~\r\n中', acceptedResponse: '', curatorNote: 'kept' };
  const rendered = Buffer.from(renderEvidenceBlockV1(input));
  const text = rendered.toString('utf8');
  assert.match(text, /### user-input\n\nBytes: 12\nSHA-256: [0-9a-f]{64}\n\n~~~text\na```b~~\r\n中\n~~~\n/);
  assert.match(text, /### accepted-response\n\nBytes: 0\nSHA-256: e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855\n\n```text\n\n```\n/);
  assert.equal(rendered.subarray(rendered.indexOf(Buffer.from('a```b')),
    rendered.indexOf(Buffer.from('a```b')) + Buffer.byteLength(input.userInput)).equals(Buffer.from(input.userInput)), true);
});

test('accepted user intent is deterministically anchored as natural Markdown before AI curation',()=>{
  const anchored=anchorAcceptedUserIntentV2(Buffer.from('# Dayloom Draft Brief\n'),'科幻\r\n太空歌剧').toString('utf8');
  assert.equal(anchored,'# Dayloom Draft Brief\n\n## Accepted user intent\n\n> 科幻\n> 太空歌剧\n');
});

test('Legacy Draft renderer is deterministic, lossless, and records source hashes', () => {
  const yaml = Buffer.from('kind: revise\r\nvalue: ```\r\n'), markdown = Buffer.from('~ raw\n');
  const rendered = renderLegacyDraftImportV1([{ path: 'draft.yaml', content: yaml }, { path: 'content/note.md', content: markdown }]);
  assert.equal(Buffer.from(rendered.brief).includes(yaml), true);
  assert.equal(Buffer.from(rendered.brief).includes(markdown), true);
  assert.equal(rendered.manifest[0].path, 'draft.yaml');
  assert.match(Buffer.from(rendered.evidence).toString(), /## Legacy Import/);
  assert.throws(() => renderLegacyDraftImportV1([{ path: 'draft.yaml', content: yaml }, { path: 'content\/..\/escape.md', content: markdown }]), /Invalid Legacy/);
});

test('canonical Draft hash uses path/content length framing and rejects invalid bytes', () => {
  const brief = Buffer.from('brief\r\n'), evidence = Buffer.from('evidence\n');
  const expected = crypto.createHash('sha256');
  for (const [name, content] of [['brief.md', brief], ['evidence.md', evidence]]) {
    const nameBytes = Buffer.from(name), nameLength = Buffer.alloc(4), contentLength = Buffer.alloc(8);
    nameLength.writeUInt32BE(nameBytes.length); contentLength.writeBigUInt64BE(BigInt(content.length));
    expected.update(nameLength).update(nameBytes).update(contentLength).update(content);
  }
  assert.equal(hashMarkdownDraftV2(brief, evidence), expected.digest('hex'));
  assert.throws(() => hashMarkdownDraftV2(Buffer.from([0]), evidence), /NUL/);
  assert.throws(() => hashMarkdownDraftV2(Buffer.from([0xff]), evidence), /UTF-8/);
});

test('immutable snapshots are content-addressed and technical check enforces only byte-level promotion rules', async (t) => {
  const slotRoot = temporary(t), base = await materializeMarkdownDraftSnapshotV2({ slotRoot, draftId: meta.draftId, meta, brief: Buffer.from(INITIAL_BRIEF_V2), evidence: Buffer.from(INITIAL_EVIDENCE_V2) });
  const block = renderEvidenceBlockV1({ turnId: 'turn_one', generationId: 'generation_one', userInput: 'change it', acceptedResponse: 'proposed change', curatorNote: 'brief updated' });
  const candidate = await materializeMarkdownDraftSnapshotV2({ slotRoot, draftId: meta.draftId, meta, brief: Buffer.from(`${INITIAL_BRIEF_V2}New intent.\n`), evidence: Buffer.concat([Buffer.from(INITIAL_EVIDENCE_V2), block]) });
  assert.equal((await technicalCheckMarkdownDraftV2({ base, candidate, expectedEvidenceBlock: block, currentHeadHash: base.hash })).ok, true);
  const conflict = await technicalCheckMarkdownDraftV2({ base, candidate, expectedEvidenceBlock: block, currentHeadHash: candidate.hash });
  assert.equal(conflict.ok, false); assert.equal(conflict.diagnostics[0].code, 'DRAFT_CONFLICT');
  assert.deepEqual(fs.readdirSync(candidate.root).sort(), ['brief.md', 'evidence.md']);
});

test('Aggregate Head install and CAS validate immutable references and revision', async (t) => {
  const slotRoot = temporary(t), snapshot = await materializeMarkdownDraftSnapshotV2({ slotRoot, draftId: meta.draftId, meta, brief: Buffer.from(INITIAL_BRIEF_V2), evidence: Buffer.from(INITIAL_EVIDENCE_V2) });
  await installAggregateHeadV1({ slotRoot, head: { schemaVersion: 1, revision: 0, draftHash: snapshot.hash, activeSession: null } });
  const next = { schemaVersion: 1, revision: 1, draftHash: snapshot.hash, activeSession: null };
  assert.equal((await compareAndSwapAggregateHeadV1({ slotRoot, expectedRevision: 0, next })).revision, 1);
  await assert.rejects(() => compareAndSwapAggregateHeadV1({ slotRoot, expectedRevision: 0, next }), (error) => error.code === 'DRAFT_CONFLICT');
  assert.equal((await readAggregateHeadV1(slotRoot)).draftHash, snapshot.hash);
  assert.deepEqual(fs.readdirSync(slotRoot).filter((name) => name.includes('.tmp-')), []);
});

test('Aggregate Head CAS linearizes concurrent writers in one runtime', async (t) => {
  const slotRoot=temporary(t),snapshot=await materializeMarkdownDraftSnapshotV2({slotRoot,draftId:meta.draftId,meta,brief:Buffer.from(INITIAL_BRIEF_V2),evidence:Buffer.from(INITIAL_EVIDENCE_V2)});
  await installAggregateHeadV1({slotRoot,head:{schemaVersion:1,revision:0,draftHash:snapshot.hash,activeSession:null}});
  const next={schemaVersion:1,revision:1,draftHash:snapshot.hash,activeSession:null};
  const results=await Promise.allSettled([compareAndSwapAggregateHeadV1({slotRoot,expectedRevision:0,next}),compareAndSwapAggregateHeadV1({slotRoot,expectedRevision:0,next})]);
  assert.equal(results.filter((item)=>item.status==='fulfilled').length,1);assert.equal(results.filter((item)=>item.status==='rejected'&&item.reason.code==='DRAFT_CONFLICT').length,1);
});
