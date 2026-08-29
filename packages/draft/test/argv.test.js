import test from 'node:test';
import assert from 'node:assert/strict';
import { parseArgvV1 } from '../dist/argv.js';

const required = [
  '--world', './world',
  '--draft', './draft.md',
  '--conversation', './conversation',
  '--llm-config', './llm.toml',
  '--message', 'hello',
];

test('omitted command and default output-format are accepted', () => {
  const parsed = parseArgvV1(required);
  assert.equal(parsed.mode, 'run');
  assert.equal(parsed.command, null);
  assert.equal(parsed.outputFormat, 'terminal');
  assert.deepEqual(parsed.drafts, ['./draft.md']);
  assert.equal(parsed.draftDir, null);
});

test('explicit command and repeated --draft are preserved in order', () => {
  const parsed = parseArgvV1(['plan', '--world', './w', '--draft', 'a.md', '--draft', 'b.md', '--conversation', './c', '--llm-config', './l.toml', '--message', 'x', '--output-format', 'stream-json']);
  assert.equal(parsed.command, 'plan');
  assert.deepEqual(parsed.drafts, ['a.md', 'b.md']);
  assert.equal(parsed.outputFormat, 'stream-json');
});

test('--help and --version short-circuit without requiring other options', () => {
  assert.deepEqual(parseArgvV1(['--help']), { mode: 'help' });
  assert.deepEqual(parseArgvV1(['--version']), { mode: 'version' });
});

test('unknown, duplicate, missing, and mutually exclusive options fail before React', () => {
  assert.throws(() => parseArgvV1(['status', ...required]), (error) => error.code === 'INVALID_ARGUMENT');
  assert.throws(() => parseArgvV1([...required, '--world', './other']), (error) => error.code === 'INVALID_ARGUMENT');
  assert.throws(() => parseArgvV1(required.filter((part) => part !== '--world' && part !== './world')), (error) => error.code === 'INVALID_ARGUMENT');
  assert.throws(() => parseArgvV1([...required, '--draft-dir', './d']), (error) => error.code === 'INVALID_ARGUMENT');
  assert.throws(() => parseArgvV1(required.filter((part) => part !== '--draft' && part !== './draft.md')), (error) => error.code === 'INVALID_ARGUMENT');
  assert.throws(() => parseArgvV1([...required, '--output-format', 'json']), (error) => error.code === 'INVALID_ARGUMENT');
  assert.throws(() => parseArgvV1([...required, '--channel', 'x']), (error) => error.code === 'INVALID_ARGUMENT');
  assert.throws(() => parseArgvV1(['--message', '']), (error) => error.code === 'INVALID_ARGUMENT');
  assert.throws(() => parseArgvV1(['--world', './w', '--draft', './d.md', '--conversation', './c', '--llm-config', './l.toml', '--message', '   ']), (error) => error.code === 'INVALID_ARGUMENT');
});
