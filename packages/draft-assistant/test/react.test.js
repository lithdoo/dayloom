import test from 'node:test';
import assert from 'node:assert/strict';
import { access, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { approvedFinalFromEventsV1, dialogueReactArgvV1, runDialogueReactV1, syncReactArgvV1 } from '../dist/react.js';
import { syncFinalPromptV1 } from '../dist/prompts.js';
import { capture } from './support/helpers.mjs';

const base = { config: 'config', conversation: 'conversation', workRoot: 'work' };

test('Dialogue persists Conversation and always consumes internal stream-json', () => {
  const argv = dialogueReactArgvV1({ ...base, outputFormat: 'stream-json' });
  assert.ok(argv.includes('--output-dir'));
  assert.ok(argv.includes('--continue'));
  assert.equal(argv[argv.indexOf('--max-step') + 1], '4');
  assert.equal(argv[argv.indexOf('--max-step-policy') + 1], 'error');
  assert.equal(argv[argv.indexOf('--observe-carryover') + 1], '1');
  assert.equal(argv[argv.indexOf('--output-format') + 1], 'stream-json');
});

test('terminal projection returns only the approved Final', () => {
  const events = [
    { type: 'phase.completed', content: 'internal thought' },
    { type: 'final.delta', content: 'approved' },
    { type: 'session.completed', final: { status: 'completed', content: 'approved reply' } },
  ];
  assert.equal(approvedFinalFromEventsV1(`${events.map(JSON.stringify).join('\n')}\n`), 'approved reply');
  assert.throws(() => approvedFinalFromEventsV1('{not-json}\n'), /malformed/);
});

test('Dialogue output adapter hides phases for terminal and preserves native stream-json', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'assistant-output-projection-'));
  try {
    const phaseRoot = path.join(root, 'phase');
    await mkdir(phaseRoot);
    const events = [
      { type: 'phase.completed', content: 'SECRET_THOUGHT' },
      { type: 'phase.completed', content: '[REVIEW] SECRET_REVIEW' },
      { type: 'session.completed', final: { status: 'completed', content: 'Approved only.' } },
    ];
    const jsonl = `${events.map(JSON.stringify).join('\n')}\n`;
    const reactBin = path.join(root, 'react.mjs');
    await writeFile(reactBin, `import fs from 'node:fs';\nfs.writeFileSync('fake.req.json', '{}');\nprocess.stdout.write(${JSON.stringify(jsonl)});\n`);
    const baseInput = { reactBin, config: 'config', conversation: 'conversation', workRoot: path.join(phaseRoot, 'work') };
    const terminal = capture();
    assert.equal(await runDialogueReactV1({ ...baseInput, outputFormat: 'terminal', stdout: terminal.stdout, stderr: terminal.stderr }), 0);
    assert.equal(terminal.out(), 'Approved only.\n');
    assert.doesNotMatch(terminal.out(), /SECRET/);
    const stream = capture();
    assert.equal(await runDialogueReactV1({ ...baseInput, outputFormat: 'stream-json', stdout: stream.stdout, stderr: stream.stderr }), 0);
    assert.equal(stream.out(), jsonl);
    await access(path.join(phaseRoot, 'fake.req.json'));
    await assert.rejects(() => access(path.join(root, 'fake.req.json')));
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('Sync is read-only on Conversation, hides behind terminal capture, and skips Final', () => {
  const argv = syncReactArgvV1(base);
  assert.equal(argv.includes('--output-dir'), false);
  assert.equal(argv.includes('--continue'), false);
  assert.equal(argv[argv.indexOf('--max-step') + 1], '6');
  assert.equal(argv[argv.indexOf('--output-format') + 1], 'terminal');
  assert.equal(syncFinalPromptV1(), '');
});
