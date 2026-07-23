import assert from 'node:assert/strict';
import test from 'node:test';

import {
  appendTuiMessage,
  formatSuggestedActions,
  suggestedActionsKey,
} from '../dist/message-history.js';

test('appendTuiMessage normalizes, ignores whitespace, and merges display roles', () => {
  let nextId = 0;
  let messages = [];
  const append = (role, text) => {
    messages = appendTuiMessage(messages, role, text, {
      now: 100 + nextId,
      nextId: () => String(++nextId),
    });
  };

  append('output', '\r\nhello\r\n');
  append('output', 'world');
  append('system', 'tip');
  append('system', 'another tip');
  append('warn', 'careful');
  append('warn', 'still careful');
  append('error', '\n');

  assert.deepEqual(
    messages.map((message) => [message.id, message.role, message.text]),
    [
      ['1', 'output', 'hello\nworld'],
      ['2', 'system', 'tip'],
      ['3', 'system', 'another tip'],
      ['4', 'warn', 'careful\nstill careful'],
    ],
  );
});

test('suggested action helpers normalize keys and localized display text', () => {
  const actions = [' Order espresso ', '', 'Leave'];

  assert.equal(suggestedActionsKey(actions), 'Order espresso\nLeave');
  assert.equal(
    formatSuggestedActions(actions, 'zh'),
    '推荐下一步：\n1. Order espresso\n2. Leave',
  );
  assert.equal(
    formatSuggestedActions(actions, 'en'),
    'Suggested next steps:\n1. Order espresso\n2. Leave',
  );
});
