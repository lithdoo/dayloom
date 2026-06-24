const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { settleFromProposal } = require('../../dist/settle/index.js');
const { validateSettlementProposal, validateSettlementNarrative, nextDayId } = require('../../dist/settle/validate.js');
const { parseSettlementNarrative } = require('../../dist/settle/parse-assistant.js');
const { buildProgramSettlementProposal, readUnresolvedThreads } = require('../../dist/settle/derive.js');
const { buildSettlementPromptInput } = require('../../dist/settle/context.js');

function tempWorld(overrides = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'day-loom-settle-'));
  const dayRoot = path.join(root, 'days', 'day_0001');
  fs.mkdirSync(path.join(dayRoot, 'events', 'event_001'), { recursive: true });
  fs.mkdirSync(path.join(root, 'logs'), { recursive: true });
  fs.mkdirSync(path.join(root, 'state'), { recursive: true });
  fs.mkdirSync(path.join(root, 'memory'), { recursive: true });
  fs.mkdirSync(path.join(root, 'characters', 'char_alice'), { recursive: true });
  fs.writeFileSync(path.join(root, 'manifest.yaml'), 'id: test_world\n');
  fs.writeFileSync(path.join(root, 'current.yaml'), `day: day_0001\nphase: ${overrides.currentPhase || 'settling'}\nlast_committed_day: null\n`);
  fs.writeFileSync(path.join(dayRoot, 'meta.yaml'), `day: day_0001\nphase: ${overrides.dayPhase || 'settling'}\n`);
  fs.writeFileSync(path.join(dayRoot, 'plan.current.json'), JSON.stringify({
    day: 'day_0001', user_intent: 'test', revision: 1, max_events: 1,
    beats: [{ id: 'beat_01', intent: 'finish', priority: 'required', status: overrides.beatStatus || 'completed' }],
  }, null, 2));
  fs.writeFileSync(path.join(dayRoot, 'play.state.json'), JSON.stringify({
    version: 1, day: 'day_0001', phase: overrides.playPhase || 'settling', next_event_number: 2,
    active_event: null, active_beat: null, step: overrides.step || 'complete', completed_events: ['event_001'],
  }, null, 2));
  fs.writeFileSync(path.join(dayRoot, 'events', 'event_001', 'result.json'), '{}\n');
  fs.writeFileSync(path.join(root, 'state', 'variables.yaml'), 'water: running\n');
  fs.writeFileSync(path.join(root, 'state', 'world.yaml'), 'weather: clear\n');
  fs.writeFileSync(path.join(root, 'state', 'calendar.yaml'), 'day: 1\n');
  fs.writeFileSync(path.join(root, 'state', 'progress.yaml'), 'chapter: 1\n');
  fs.writeFileSync(path.join(root, 'memory', 'facts.yaml'), 'facts: []\n');
  fs.writeFileSync(path.join(root, 'memory', 'important_events.yaml'), 'events: []\n');
  fs.writeFileSync(path.join(root, 'memory', 'unresolved_threads.yaml'), 'threads: []\n');
  fs.writeFileSync(path.join(root, 'memory', 'short_term.md'), '# Recent\n');
  fs.writeFileSync(path.join(root, 'characters', 'char_alice', 'timeline.md'), '# Timeline\n');
  fs.writeFileSync(path.join(root, 'logs', 'state_changes.jsonl'), '');
  return root;
}

function proposal(overrides = {}) {
  return {
    version: 1,
    day: 'day_0001',
    summary: 'The first day ended safely.',
    diary: 'I made it through the day.',
    state_patch: [
      { op: 'replace', path: 'state/variables.yaml', content: 'water: interrupted' },
      { op: 'append', path: 'memory/short_term.md', content: 'Day 1: the water stopped.' },
      { op: 'append', path: 'characters/char_alice/timeline.md', content: '- day_0001: Helped investigate the outage.' },
    ],
    next_day_seed: {
      summary: 'Investigate the outage.',
      suggested_intents: ['Visit the pump station'],
      unresolved_threads: ['Who stopped the water?'],
    },
    ...overrides,
  };
}

