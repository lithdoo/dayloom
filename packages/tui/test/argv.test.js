import assert from 'node:assert/strict';
import test from 'node:test';
import { parseArgv } from '../dist/argv.js';

test('parseArgv parses world dir and shell options', () => {
  const parsed = parseArgv([
    'node',
    'dayloom-tui',
    './world',
    '--locale',
    'zh',
    '--no-auto-start',
    '--quick',
    '--dry-run',
    '--yes',
    '--max-rounds',
    '3',
    '--mcp-base-url',
    'http://localhost:3000',
  ]);

  assert.equal(parsed.worldDir, './world');
  assert.equal(parsed.locale, 'zh');
  assert.equal(parsed.autoStart, false);
  assert.deepEqual(parsed.shellOptions, {
    quick: true,
    dryRun: true,
    yes: true,
    maxRounds: 3,
    mcpBaseUrl: 'http://localhost:3000',
  });
});

test('parseArgv rejects unknown options', () => {
  assert.throws(
    () => parseArgv(['node', 'dayloom-tui', '--wat']),
    /Unknown option/,
  );
});
