const test = require('node:test');
const assert = require('node:assert/strict');
const { assignChangePlanV2, canonicalizeChangePlanV2, hashChangePlanV2 } = require('../dist/session/change-plan-v2');
const hash = 'a'.repeat(64), brief = { source: 'brief', startLine: 1, endLine: 1, sha256: hash }, user = { source: 'evidence', turnId: 'turn1', field: 'user-input', sha256: hash };
test('Change Plan V2 closes policy, property order, and stable ID assignment at one boundary', () => {
  const plan = canonicalizeChangePlanV2({ schemaVersion: 2, sessionKind: 'revise', baseDraftHash: hash, baseWorldCommitId: 'commit1', targetDay: null, changes: [
    { localKey: 'place', action: 'create', resourceKind: 'location', targetId: null, parentLocalKey: null, evidence: [brief, user] },
    { localKey: 'door', action: 'create', resourceKind: 'location-trigger', targetId: null, parentLocalKey: 'place', evidence: [brief, user] },
    { localKey: 'hero', action: 'create', resourceKind: 'character', targetId: null, parentLocalKey: null, evidence: [brief, user] },
  ] });
  const assigned = assignChangePlanV2(plan, 'b'.repeat(64), new Set(['location1', 'character2']));
  assert.deepEqual(assigned.assignedIds, { door: 'trigger1', hero: 'character1', place: 'location2' });
  assert.equal(assigned.planHash, hashChangePlanV2(plan));
  assert.throws(() => canonicalizeChangePlanV2({ ...plan, extra: true }), /unknown or missing/);
  assert.throws(() => canonicalizeChangePlanV2({ ...plan, sessionKind: 'planning' }), /not allowed/);
});
