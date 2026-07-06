const { test } = require('node:test');
const assert = require('node:assert/strict');
const { formatSettlementReview } = require('../../dist/settle/format-review.js');
const { createTranslator } = require('../../dist/i18n/index.js');

test('formatSettlementReview includes summary diary preview and changes', () => {
  const t = createTranslator('en');
  const proposal = {
    version: 1,
    day: 'day_0001',
    summary: 'A quiet day ended peacefully.',
    diary: ['Line 1', 'Line 2', 'Line 3', 'Line 4', 'Line 5', 'Line 6', 'Line 7', 'Line 8', 'Line 9'].join('\n'),
    state_patch: [],
    next_day_seed: {
      summary: 'Next day',
      suggested_intents: ['rest'],
      unresolved_threads: [],
    },
  };
  const text = formatSettlementReview(proposal, 'create days/day_0001/summary.md', t);
  assert.match(text, /Settlement proposal review/);
  assert.match(text, /A quiet day ended peacefully/);
  assert.match(text, /Line 1/);
  assert.match(text, /more lines/);
  assert.match(text, /create days\/day_0001\/summary\.md/);
});
