const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { dailyFromProposal } = require('../../dist/daily/index.js');
const { validateDailyPlan } = require('../../dist/daily/validate-plan.js');

function tempDir() { return fs.mkdtempSync(path.join(os.tmpdir(), 'day-loom-daily-')); }
function createWorld(phase = 'idle') {
  const root = tempDir();
  fs.mkdirSync(path.join(root, 'days'), { recursive: true });
  fs.mkdirSync(path.join(root, 'logs'), { recursive: true });
  fs.writeFileSync(path.join(root, 'manifest.yaml'), 'id: test_world\n', 'utf8');
  fs.writeFileSync(path.join(root, 'current.yaml'), `day: day_0001\nphase: ${phase}\nlast_committed_day: null\n`, 'utf8');
  fs.writeFileSync(path.join(root, 'logs', 'state_changes.jsonl'), '', 'utf8');
  return root;
}
function plan(overrides = {}) { return { day: 'day_0001', user_intent: 'Go to the market.', known_context: [], constraints: [], planned_beats: [{ id: 'beat_01', intent: 'Reach the market', priority: 'required', status: 'tentative' }], open_questions: [], max_events: 5, ...overrides }; }
function writePlan(root, value) { const file = path.join(root, 'daily-plan.json'); fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8'); return file; }

test('validateDailyPlan rejects empty intent and too many beats', () => {
  assert.throws(() => validateDailyPlan(plan({ user_intent: '' }), 'day_0001'), /user_intent/);
  assert.throws(() => validateDailyPlan(plan({ planned_beats: Array.from({ length: 6 }, (_, i) => ({ id: `beat_0${i + 1}`, intent: 'x', priority: 'optional', status: 'tentative' })) }), 'day_0001'), /1 to 5/);
});

test('validateDailyPlan rejects result-like fields', () => {
  assert.throws(() => validateDailyPlan(plan({ planned_beats: [{ id: 'beat_01', intent: 'x', priority: 'required', status: 'tentative', outcome: 'win' }] }), 'day_0001'), /forbidden result field/);
});

test('dailyFromProposal dry run does not write day files', () => {
  const root = createWorld();
  const proposal = writePlan(root, plan());
  const result = dailyFromProposal(root, proposal, { dryRun: true });
  assert.equal(result.applied, false);
  assert.match(result.description, /create days\/day_0001\/plan.initial.json/);
  assert.equal(fs.existsSync(path.join(root, 'days', 'day_0001')), false);
  assert.match(fs.readFileSync(path.join(root, 'current.yaml'), 'utf8'), /phase: idle/);
  fs.rmSync(root, { recursive: true, force: true });
});

test('dailyFromProposal applies plan and updates current phase', () => {
  const root = createWorld();
  const proposal = writePlan(root, plan());
  const result = dailyFromProposal(root, proposal, { yes: true });
  assert.equal(result.applied, true);
  assert.equal(JSON.parse(fs.readFileSync(path.join(root, 'days', 'day_0001', 'plan.initial.json'), 'utf8')).user_intent, 'Go to the market.');
  assert.match(fs.readFileSync(path.join(root, 'current.yaml'), 'utf8'), /phase: planned/);
  assert.match(fs.readFileSync(path.join(root, 'logs', 'state_changes.jsonl'), 'utf8'), /daily_plan_created/);
  fs.rmSync(root, { recursive: true, force: true });
});

test('dailyFromProposal refuses non-idle phase and mismatched day', () => {
  const root = createWorld('planned');
  const proposal = writePlan(root, plan());
  assert.throws(() => dailyFromProposal(root, proposal, { yes: true }), /phase idle/);
  fs.rmSync(root, { recursive: true, force: true });

  const root2 = createWorld();
  const proposal2 = writePlan(root2, plan({ day: 'day_0002' }));
  assert.throws(() => dailyFromProposal(root2, proposal2, { yes: true }), /day mismatch/);
  fs.rmSync(root2, { recursive: true, force: true });
});

test('daily proposal preserves last committed day when planning day two', () => {
  const root = createWorld();
  fs.writeFileSync(path.join(root, 'current.yaml'), 'day: day_0002\nphase: idle\nlast_committed_day: day_0001\n', 'utf8');
  const proposal = writePlan(root, plan({ day: 'day_0002' }));
  const result = dailyFromProposal(root, proposal, { yes: true });
  assert.equal(result.applied, true);
  assert.match(fs.readFileSync(path.join(root, 'current.yaml'), 'utf8'), /day: day_0002\nphase: planned\nlast_committed_day: day_0001/);
  assert.equal(JSON.parse(fs.readFileSync(path.join(root, 'days', 'day_0002', 'plan.initial.json'), 'utf8')).day, 'day_0002');
  fs.rmSync(root, { recursive: true, force: true });
});
