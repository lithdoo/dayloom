import test from 'node:test';
import assert from 'node:assert/strict';
import { dialogueThoughtPromptV1, syncThoughtPromptV1 } from '../dist/prompts.js';

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