function writeProposal(root, value = proposal()) {
  const file = path.join(root, 'settlement-proposal.json');
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
  return file;
}

function cleanup(root) { fs.rmSync(root, { recursive: true, force: true }); }

test('nextDayId increments a canonical day id', () => {
  assert.equal(nextDayId('day_0001'), 'day_0002');
  assert.equal(nextDayId('day_0099'), 'day_0100');
  assert.throws(() => nextDayId('day_9999'), /Cannot advance/);
});

test('settleFromProposal dry run describes changes without writing', () => {
  const root = tempWorld();
  try {
    const result = settleFromProposal(root, writeProposal(root), { dryRun: true });
    assert.equal(result.applied, false);
    assert.equal(result.nextDay, 'day_0002');
    assert.match(result.description, /create days\/day_0001\/summary.md/);
    assert.equal(fs.existsSync(path.join(root, 'days', 'day_0001', 'summary.md')), false);
    assert.match(fs.readFileSync(path.join(root, 'current.yaml'), 'utf8'), /phase: settling/);
  } finally { cleanup(root); }
});

test('settleFromProposal requires yes before applying', () => {
  const root = tempWorld();
  try {
    assert.throws(() => settleFromProposal(root, writeProposal(root)), /requires --yes/);
    assert.match(fs.readFileSync(path.join(root, 'current.yaml'), 'utf8'), /day: day_0001/);
  } finally { cleanup(root); }
});

test('settleFromProposal writes ending artifacts and advances to idle next day', () => {
  const root = tempWorld();
  try {
    const result = settleFromProposal(root, writeProposal(root), { yes: true });
    assert.equal(result.applied, true);
    const dayRoot = path.join(root, 'days', 'day_0001');
    assert.equal(fs.readFileSync(path.join(dayRoot, 'summary.md'), 'utf8'), 'The first day ended safely.\n');
    assert.equal(fs.readFileSync(path.join(dayRoot, 'ending', 'diary.md'), 'utf8'), 'I made it through the day.\n');
    assert.equal(JSON.parse(fs.readFileSync(path.join(dayRoot, 'ending', 'settle.state.json'), 'utf8')).status, 'committed');
    assert.match(fs.readFileSync(path.join(dayRoot, 'meta.yaml'), 'utf8'), /phase: settled/);
    assert.match(fs.readFileSync(path.join(root, 'state', 'variables.yaml'), 'utf8'), /water: interrupted/);
    assert.match(fs.readFileSync(path.join(root, 'memory', 'short_term.md'), 'utf8'), /Day 1: the water stopped/);
    assert.match(fs.readFileSync(path.join(root, 'current.yaml'), 'utf8'), /day: day_0002\nphase: idle\nlast_committed_day: day_0001/);
    assert.match(fs.readFileSync(path.join(root, 'logs', 'state_changes.jsonl'), 'utf8'), /day_settled/);
    assert.equal(fs.existsSync(path.join(root, 'days', 'day_0002')), false);
  } finally { cleanup(root); }
});

test('settlement rejects unsafe or unsupported patch paths', () => {
  const root = tempWorld();
  try {
    assert.throws(() => validateSettlementProposal(proposal({ state_patch: [{ op: 'replace', path: '../current.yaml', content: 'bad' }] }), 'day_0001', root), /unsafe/);
    assert.throws(() => validateSettlementProposal(proposal({ state_patch: [{ op: 'replace', path: 'canon/rules.md', content: 'bad' }] }), 'day_0001', root), /not allowed/);
    assert.throws(() => validateSettlementProposal(proposal({ state_patch: [{ op: 'append', path: 'characters/missing/timeline.md', content: 'bad' }] }), 'day_0001', root), /missing file/);
  } finally { cleanup(root); }
});

