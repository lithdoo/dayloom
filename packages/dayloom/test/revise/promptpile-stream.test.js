const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createPromptpileStreamConsumer } = require('../../dist/shared/promptpile-stream.js');
const { runProcess } = require('../../dist/revise/process-run.js');

test('promptpile stream consumer parses split JSONL deltas', () => {
  let output = '';
  let done = false;
  const consumer = createPromptpileStreamConsumer({
    onDelta: text => { output += text; },
    onDone: () => { done = true; }
  });
  consumer.push('{"type":"assistant_delta","content":"hel');
  consumer.push('lo"}\n{"type":"assistant_delta","content":" world"}\n');
  consumer.push('{"type":"assistant_done"}');
  consumer.flush();
  assert.equal(output, 'hello world');
  assert.equal(done, true);
});

test('promptpile stream consumer rejects invalid JSONL', () => {
  const consumer = createPromptpileStreamConsumer({ onDelta: () => undefined });
  consumer.push('{not json}');
  assert.throws(() => consumer.flush(), /Invalid promptpile stream JSON/);
});

test('runProcess exposes fd 3 output pile data', async () => {
  let streamed = '';
  const script = [
    "const fs = require('fs');",
    "fs.writeSync(3, JSON.stringify({ type: 'assistant_delta', content: 'hi' }) + '\\n');"
  ].join(' ');
  const result = await runProcess(process.execPath, ['-e', script], {
    cwd: process.cwd(),
    quiet: true,
    outputPile: {
      fd: 3,
      onData: chunk => { streamed += chunk; }
    }
  });
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0);
  assert.match(streamed, /assistant_delta/);
  assert.match(streamed, /hi/);
});

test('runProcess reports output pile data handler errors', async () => {
  const script = [
    "const fs = require('fs');",
    "fs.writeSync(3, 'bad\\n');",
    "setTimeout(() => {}, 1000);"
  ].join(' ');
  const result = await runProcess(process.execPath, ['-e', script], {
    cwd: process.cwd(),
    quiet: true,
    outputPile: {
      fd: 3,
      onData: () => { throw new Error('bad stream'); }
    }
  });
  assert.match(result.error && result.error.message, /bad stream/);
});
