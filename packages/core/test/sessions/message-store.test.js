const test = require('node:test');
const assert = require('node:assert/strict');
const { MessageStore } = require('../../dist/index.js');

test('message store updates assistant messages by id', () => {
  const store = new MessageStore();
  const sessionId = 'session-1';

  store.applySessionEvent(sessionId, { type: 'assistant-message-start', messageId: 'm1' });
  store.applySessionEvent(sessionId, { type: 'assistant-message-start', messageId: 'm1' });
  store.applySessionEvent(sessionId, { type: 'assistant-message-delta', messageId: 'm1', sequence: 1, delta: 'a' });
  store.applySessionEvent(sessionId, { type: 'assistant-message-delta', messageId: 'm1', sequence: 1, delta: 'a' });
  store.applySessionEvent(sessionId, { type: 'assistant-message-end', messageId: 'm1' });
  store.applySessionEvent(sessionId, { type: 'assistant-message-start', messageId: 'm1' });
  store.applySessionEvent(sessionId, { type: 'assistant-message-delta', messageId: 'm1', sequence: 2, delta: 'ignored' });
  store.applySessionEvent(sessionId, { type: 'assistant-message-end', messageId: 'm1' });

  assert.deepEqual(store.getMessages(sessionId), [
    {
      id: 'm1',
      role: 'assistant',
      text: 'a',
      status: 'complete',
      sessionId,
    },
  ]);
});

test('message store enforces per-session message and text retention', () => {
  const store = new MessageStore({
    maxMessagesPerSession: 2,
    maxTextCharsPerSession: 40,
  });
  const sessionId = 'retained-session';
  for (let index = 1; index <= 3; index += 1) {
    store.applySessionEvent(sessionId, {
      type: 'message-added',
      message: {
        id: `message-${index}`,
        role: 'user',
        text: `message ${index}`,
        status: 'complete',
      },
    });
  }
  store.applySessionEvent(sessionId, {
    type: 'assistant-message-start',
    messageId: 'long-assistant',
  });
  store.applySessionEvent(sessionId, {
    type: 'assistant-message-delta',
    messageId: 'long-assistant',
    sequence: 1,
    delta: 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ',
  });

  const messages = store.getMessages(sessionId);
  assert.equal(messages.length, 1);
  assert.equal(messages[0].id, 'long-assistant');
  assert.equal(messages[0].text.length <= 40, true);
});
