const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(process.argv[2] || 'output/world-daily-interactive');
const current = fs.readFileSync(path.join(root, 'current.yaml'), 'utf8');
const day = scalar(current, 'day');
const phase = scalar(current, 'phase');
const committed = scalar(current, 'last_committed_day');
if (phase !== 'idle') fail(`expected current phase idle, got ${phase}`);
if (!/^day_\d{4}$/.test(day) || !/^day_\d{4}$/.test(committed)) fail('invalid current or committed day');
const expectedNext = `day_${String(Number(committed.slice(4)) + 1).padStart(4, '0')}`;
if (day !== expectedNext) fail(`expected next day ${expectedNext}, got ${day}`);
const committedRoot = path.join(root, 'days', committed);
if (!fs.readFileSync(path.join(committedRoot, 'summary.md'), 'utf8').trim()) fail('summary.md is empty');
if (!fs.readFileSync(path.join(committedRoot, 'ending', 'diary.md'), 'utf8').trim()) fail('ending/diary.md is empty');
const state = JSON.parse(fs.readFileSync(path.join(committedRoot, 'ending', 'settle.state.json'), 'utf8'));
if (state.status !== 'committed' || state.next_day !== day) fail('invalid settle.state.json');
console.log(`verify-settle: OK ${root} (committed=${committed}, current=${day}, phase=${phase})`);

function scalar(text, key) {
  const match = text.match(new RegExp(`^${key}:\\s*(\\S+)\\s*$`, 'm'));
  if (!match) fail(`current.yaml missing ${key}`);
  return match[1];
}
function fail(message) { console.error(`verify-settle: FAIL ${message}`); process.exit(1); }
