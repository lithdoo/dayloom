const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { exportVisibleTranscriptV1 } = require('../dist/world/builders/audit');

test('visible transcript restores compressed turns and excludes summary, submit marker, and hidden Final', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'core-audit-')); t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const archive = path.join(root, '[1]system.md.archive'); fs.mkdirSync(archive);
  fs.writeFileSync(path.join(archive, '[0]user.md'), 'first question');
  fs.writeFileSync(path.join(archive, '[1]assistant.md'), 'first answer');
  fs.writeFileSync(path.join(root, '[1]system.md'), 'PRIVATE SEMANTIC SUMMARY');
  fs.writeFileSync(path.join(root, '[2]user.md'), 'second question');
  fs.writeFileSync(path.join(root, '[3]assistant.md'), 'second answer');
  fs.writeFileSync(path.join(root, '[4]user.md'), '[DAYLOOM_INIT_SUBMIT_V2]\nFinalize');
  fs.writeFileSync(path.join(root, '[5]assistant.md'), '{"version":2}');
  fs.writeFileSync(path.join(root, '[5]assistant.calls.jsonl'), '{"private":true}\n');
  const transcript = await exportVisibleTranscriptV1(root, '{"version":2}');
  assert.deepEqual(transcript.turns, [
    { index: 0, role: 'user', content: 'first question' },
    { index: 1, role: 'assistant', content: 'first answer' },
    { index: 2, role: 'user', content: 'second question' },
    { index: 3, role: 'assistant', content: 'second answer' },
  ]);
  assert.equal(JSON.stringify(transcript).includes('SUMMARY'), false);
  assert.equal(JSON.stringify(transcript).includes('private'), false);
});
