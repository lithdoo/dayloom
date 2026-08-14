const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { installImmutable } = require('../dist/world/publish');

test('immutable installation is atomic, idempotent, and rejects conflicting identity', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'core2-immutable-')); t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const target = path.join(root, 'objects', 'identity'), bytes = Buffer.from('complete immutable bytes');
  await installImmutable(target, bytes); assert.deepEqual(fs.readFileSync(target), bytes);
  assert.deepEqual(fs.readdirSync(path.dirname(target)), ['identity']);
  await installImmutable(target, bytes);
  await assert.rejects(() => installImmutable(target, Buffer.from('conflict')));
  assert.deepEqual(fs.readFileSync(target), bytes); assert.deepEqual(fs.readdirSync(path.dirname(target)), ['identity']);
});
