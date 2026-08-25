const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createDayloomCoreInternal } = require('../dist/core');
const { resolvePackagedBoundaries } = require('../dist/promptpile/binaries');
const { CoreInitializationError } = require('../dist/errors');
const { FakeRunner } = require('./helpers');

const temporary = (t) => { const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dayloom-core-draft-')); t.after(() => fs.rmSync(root, { recursive: true, force: true })); return root; };

test('Core persists Draft, reports lint diagnostics, restores ready, and enforces one writer', async (t) => {
  const root = temporary(t), worldRoot = path.join(root, 'world'), runtimeRoot = path.join(root, 'runtime'), config = path.join(root, 'llm.toml'); fs.writeFileSync(config, '[[llm_api]]\nname="test"\nmodel="test"\n');
  const options = { worldRoot, runtimeRoot, llmConfigPath: config }, internal = { runner: new FakeRunner(), boundaries: await resolvePackagedBoundaries() };
  const core = await createDayloomCoreInternal(options, internal); t.after(() => core.dispose());
  await assert.rejects(() => createDayloomCoreInternal(options, internal), (error) => error instanceof CoreInitializationError && error.code === 'WORLD_BUSY');
  assert.deepEqual(await core.startSession('init'), { ok: true }); const events = []; core.subscribe((event) => events.push(event));
  const result = await core.submit(); assert.equal(result.ok, false); assert.equal(result.error.code, 'DRAFT_INVALID'); assert.ok(result.error.diagnostics.length > 0); assert.equal(core.getState().session.status, 'ready');
  const sequence = events.filter((event) => ['submission.diagnostics', 'work.failed'].includes(event.type) || event.type === 'state.changed' && event.state.session?.status === 'ready').map((event) => event.type);
  const diagnosticsIndex = sequence.indexOf('submission.diagnostics'); assert.deepEqual(sequence.slice(diagnosticsIndex, diagnosticsIndex + 3), ['submission.diagnostics', 'work.failed', 'state.changed']);
  const draftFiles = [...walk(path.join(runtimeRoot, 'drafts/active'))]; assert.ok(draftFiles.some((item) => item.endsWith('draft.yaml'))); assert.ok(draftFiles.some((item) => item.endsWith('diagnostics.json')));
  assert.deepEqual(await core.cancel(), { ok: true }); assert.equal(core.getState().session, null); assert.equal(fs.existsSync(path.join(runtimeRoot, 'drafts')), true);
  await core.dispose(); assert.equal(fs.existsSync(path.join(runtimeRoot, 'drafts')), true); assert.equal(fs.existsSync(path.join(runtimeRoot, 'world.lock')), false);
  const restarted = await createDayloomCoreInternal(options, internal); await restarted.dispose();
});

function* walk(root) { if (!fs.existsSync(root)) return; for (const entry of fs.readdirSync(root, { withFileTypes: true })) { const target = path.join(root, entry.name); if (entry.isDirectory()) yield* walk(target); else yield target; } }
