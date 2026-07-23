const assert = require('node:assert/strict');
const test = require('node:test');
const core = require('../../dist');
const fixtures = require('./fixtures');

const cases = [
  ['canon documents', core.validateCanonDocuments, fixtures.canon, { ...fixtures.canon, rules: null }],
  ['init submission', core.validateInitSubmission, fixtures.submissions.init, { ...fixtures.submissions.init, world: { id: '../bad', title: 'Bad' } }],
  ['planning submission', core.validatePlanningSubmission, fixtures.submissions.planning, { ...fixtures.submissions.planning, day: 'tomorrow' }],
  ['play submission', core.validatePlaySubmission, fixtures.submissions.play, { ...fixtures.submissions.play, transcript: [{ sequence: 0, role: 'user', text: '', messageId: null }] }],
  ['revise submission', core.validateReviseSubmission, fixtures.submissions.revise, { ...fixtures.submissions.revise, summary: '' }],
  ['manifest', core.validateArchiveManifest, fixtures.manifest, { ...fixtures.manifest, worldId: '../world' }],
  ['pointer', core.validateCurrentPointer, fixtures.pointer, { ...fixtures.pointer, revision: 0 }],
  [
    'commit',
    core.validateArchiveCommit,
    fixtures.commit,
    {
      ...fixtures.commit,
      world: { ...fixtures.commit.world, phase: 'playing' },
      activeSession: null,
    },
  ],
  [
    'canon revision',
    core.validateCanonRevisionManifest,
    fixtures.canonRevision,
    { ...fixtures.canonRevision, id: 'bad/revision' },
  ],
  [
    'day revision',
    core.validateDayRevisionMeta,
    fixtures.dayRevision,
    { ...fixtures.dayRevision, day: 'day_1' },
  ],
  ['plan', core.validatePlanDocument, fixtures.plan, { ...fixtures.plan, beats: [{ ...fixtures.plan.beats[0], status: 'running' }] }],
  ['play', core.validatePlayDocument, fixtures.play, { ...fixtures.play, eventIds: ['event/1'] }],
  ['event', core.validatePlayEventDocument, fixtures.event, { ...fixtures.event, status: 'pending' }],
  ['transcript', core.validateTranscriptEntries, fixtures.transcript, fixtures.transcript.map((entry) => ({ ...entry, sequence: 2 }))],
  ['settlement', core.validateSettlementDocument, fixtures.settlement, { ...fixtures.settlement, settledAt: 'today' }],
  ['abandoned', core.validateAbandonedDocument, fixtures.abandoned, { ...fixtures.abandoned, previousRevision: '' }],
  ['operation', core.validateArchiveOperation, fixtures.operation, { ...fixtures.operation, baseRevision: -1 }],
];

for (const [name, validator, valid, invalid] of cases) {
  test(`${name} schema accepts a valid fixture`, () => {
    assert.equal(validator(valid), valid);
  });

  test(`${name} schema rejects an invalid fixture`, () => {
    assert.throws(() => validator(invalid), core.SchemaValidationError);
  });
}

test('id validators enforce archive naming rules', () => {
  assert.equal(core.isDayId('day_0001'), true);
  assert.equal(core.isDayId('day_1'), false);
  assert.equal(core.isOperationId('op_01J7Q2A4P8'), true);
  assert.equal(core.isOperationId('op_/tmp'), false);
});

test('prefixedId creates canonical ids and rejects unsafe tokens', () => {
  assert.equal(core.prefixedId('commit_', 'abc-123'), 'commit_abc-123');
  assert.throws(() => core.prefixedId('commit_', '../abc'));
});
