const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createDayloomCore, CoreInitializationError } = require('../dist');
const { resolvePackagedBoundaries } = require('../dist/promptpile/binaries');
const { archiveFixture } = require('./helpers');

test('core resolves packaged binaries and compiles packaged React schemas', async () => {
  const boundaries = await resolvePackagedBoundaries();
  assert.match(boundaries.promptpileBin, /promptpile[\\/]dist[\\/]index\.js$/);
  assert.match(boundaries.reactBin, /promptpile-react[\\/]dist[\\/]index\.js$/);
  assert.equal(boundaries.validateProcessPile({ schema_version: 1, process_id: `react_${'1'.repeat(32)}`, sequence: 0, type: 'process.started', max_steps: 1, work_id: `work_${'2'.repeat(32)}`, work_path: 'x', work_lifecycle: 'cleanup' }), true);
  assert.equal(fs.existsSync(path.join(__dirname, '..', 'src', 'schema', 'agent-event-v1.schema.json')), false);
});
test('core initializes a valid planned World and derives play capability', async (t) => {
  const fixture = archiveFixture(); t.after(fixture.cleanup);
  const core = await createDayloomCore({ worldRoot: fixture.root, llmConfigPath: fixture.config }); t.after(() => core.dispose());
  assert.deepEqual(core.getState().capabilities.startSessions, ['play']);
  assert.equal(core.getState().world.revision, 1);
});
test('core classifies malformed planned context as WORLD_INVALID', async (t) => {
  const fixture = archiveFixture({ malformedPlan: true }); t.after(fixture.cleanup);
  const core = await createDayloomCore({ worldRoot: fixture.root, llmConfigPath: fixture.config }); t.after(() => core.dispose());
  assert.equal(core.getState().world.status, 'invalid');
  assert.deepEqual(core.getState().capabilities.startSessions, []);
});
test('core rejects caller-owned React and Conversation config', async (t) => {
  const fixture = archiveFixture(); t.after(fixture.cleanup);
  fs.writeFileSync(fixture.config, '[promptpile-react]\nmax_step=2\n');
  await assert.rejects(() => createDayloomCore({ worldRoot: fixture.root, llmConfigPath: fixture.config }), (error) => error.code === 'INVALID_OPTIONS');
  fs.writeFileSync(fixture.config, '[promptpile]\ndir="bad"\n');
  await assert.rejects(() => createDayloomCore({ worldRoot: fixture.root, llmConfigPath: fixture.config }), (error) => error.code === 'INVALID_OPTIONS');
});
