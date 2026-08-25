const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const YAML = require('yaml');
const { openDraftV1 } = require('../dist/session/draft-store');
const { acquireWorldRuntimeLockV1 } = require('../dist/session/runtime-lock');

const temporary = (t, prefix) => { const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix)); t.after(() => fs.rmSync(root, { recursive: true, force: true })); return root; };

test('DraftStore creates a valid skeleton, resumes it, and atomically persists status and diagnostics', async (t) => {
  const runtimeRoot = temporary(t, 'draft-store-'), input = { runtimeRoot, kind: 'planning', worldIdentity: 'world1', baseCommitId: 'commit1', baseRootTreeHash: 'a'.repeat(64), targetDay: 'day2' };
  const first = await openDraftV1(input), lint = await first.lint();
  assert.equal(lint.ok, true); assert.equal(lint.draft.kind, 'planning'); assert.equal(lint.draft.targetDay, 'day2');
  await first.setStatus('submit-failed'); await first.writeDiagnostics([{ schemaVersion: 1, stage: 'draft', severity: 'error', code: 'X', path: null, constraint: 'x' }]);
  const resumed = await openDraftV1(input);
  assert.equal(resumed.id, first.id); assert.equal(resumed.meta().status, 'submit-failed');
  assert.equal(JSON.parse(fs.readFileSync(path.join(first.root, 'diagnostics.json'), 'utf8'))[0].code, 'X');
  assert.deepEqual(fs.readdirSync(path.dirname(first.root)).filter((name) => name.includes('.tmp-')), []);
});

test('DraftStore preserves a stale baseline and creates a fresh Draft without rebasing', async (t) => {
  const runtimeRoot = temporary(t, 'draft-stale-'), common = { runtimeRoot, kind: 'revise', worldIdentity: 'world1', targetDay: null };
  const first = await openDraftV1({ ...common, baseCommitId: 'commit1', baseRootTreeHash: '1'.repeat(64) });
  fs.writeFileSync(path.join(first.root, 'content', 'user-work.md'), 'keep me');
  const second = await openDraftV1({ ...common, baseCommitId: 'commit2', baseRootTreeHash: '2'.repeat(64) });
  assert.notEqual(second.id, first.id);
  const staleRoot = path.join(runtimeRoot, 'drafts', 'stale'), stale = fs.readdirSync(staleRoot);
  assert.equal(stale.length, 1); assert.equal(fs.readFileSync(path.join(staleRoot, stale[0], 'content', 'user-work.md'), 'utf8'), 'keep me');
});

test('Draft lint rejects unknown keys, non-previous Beat dependencies, and missing Markdown', async (t) => {
  const runtimeRoot = temporary(t, 'draft-lint-'), draft = await openDraftV1({ runtimeRoot, kind: 'planning', worldIdentity: 'world1', baseCommitId: 'commit1', baseRootTreeHash: '1'.repeat(64), targetDay: 'day1' });
  const value = YAML.parse(fs.readFileSync(path.join(draft.root, 'draft.yaml'), 'utf8'));
  value.extra = true; value.beats = [{ decision: 'confirmed', key: 'second', intent: 'x', priority: 'required', dependsOn: ['missing'] }];
  fs.writeFileSync(path.join(draft.root, 'draft.yaml'), YAML.stringify(value));
  const lint = await draft.lint(); assert.equal(lint.ok, false);
  assert.ok(lint.diagnostics.some((item) => item.code === 'DRAFT_EXACT_KEYS'));
  assert.ok(lint.diagnostics.some((item) => item.code === 'DRAFT_DEPENDENCY'));
});

test('successful Draft archive is immutable-by-location and removes the active slot', async (t) => {
  const runtimeRoot = temporary(t, 'draft-archive-'), input = { runtimeRoot, kind: 'play', worldIdentity: 'world1', baseCommitId: 'commit1', baseRootTreeHash: '1'.repeat(64), targetDay: 'day1' };
  const draft = await openDraftV1(input), archived = await draft.archive();
  assert.equal(fs.existsSync(draft.root), false); assert.equal(fs.existsSync(path.join(archived, 'meta.json')), true);
  assert.equal(JSON.parse(fs.readFileSync(path.join(archived, 'meta.json'), 'utf8')).status, 'archived');
  const fresh = await openDraftV1(input); assert.notEqual(fresh.id, draft.id);
});

test('World runtime lock enforces one writer and recovers a same-host dead owner', async (t) => {
  const runtimeRoot = temporary(t, 'world-lock-'), first = await acquireWorldRuntimeLockV1(runtimeRoot);
  await assert.rejects(() => acquireWorldRuntimeLockV1(runtimeRoot), (error) => error.code === 'WORLD_BUSY');
  await first.release();
  fs.writeFileSync(path.join(runtimeRoot, 'world.lock'), JSON.stringify({ schemaVersion: 1, instanceId: 'dead', pid: 2147483647, hostname: os.hostname(), createdAt: new Date().toISOString() }));
  const recovered = await acquireWorldRuntimeLockV1(runtimeRoot);
  assert.equal(fs.readdirSync(path.join(runtimeRoot, 'transient', 'stale-locks')).length, 1);
  await recovered.release(); assert.equal(fs.existsSync(path.join(runtimeRoot, 'world.lock')), false);
});
