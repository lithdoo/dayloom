import test from 'node:test';
import assert from 'node:assert/strict';
import {
  dialogueCheckPromptV1,
  dialogueObservePromptV1,
  dialogueThoughtPromptV1,
  syncCheckPromptV1,
  syncObservePromptV1,
  syncThoughtPromptV1,
} from '../dist/prompts.js';

test('four command prompts freeze their distinct semantic boundaries', () => {
  assert.match(dialogueThoughtPromptV1('init', false), /Do not advance story time/);
  assert.match(dialogueThoughtPromptV1('plan', true), /not an event that already happened/);
  assert.match(dialogueThoughtPromptV1('play', true), /user owns their character's material actions/);
  assert.match(dialogueThoughtPromptV1('revise', true), /long-term World revision/);
  for (const command of ['init', 'plan', 'play', 'revise']) {
    const prompt = syncThoughtPromptV1(command);
    assert.match(prompt, /Preserve earlier non-conflicting valid intent/);
    assert.match(prompt, /Later rejection, replacement, or correction overrides/);
    assert.match(prompt, /Assistant suggestion alone is not user confirmation/);
    assert.match(prompt, /semantically idempotent/);
  }
  assert.match(syncThoughtPromptV1('play'), /Never invent a user action/);
});

test('Observe and Check use repair state instead of an ambiguous conversation continuation flag', () => {
  const dialogueObserve = dialogueObservePromptV1('play');
  assert.doesNotMatch(dialogueObserve, /SHOULD_CONTINUE/);
  assert.match(dialogueObserve, /authoritative user messages/);
  assert.match(dialogueObserve, /player-agency violation/);
  assert.match(dialogueThoughtPromptV1('play', true), /never as user input or proof of a user choice/);
  assert.match(dialogueCheckPromptV1(), /decision=false if and only if \[REVIEW\] is exactly <none>/);
  assert.match(dialogueCheckPromptV1(), /never means whether the user may continue/);

  assert.doesNotMatch(syncObservePromptV1('init'), /SHOULD_CONTINUE/);
  assert.match(syncCheckPromptV1(), /decision=false only when the entire Observe/);
  assert.match(syncCheckPromptV1(), /Draft still needs repair/);
});

test('Sync Thought names granted Draft paths and requires tool-backed convergence', () => {
  const prompt = syncThoughtPromptV1('init', {
    mode: 'files',
    mcpRoot: 'C:\\draft-root',
    files: [{ requested: 'C:\\draft-root\\premise.md', canonical: 'C:\\draft-root\\premise.md', exists: false }],
  });
  assert.match(prompt, /premise\.md \(missing: create when established meaning exists\)/);
  assert.match(prompt, /Draft tools are the only way/);
  assert.match(prompt, /path marked missing, do not try to read it/);
  assert.match(prompt, /prose-only Thought performs no synchronization and is invalid/);
  assert.match(syncObservePromptV1('init'), /missing proof that the granted Draft was inspected or written/);
  assert.match(syncObservePromptV1('init'), /Do not call, emit, or simulate any tool/);
  assert.match(syncCheckPromptV1(), /entire Observe is exactly two non-empty lines/);
  assert.match(syncCheckPromptV1(), /DSML/);
});
