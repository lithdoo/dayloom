const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const TOML = require('@iarna/toml');
const { allocateSessionAssignmentV1 } = require('../dist/session/assignment');
const { assertSessionCandidatePathAllowedV1 } = require('../dist/world/candidate');
const { writeReactConfig, readCallerConfig } = require('../dist/promptpile/config');
const { createInitWorkspace } = require('../dist/session/lifecycle');

const hash = { 'draft.yaml': 'a'.repeat(64) };
test('deterministic assignment covers all four Session kinds', () => {
  const init = allocateSessionAssignmentV1({ schemaVersion: 1, kind: 'init', characters: [{ key: 'hero' }], locations: [{ key: 'home', triggers: [{}] }], arcs: [{ key: 'main' }], initialFacts: [{}], unresolvedThreads: [{}], storySeeds: [{}] }, hash, null);
  assert.deepEqual(init.ids, { 'character:hero': 'character1', 'location:home': 'location1', 'arc:main': 'arc1', 'fact:1': 'fact1', 'thread:1': 'thread1', 'seed:1': 'seed1', 'trigger:home:1': 'trigger1' });
  assert.deepEqual(allocateSessionAssignmentV1({ schemaVersion: 1, kind: 'planning', beats: [{ key: 'opening' }, { key: 'choice' }] }, hash, null).ids, { 'beat:opening': 'beat1', 'beat:choice': 'beat2' });
  assert.deepEqual(allocateSessionAssignmentV1({ schemaVersion: 1, kind: 'play', events: [{ key: 'e001' }, { key: 'e002' }] }, hash, null).ids, { 'event:e001': 'event1', 'event:e002': 'event2' });
  const base = { commit: { rootTreeHash: 'b'.repeat(64) }, profileV1: { characterIds: ['character1', 'character3'], locationIds: ['location2'], arcIds: [] } };
  const reserved = new Set(['character2', 'location1', 'arc1', 'seed1']);
  assert.deepEqual(allocateSessionAssignmentV1({ schemaVersion: 1, kind: 'revise', operations: [{ op: 'create-character' }, { op: 'create-location' }, { op: 'create-arc' }, { op: 'add-story-seed' }] }, hash, base, reserved).ids, { 'operation:1': 'character4', 'operation:2': 'location3', 'operation:3': 'arc2', 'operation:4': 'seed2' });
});

test('operation path matrix is closed for all Session kinds', () => {
  assert.equal(assertSessionCandidatePathAllowedV1('init', 'canon/premise.md', null), 'canon/premise.md');
  assert.equal(assertSessionCandidatePathAllowedV1('planning', 'days/day2/plan.json', 'day2'), 'days/day2/plan.json');
  assert.equal(assertSessionCandidatePathAllowedV1('play', 'days/day2/events/event1/result.yaml', 'day2'), 'days/day2/events/event1/result.yaml');
  assert.equal(assertSessionCandidatePathAllowedV1('revise', 'canon/style.md', null, new Set(['canon/style.md'])), 'canon/style.md');
  for (const args of [['init', 'days/day1/plan.json', null], ['planning', 'days/day1/plan.json', 'day2'], ['play', 'days/day2/summary.md', 'day2'], ['revise', 'canon/style.md', null, new Set()]]) assert.throws(() => assertSessionCandidatePathAllowedV1(...args));
});

test('session prompts are UTF-8 Chinese and workspace owns one visible Final config', async (t) => {
  const promptRoot = path.resolve(__dirname, '../src/session/prompts');
  for (const target of walk(promptRoot)) { const value = fs.readFileSync(target, 'utf8'); assert.doesNotMatch(value, /(?:銆|锛|绔嬪嵆|SubmissionV2)/, target); if (target.endsWith('.ts') && path.basename(target) !== 'index.ts') assert.match(value, /[\u4e00-\u9fff]/, target); }
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dayloom-contract-')); t.after(() => fs.rmSync(root, { recursive: true, force: true })); const caller = path.join(root, 'llm.toml'); fs.writeFileSync(caller, '[[llm_api]]\nname="test"\nmodel="test"\n');
  const config = await readCallerConfig(caller), workspace = await createInitWorkspace(root, 'session', config);
  assert.equal(fs.existsSync(path.join(workspace.root, 'react/final.md')), true); assert.equal(fs.existsSync(path.join(workspace.root, 'react/final-submit.md')), false); assert.equal('submitMarker' in workspace, false); assert.equal('submitConfig' in workspace, false);
  const derived = path.join(root, 'single.toml'); await writeReactConfig(config, { thoughtPrompt: 'thought', observePrompt: 'observe', checkPrompt: 'check', toolsFile: 'tools', finalPrompt: 'final', config: derived });
  assert.deepEqual(TOML.parse(fs.readFileSync(derived, 'utf8'))['promptpile-react'], {
    tools_file: 'tools', thought_prompt: 'thought', observe_prompt: 'observe', check_prompt: 'check', final_prompt: 'final',
    observe_llm_api_temperature: 0, check_llm_api_temperature: 0,
  });
});
function* walk(root) { for (const entry of fs.readdirSync(root, { withFileTypes: true })) { const target = path.join(root, entry.name); if (entry.isDirectory()) yield* walk(target); else yield target; } }
