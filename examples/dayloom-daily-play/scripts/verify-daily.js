'use strict';

const fs = require('fs');
const path = require('path');

function fail(errors) {
  console.error('verify-daily: FAILED');
  for (const err of errors) console.error(`  - ${err}`);
  process.exit(1);
}

function read(file) { return fs.readFileSync(file, 'utf8'); }
function exists(root, rel) { return fs.existsSync(path.join(root, rel)); }
function yamlValue(text, key) { return text.match(new RegExp(`^${key}:\\s*(\\S+)`, 'm'))?.[1] ?? ''; }

function main() {
  const worldRoot = process.argv[2] ? path.resolve(process.argv[2]) : '';
  const errors = [];
  if (!worldRoot) errors.push('Usage: node verify-daily.js <worldRoot>');
  if (worldRoot && !exists(worldRoot, 'manifest.yaml')) errors.push(`missing manifest.yaml in ${worldRoot}`);
  if (errors.length) fail(errors);

  const current = read(path.join(worldRoot, 'current.yaml'));
  const day = yamlValue(current, 'day');
  const phase = yamlValue(current, 'phase');
  if (!/^day_\d{4}$/.test(day)) errors.push(`current.yaml day is invalid: ${day}`);
  if (phase !== 'planned') errors.push(`current.yaml phase expected planned, got ${phase}`);

  const dayDir = `days/${day}`;
  for (const rel of [`${dayDir}/meta.yaml`, `${dayDir}/plan.user.md`, `${dayDir}/plan.initial.json`]) {
    if (!exists(worldRoot, rel)) errors.push(`missing file: ${rel}`);
  }
  if (exists(worldRoot, `${dayDir}/diary.md`)) errors.push(`${dayDir}/diary.md should not exist at planning stage`);
  if (fs.existsSync(path.join(worldRoot, dayDir, 'events'))) errors.push(`${dayDir}/events/ should not exist at planning stage`);

  if (exists(worldRoot, `${dayDir}/plan.user.md`) && !read(path.join(worldRoot, dayDir, 'plan.user.md')).trim()) {
    errors.push(`${dayDir}/plan.user.md is empty`);
  }

  if (exists(worldRoot, `${dayDir}/plan.initial.json`)) {
    const plan = JSON.parse(read(path.join(worldRoot, dayDir, 'plan.initial.json')));
    if (plan.day !== day) errors.push(`plan.initial.json day expected ${day}, got ${plan.day}`);
    if (typeof plan.user_intent !== 'string' || !plan.user_intent.trim()) errors.push('plan.initial.json user_intent is empty');
    if (!Array.isArray(plan.planned_beats) || plan.planned_beats.length < 1 || plan.planned_beats.length > 5) errors.push('planned_beats must contain 1 to 5 beats');
    for (const [index, beat] of (plan.planned_beats ?? []).entries()) {
      if (!/^beat_\d{2}$/.test(beat.id ?? '')) errors.push(`beat ${index} id is invalid`);
      if (typeof beat.intent !== 'string' || !beat.intent.trim()) errors.push(`beat ${index} intent is empty`);
      if (beat.status !== 'tentative') errors.push(`beat ${index} status must be tentative`);
      for (const key of ['outcome', 'result', 'reward', 'success', 'failure']) {
        if (Object.prototype.hasOwnProperty.call(beat, key)) errors.push(`beat ${index} contains forbidden field: ${key}`);
      }
    }
  }

  const logPath = path.join(worldRoot, 'logs', 'state_changes.jsonl');
  if (!fs.existsSync(logPath)) errors.push('state_changes.jsonl is missing');
  else {
    const entries = read(logPath).split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line));
    if (!entries.some(entry => entry.type === 'daily_plan_created' && entry.day === day)) errors.push(`daily_plan_created log entry missing for ${day}`);
  }

  if (errors.length) fail(errors);
  console.log(`verify-daily: OK ${worldRoot}`);
}

main();
