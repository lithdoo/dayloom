const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const {
  effectiveDailyAction,
  parseDailyIntent,
  parseExplicitDailyAction,
  validateDailyIntent,
} = require('../../dist/daily/intent-router.js');
const { createIntentSession, cleanupSession } = require('../../dist/daily/session.js');

function block(value) {
  return ['```daily-intent', JSON.stringify(value), '```'].join('\n');
}

test('parseDailyIntent accepts a valid router decision', () => {
  const intent = parseDailyIntent(block({ action: 'start', confidence: 0.98, reason: 'User confirmed execution' }));
  assert.equal(intent.action, 'start');
  assert.equal(effectiveDailyAction(intent), 'start');
});

test('daily intent validation rejects invalid actions and confidence', () => {
  assert.throws(() => validateDailyIntent({ action: 'apply', confidence: 0.9, reason: 'x' }), /Unsupported/);
  assert.throws(() => validateDailyIntent({ action: 'start', confidence: 1.1, reason: 'x' }), /between 0 and 1/);
  assert.throws(() => parseDailyIntent('no machine block'), /missing daily-intent/);
});

test('low confidence router decisions fall back to continue', () => {
  assert.equal(effectiveDailyAction({ action: 'cancel', confidence: 0.79, reason: 'Ambiguous' }), 'continue');
});

test('explicit slash commands bypass the router', () => {
  assert.equal(parseExplicitDailyAction('/start'), 'start');
  assert.equal(parseExplicitDailyAction('/PENDING'), 'pending');
  assert.equal(parseExplicitDailyAction('/help'), 'help');
  assert.equal(parseExplicitDailyAction('开始'), undefined);
});

test('intent session contains only classification input and no tools', () => {
  const session = createIntentSession({
    input: '开始',
    draft: { user_intent: 'Go out', known_context: [], constraints: [], open_questions: [] },
    latestAssistantReply: 'Ready?',
  });
  try {
    const input = JSON.parse(fs.readFileSync(`${session.messagesDir}/[1]user.md`, 'utf8'));
    assert.equal(input.latest_user_input, '开始');
    assert.equal(fs.readFileSync(session.toolsFile, 'utf8'), '');
  } finally { cleanupSession(session); }
});
