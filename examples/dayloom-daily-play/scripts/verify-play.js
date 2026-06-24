'use strict';

const fs = require('fs');
const path = require('path');

function fail(errors) {
  console.error('verify-play: FAILED');
  for (const error of errors) console.error(`  - ${error}`);
  process.exit(1);
}

function read(file) { return fs.readFileSync(file, 'utf8'); }
function readJson(file) { return JSON.parse(read(file)); }
function exists(root, rel) { return fs.existsSync(path.join(root, rel)); }
function yamlValue(text, key) { return text.match(new RegExp(`^${key}:\\s*(\\S+)`, 'm'))?.[1] ?? ''; }

function main() {
  const worldRoot = process.argv[2] ? path.resolve(process.argv[2]) : '';
  const errors = [];
  if (!worldRoot) errors.push('Usage: node verify-play.js <worldRoot>');
  if (worldRoot && !exists(worldRoot, 'manifest.yaml')) errors.push(`missing manifest.yaml in ${worldRoot}`);
  if (errors.length) fail(errors);

  const current = read(path.join(worldRoot, 'current.yaml'));
  const day = yamlValue(current, 'day');
  const phase = yamlValue(current, 'phase');
  if (!/^day_\d{4}$/.test(day)) errors.push(`invalid current day: ${day}`);
  if (phase !== 'playing' && phase !== 'settling') errors.push(`current phase expected playing or settling, got ${phase}`);

  const dayDir = path.join(worldRoot, 'days', day);
  for (const name of ['plan.initial.json', 'plan.current.json', 'play.state.json', 'runtime.state.json']) {
    if (!fs.existsSync(path.join(dayDir, name))) errors.push(`missing file: days/${day}/${name}`);
  }
  if (errors.length) fail(errors);

  const plan = readJson(path.join(dayDir, 'plan.current.json'));
  const state = readJson(path.join(dayDir, 'play.state.json'));
  if (plan.day !== day || state.day !== day) errors.push('plan/state day does not match current.yaml');
  if (!Array.isArray(plan.beats) || plan.beats.length < 1) errors.push('plan.current.json has no beats');
  if (!Number.isInteger(plan.revision) || plan.revision < 0) errors.push('plan revision is invalid');
  if (!Array.isArray(state.completed_events)) errors.push('play state completed_events is invalid');

  const eventsDir = path.join(dayDir, 'events');
  const eventIds = fs.existsSync(eventsDir)
    ? fs.readdirSync(eventsDir).filter(name => /^event_\d{3}$/.test(name)).sort()
    : [];
  if (eventIds.length < 1) errors.push(`days/${day}/events contains no generated event`);

  for (const eventId of eventIds) {
    const eventDir = path.join(eventsDir, eventId);
    const eventFile = path.join(eventDir, 'event.json');
    const transcriptFile = path.join(eventDir, 'transcript.md');
    if (!fs.existsSync(eventFile)) {
      errors.push(`${eventId}/event.json is missing`);
      continue;
    }
    if (!fs.existsSync(transcriptFile) || !read(transcriptFile).trim()) errors.push(`${eventId}/transcript.md is missing or empty`);
    const event = readJson(eventFile);
    if (event.id !== eventId) errors.push(`${eventId}/event.json id mismatch`);
    if (!/^beat_\d{2}$/.test(event.source_beat ?? '')) errors.push(`${eventId} source_beat is invalid`);
    for (const key of ['outcome', 'result', 'success', 'failure', 'reward']) {
      if (Object.prototype.hasOwnProperty.call(event, key)) errors.push(`${eventId} contains forbidden field: ${key}`);
    }

    const resultFile = path.join(eventDir, 'result.json');
    if (fs.existsSync(resultFile)) {
      const result = readJson(resultFile);
      if (result.event_id !== eventId) errors.push(`${eventId}/result.json id mismatch`);
      for (const name of ['state.patch.json', 'state.patch.applied']) {
        if (!fs.existsSync(path.join(eventDir, name))) errors.push(`${eventId}/${name} is missing after resolution`);
      }
      const replanComplete = state.completed_events.includes(eventId) || fs.existsSync(path.join(eventDir, 'replan.applied'));
      if (replanComplete) {
        for (const name of ['replan.json', 'replan.applied']) {
          if (!fs.existsSync(path.join(eventDir, name))) errors.push(`${eventId}/${name} is missing after replanning`);
        }
      }
    }
  }

  if (state.active_event && !eventIds.includes(state.active_event)) errors.push('active_event does not exist');
  if (phase === 'settling') {
    if (state.step !== 'complete' || state.phase !== 'settling') errors.push('settling World must have complete play state');
    if (plan.beats.some(beat => beat.status === 'pending' || beat.status === 'active')) errors.push('settling World still has unfinished beats');
  } else if (state.phase !== 'playing') {
    errors.push('playing World must have playing play state');
  }

  if (state.completed_events.length) {
    const logFile = path.join(worldRoot, 'logs', 'state_changes.jsonl');
    if (!fs.existsSync(logFile) || !read(logFile).includes('"type":"event_resolved"')) errors.push('event_resolved log entry missing');
  }

  if (errors.length) fail(errors);
  console.log(`verify-play: OK ${worldRoot} (phase=${phase}, events=${eventIds.length})`);
}

main();
