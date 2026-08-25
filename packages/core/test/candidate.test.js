const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { assembleCandidateV1, validateCandidateV1, assertSessionCandidatePathAllowedV1 } = require('../dist/world/candidate');
const put = (documentPath, content) => ({ op: 'put', path: documentPath, mediaType: documentPath.endsWith('.json') ? 'application/json' : documentPath.endsWith('.yaml') ? 'application/yaml' : 'text/markdown', bytes: Buffer.from(content) });
const initChanges = () => Object.entries({
  'canon/premise.md': 'Premise', 'canon/rules.md': '', 'canon/style.md': 'Style', 'canon/user-role.md': 'User',
  'state/world.yaml': 'schemaVersion: 1\ntitle: Candidate World\nstatus: active\n', 'state/calendar.yaml': 'schemaVersion: 1\ncurrentDay: null\nelapsed: null\n', 'state/progress.yaml': 'schemaVersion: 1\nactiveArcIds: []\n', 'state/variables.yaml': 'schemaVersion: 1\nvariables: {}\n',
  'characters/index.yaml': 'schemaVersion: 1\nids: []\n', 'locations/index.yaml': 'schemaVersion: 1\nids: []\n', 'arcs/index.yaml': 'schemaVersion: 1\nids: []\n',
  'memory/short-term.md': '', 'memory/long-term.md': '', 'memory/facts.yaml': 'schemaVersion: 1\nfacts: []\n', 'memory/unresolved-threads.yaml': 'schemaVersion: 1\nthreads: []\n', 'memory/important-events.yaml': 'schemaVersion: 1\nevents: []\n', 'story-seeds/active.yaml': 'schemaVersion: 1\nseeds: []\n',
}).map(([name, content]) => put(name, content));

test('Init Candidate is assembled from puts, receives the Core profile descriptor, and validates before publication', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'candidate-init-')); t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const changes = initChanges();
  const candidate = await assembleCandidateV1({ worldRoot: root, operationType: 'init', base: null, changes, initialManifest: { worldId: 'world_candidate', title: 'Candidate World' }, control: { phase: 'idle', day: null, lastSettledDay: null } });
  assert.equal(candidate.reader.has('profile/dayloom.json'), true);
  assert.equal(candidate.changes[0].path, 'arcs/index.yaml');
  const validation = await validateCandidateV1(candidate);
  assert.equal(validation.ok, true);
  assert.equal(validation.world.view.title, 'Candidate World');
  assert.equal(fs.existsSync(path.join(root, 'current.json')), false, 'dry-run validation must not publish');
});

test('operation policy fails closed for wrong day, private namespaces, delete, and unplanned Revise paths', async () => {
  assert.equal(assertSessionCandidatePathAllowedV1('planning', 'days/day2/plan.json', 'day2'), 'days/day2/plan.json');
  assert.throws(() => assertSessionCandidatePathAllowedV1('planning', 'days/day1/plan.json', 'day2'), /cannot put/);
  assert.throws(() => assertSessionCandidatePathAllowedV1('play', 'audit/sessions/x/meta.json', 'day1'), /cannot put/);
  assert.throws(() => assertSessionCandidatePathAllowedV1('revise', 'canon/premise.md', null, new Set()), /cannot put/);
  await assert.rejects(() => assembleCandidateV1({ worldRoot: '.', operationType: 'planning', base: /** @type {any} */ ({}), changes: [{ op: 'delete', path: 'days/day1/plan.json' }], control: { phase: 'planned', day: 'day1', lastSettledDay: null } }), /does not allow delete/);
});

test('Candidate validator returns stable structured diagnostics without publishing', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'candidate-invalid-')); t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const changes = initChanges().filter((change) => change.path !== 'canon/premise.md');
  await assert.rejects(() => assembleCandidateV1({ worldRoot: root, operationType: 'init', base: null, changes, initialManifest: { worldId: 'world_candidate', title: 'Candidate World' }, control: { phase: 'idle', day: null, lastSettledDay: null } }), /missing required outputs/);
});
