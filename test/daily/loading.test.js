const { test } = require('node:test');
const assert = require('node:assert/strict');
const { startLoading, withLoading } = require('../../dist/utils/loading.js');

function captureStream(isTTY = true) {
  let output = '';
  return {
    isTTY,
    write(chunk) {
      output += String(chunk);
      return true;
    },
    output: () => output,
  };
}

function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

test('loading stays silent for non-TTY output', async () => {
  const stream = captureStream(false);
  const loading = startLoading('working', { stream, delayMs: 0, intervalMs: 5 });
  await wait(15);
  loading.stop();
  assert.equal(stream.output(), '');
});

test('loading delay prevents fast operations from flashing', () => {
  const stream = captureStream();
  const loading = startLoading('working', { stream, delayMs: 50, intervalMs: 5 });
  loading.stop();
  assert.equal(stream.output(), '');
});

test('loading renders updates and clears the terminal line', async () => {
  const stream = captureStream();
  const loading = startLoading('first stage', { stream, delayMs: 0, intervalMs: 1000 });
  await wait(10);
  loading.update('second stage');
  loading.stop();
  assert.match(stream.output(), /first stage/);
  assert.match(stream.output(), /second stage/);
  assert.ok(stream.output().endsWith('\r\u001b[2K'));
});

test('withLoading clears the terminal line when the task fails', async () => {
  const stream = captureStream();
  await assert.rejects(
    withLoading('failing task', async () => {
      await wait(10);
      throw new Error('boom');
    }, { stream, delayMs: 0, intervalMs: 1000 }),
    /boom/,
  );
  assert.ok(stream.output().endsWith('\r\u001b[2K'));
});
