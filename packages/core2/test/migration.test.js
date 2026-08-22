const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { createDayloomCoreInternal } = require('../dist/core');
const { migrateLegacyWorldProfileV1 } = require('../dist/migration/migrate');
const { resolvePackagedBoundaries } = require('../dist/promptpile/binaries');
const { readPublishedWorld } = require('../dist/world/read');
const { FakeRunner } = require('./helpers');

function write(root, relative, text) { const target = path.join(root, ...relative.split('/')); fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, text); }
const planning = JSON.stringify({ version: 2, intent: 'Continue', knownContext: [], constraints: [], openQuestions: [], maxEvents: 1, beats: [{ key: 'continue', intent: 'Continue the world', priority: 'required', dependsOn: [] }] });
const play = JSON.stringify({ version: 2, events: [{ beatId: 'beat1', title: 'Continuation', locationId: null, participantIds: [], scene: 'The world continues.', dialogue: '', userAction: 'Continue.', result: { summary: 'A new fact emerged.', learnedFacts: ['The migration remained coherent.'], timeAdvanced: '1h', completedBeatIds: ['beat1'], skippedBeatIds: [], endDay: true }, proposedPatch: [{ op: 'set-world-variable', key: 'mood', expected: 'calm', value: 'hopeful' }] }] });

test('legacy filesystem migration inventories every file once and completes the restart lifecycle', async (t) => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'core2-migration-')), source = path.join(parent, 'legacy'), target = path.join(parent, 'archive'); t.after(() => fs.rmSync(parent, { recursive: true, force: true })); fs.mkdirSync(source);
  write(source, 'manifest.yaml', 'id: legacy_world\ntitle: Legacy World\n'); write(source, 'current.yaml', 'day: day_0001\nphase: idle\nlast_committed_day: null\n');
  write(source, 'canon/premise.md', 'Legacy premise'); write(source, 'canon/rules.md', 'Legacy rules'); write(source, 'canon/style.md', 'Legacy style'); write(source, 'canon/user_role.md', 'Legacy user');
  write(source, 'state/variables.yaml', 'variables:\n  mood: calm\n'); write(source, 'logs/generation_trace.md', 'trace preserved exactly'); write(source, '.loom/init-transcript/[1]user.md', 'original init words');
  const result = await migrateLegacyWorldProfileV1(source, target); const sourceFiles = fs.readdirSync(source, { recursive: true }).filter((name) => fs.statSync(path.join(source, name)).isFile());
  assert.equal(result.report.sourceFileCount, sourceFiles.length); assert.equal(result.report.entries.length, sourceFiles.length); assert.equal(new Set(result.report.entries.map((entry) => entry.sourcePath)).size, sourceFiles.length);
  assert.equal(result.world.canon.premise, 'Legacy premise'); assert.equal(result.world.profileV1.state.variables.mood, 'calm');
  const logEntry = result.report.entries.find((entry) => entry.sourcePath === 'logs/generation_trace.md'); assert.equal(logEntry.mode, 'legacy-preserve'); assert.equal(logEntry.sourceSha256, logEntry.targetSha256);

  const config = path.join(parent, 'llm.toml'); fs.writeFileSync(config, '[[llm_api]]\nname="test"\nmodel="test"\n'); const boundaries = await resolvePackagedBoundaries();
  const core = await createDayloomCoreInternal({ worldRoot: target, llmConfigPath: config }, { runner: new FakeRunner([planning, play]), boundaries }); await core.startSession('planning'); await core.submit(); await core.startSession('play'); await core.submit(); assert.deepEqual(await core.settle(), { ok: true }); await core.dispose();
  const restarted = await createDayloomCoreInternal({ worldRoot: target, llmConfigPath: config }, { runner: new FakeRunner([planning]), boundaries }); t.after(() => restarted.dispose()); assert.deepEqual(await restarted.startSession('planning'), { ok: true }); assert.deepEqual(await restarted.submit(), { ok: true });
  const final = await readPublishedWorld(target); assert.equal(final.commit.control.day, 'day2'); assert.equal(final.profileV1.state.variables.mood, 'hopeful'); assert.match(final.profileV1.contextDocuments['memory/facts.yaml'], /migration remained coherent/);
});

test('legacy migration rejects symlinks and overlapping source/target roots', async (t) => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'core2-migration-guard-')), source = path.join(parent, 'source'); fs.mkdirSync(source); write(source, 'manifest.yaml', 'id: x\n'); t.after(() => fs.rmSync(parent, { recursive: true, force: true }));
  await assert.rejects(() => migrateLegacyWorldProfileV1(source, path.join(source, 'target')), /disjoint/);
});