test('settlement rejects unfinished play and a populated next day', () => {
  const unfinished = tempWorld({ beatStatus: 'pending' });
  try { assert.throws(() => settleFromProposal(unfinished, writeProposal(unfinished), { yes: true }), /all beats closed/); }
  finally { cleanup(unfinished); }

  const root = tempWorld();
  try {
    fs.mkdirSync(path.join(root, 'days', 'day_0002'), { recursive: true });
    fs.writeFileSync(path.join(root, 'days', 'day_0002', 'unexpected.txt'), 'occupied');
    assert.throws(() => settleFromProposal(root, writeProposal(root), { yes: true }), /already exists and is not empty/);
  } finally { cleanup(root); }
});

test('AI settlement parser accepts narrative-only machine output', () => {
  const block = ['```settlement-narrative', JSON.stringify({
    summary: 'Done',
    diary: 'I rested.',
    next_day_seed: { summary: 'Morning comes.', suggested_intents: ['Ask around'] },
  }), '```'].join('\n');
  const narrative = parseSettlementNarrative(`preface\n${block}`);
  validateSettlementNarrative(narrative);
  assert.equal(narrative.summary, 'Done');
  assert.deepEqual(narrative.next_day_seed.suggested_intents, ['Ask around']);
  assert.throws(() => validateSettlementNarrative({ ...narrative, next_day_seed: { ...narrative.next_day_seed, suggested_intents: [] } }), /1 to 5/);
});

test('program assembles technical settlement fields and preserves known threads', () => {
  const root = tempWorld();
  try {
    fs.writeFileSync(path.join(root, 'memory', 'unresolved_threads.yaml'), 'threads:\n  - pump_outage\n  - id: missing_courier\n');
    const narrative = {
      summary: '  The day ended.  ',
      diary: '  I finally slept.  ',
      next_day_seed: { summary: '  Questions remain.  ', suggested_intents: ['  Visit the pump  '] },
    };
    const result = buildProgramSettlementProposal(root, 'day_0001', narrative);
    assert.equal(result.version, 1);
    assert.equal(result.day, 'day_0001');
    assert.deepEqual(result.state_patch, [{ op: 'append', path: 'memory/short_term.md', content: '## day_0001\n\nThe day ended.' }]);
    assert.deepEqual(result.next_day_seed.unresolved_threads, ['pump_outage', 'missing_courier']);
    assert.deepEqual(result.next_day_seed.suggested_intents, ['Visit the pump']);
    assert.deepEqual(readUnresolvedThreads(root), ['pump_outage', 'missing_courier']);
    validateSettlementProposal(result, 'day_0001', root);
  } finally { cleanup(root); }
});

test('settlement prompt context includes results and truncates long transcripts', () => {
  const root = tempWorld();
  try {
    const eventRoot = path.join(root, 'days', 'day_0001', 'events', 'event_001');
    fs.writeFileSync(path.join(root, 'days', 'day_0001', 'plan.user.md'), 'Finish the day.\n');
    fs.writeFileSync(path.join(root, 'days', 'day_0001', 'runtime.state.json'), '{"day_elapsed_minutes":60}\n');
    fs.writeFileSync(path.join(eventRoot, 'event.json'), '{"title":"Test"}\n');
    fs.writeFileSync(path.join(eventRoot, 'status.json'), '{"status":"resolved"}\n');
    fs.writeFileSync(path.join(eventRoot, 'result.json'), '{"summary":"Resolved"}\n');
    fs.writeFileSync(path.join(eventRoot, 'transcript.md'), 'OLD_MARKER' + 'x'.repeat(7000) + 'TAIL_MARKER');
    const context = buildSettlementPromptInput(root, 'day_0001');
    assert.match(context, /Finish the day/);
    assert.match(context, /Resolved/);
    assert.match(context, /TAIL_MARKER/);
    assert.doesNotMatch(context, /OLD_MARKER/);
  } finally { cleanup(root); }
});
