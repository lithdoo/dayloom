import test from 'node:test';
import assert from 'node:assert/strict';
import { parseAssistantArgvV1 } from '../dist/argv.js';

const common = ['--draft', 'draft.md', '--conversation', 'conversation', '--llm-config', 'llm.toml', '--message', 'hello'];

test('init omits World and omitted command infers init input shape', () => {
  const explicit = parseAssistantArgvV1(['init', ...common]);
  assert.equal(explicit.command, 'init');
  assert.equal(explicit.world, null);
  assert.equal(parseAssistantArgvV1(common).command, null);
});

test('world-bound commands require World and init rejects it', () => {
  assert.throws(() => parseAssistantArgvV1(['plan', ...common]), /requires --world/);
  assert.throws(() => parseAssistantArgvV1(['init', '--world', 'world', ...common]), /does not accept --world/);
  assert.equal(parseAssistantArgvV1(['play', '--world', 'world', ...common]).world, 'world');
});

test('parser rejects duplicate singleton, unknown, empty message, and invalid Draft selection', () => {
  assert.throws(() => parseAssistantArgvV1([...common, '--message', 'again']), /only once/);
  assert.throws(() => parseAssistantArgvV1([...common, '--unknown']), /Unknown argument/);
  assert.throws(() => parseAssistantArgvV1([...common.slice(0, -1), '  ']), /must not be empty/);
  assert.throws(() => parseAssistantArgvV1(['--conversation', 'c', '--llm-config', 'l', '--message', 'x']), /Exactly one/);
  assert.throws(() => parseAssistantArgvV1([...common, '--draft-dir', 'drafts']), /mutually exclusive/);
});

test('help and version short-circuit required options', () => {
  assert.deepEqual(parseAssistantArgvV1(['--help']), { mode: 'help' });
  assert.deepEqual(parseAssistantArgvV1(['--version']), { mode: 'version' });
});
