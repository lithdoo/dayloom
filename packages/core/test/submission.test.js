const test = require('node:test');
const assert = require('node:assert/strict');
const { parsePlaySubmissionV1, validateAndBuildPlayDocuments } = require('../dist/session/submission');
test('submission strict parser and deterministic builders trust pinned intent', () => {
  const plan = { intent: 'x', beats: [{ id: 'b', intent: 'Pinned intent' }] };
  const submission = parsePlaySubmissionV1(JSON.stringify({ version: 1, summary: 'Done  ', beats: [{ id: 'b', status: 'completed', eventId: 'e' }], events: [{ id: 'e', beatId: 'b', userInput: 'go', assistantOutput: 'went' }] }));
  const documents = validateAndBuildPlayDocuments(plan, submission);
  assert.match(new TextDecoder().decode(documents.play), /"intent": "Pinned intent"/);
  assert.equal(new TextDecoder().decode(documents.summary), 'Done\n');
  assert.equal(new TextDecoder().decode(documents.play).endsWith('\n'), true);
});
test('submission rejects unknown fields and plan mismatch', () => {
  assert.throws(() => parsePlaySubmissionV1('{"version":1,"summary":"x","beats":[],"events":[],"day":"bad"}'));
  const submission = parsePlaySubmissionV1('{"version":1,"summary":"x","beats":[],"events":[]}');
  assert.throws(() => validateAndBuildPlayDocuments({ intent: 'x', beats: [{ id: 'b', intent: 'i' }] }, submission));
});
