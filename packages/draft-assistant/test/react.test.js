import test from 'node:test';
import assert from 'node:assert/strict';
import { dialogueReactArgvV1, syncReactArgvV1 } from '../dist/react.js';
import { syncFinalPromptV1 } from '../dist/prompts.js';

const base = { config: 'config', conversation: 'conversation', workRoot: 'work' };

test('Dialogue persists and continues Conversation with the caller output format', () => {
  const argv = dialogueReactArgvV1({ ...base, outputFormat: 'stream-json' });
  assert.ok(argv.includes('--output-dir'));
  assert.ok(argv.includes('--continue'));
  assert.equal(argv[argv.indexOf('--max-step') + 1], '4');
  assert.equal(argv[argv.indexOf('--max-step-policy') + 1], 'error');
  assert.equal(argv[argv.indexOf('--observe-carryover') + 1], '1');
  assert.equal(argv[argv.indexOf('--output-format') + 1], 'stream-json');
});

test('Sync is read-only on Conversation, hides behind terminal capture, and skips Final', () => {
  const argv = syncReactArgvV1(base);
  assert.equal(argv.includes('--output-dir'), false);
  assert.equal(argv.includes('--continue'), false);
  assert.equal(argv[argv.indexOf('--max-step') + 1], '6');
  assert.equal(argv[argv.indexOf('--output-format') + 1], 'terminal');
  assert.equal(syncFinalPromptV1(), '');
});
