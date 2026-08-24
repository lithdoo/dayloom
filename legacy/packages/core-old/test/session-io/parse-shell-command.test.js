const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parseShellLevelCommand } = require('../../dist/session-io/parse-shell-command.js');

test('parseShellLevelCommand recognizes shell-level commands', () => {
  assert.equal(parseShellLevelCommand('/revise'), 'revise');
  assert.equal(parseShellLevelCommand('/next'), 'next');
  assert.equal(parseShellLevelCommand('/quit'), 'quit');
  assert.equal(parseShellLevelCommand('/REVISE extra'), 'revise');
});

test('parseShellLevelCommand ignores session and plain text', () => {
  assert.equal(parseShellLevelCommand('/status'), undefined);
  assert.equal(parseShellLevelCommand('/help'), undefined);
  assert.equal(parseShellLevelCommand('hello'), undefined);
});
