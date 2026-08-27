const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const TOML = require('@iarna/toml');
const { assertSessionCandidatePathAllowedV1 } = require('../dist/world/candidate');
const { writeReactConfig, readCallerConfig } = require('../dist/promptpile/config');
const { createInitWorkspace } = require('../dist/session/lifecycle');

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
