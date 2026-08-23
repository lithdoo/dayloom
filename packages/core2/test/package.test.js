const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const corePackage = require('../package.json');

test('public API exports only application contract', () => {
  const api = require('../dist');
  assert.deepEqual(Object.keys(api).sort(), ['CoreInitializationError', 'createDayloomCore', 'migrateLegacyWorldProfileV1']);
});

test('core2 pins the frozen promptpile-compress release', () => {
  assert.equal(corePackage.dependencies['promptpile-compress'], '0.1.0-beta.2');
});

test('core2 pins the verified promptpile-react release', () => {
  assert.equal(corePackage.dependencies['promptpile-react'], '0.1.0-beta.5');
});

test('core2 package describes the complete product lifecycle', () => {
  assert.doesNotMatch(corePackage.description, /play-only|minimal.*play runtime/i);
});

test('core2 CI builds its workspace protocol dependency before testing', () => {
  const workflow = fs.readFileSync(path.resolve(__dirname, '../../../.github/workflows/core2.yml'), 'utf8');
  const protocolBuild = workflow.indexOf('npm run build -w @dayloom/archive-protocol');
  const coreTest = workflow.indexOf('npm test -w @dayloom/core2');
  assert.notEqual(protocolBuild, -1);
  assert.equal(protocolBuild < coreTest, true);
});
