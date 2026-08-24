import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { runGameShell } from '@dayloom/core-old';
import { createTuiSessionIO } from '../dist/session-io.js';
import { createViewModel } from '../dist/view-model.js';

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor(predicate, timeoutMs = 2_000) {
  const started = Date.now();
  while (!predicate()) {
    if (Date.now() - started > timeoutMs) {
      throw new Error('Timed out waiting for condition');
    }
    await delay(5);
  }
}

async function submitCommand(vm, value) {
  await waitFor(() => vm.inputMode.get() === 'text');
  vm.inputValue.set(value);
  vm.submitTextInput();
}

test('TuiSessionIO does not intercept /revise; shell recovers without stderr', async () => {
  const worldDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dayloom-tui-old-phase-d-'));
  fs.writeFileSync(path.join(worldDir, 'manifest.yaml'), 'id: test_world\n', 'utf8');
  fs.writeFileSync(
    path.join(worldDir, 'current.yaml'),
    'day: day_0001\nphase: idle\nlast_committed_day: null\n',
    'utf8',
  );

  const stderrChunks = [];
  const originalWrite = process.stderr.write.bind(process.stderr);
  process.stderr.write = ((chunk, encoding, cb) => {
    stderrChunks.push(String(chunk));
    if (typeof encoding === 'function') encoding();
    else if (typeof cb === 'function') cb();
    return true;
  });

  const previousKey = process.env.DEEPSEEK_API_KEY;
  delete process.env.DEEPSEEK_API_KEY;

  const vm = createViewModel({ worldDir, locale: 'en' });
  const io = createTuiSessionIO(vm);

  try {
    const shell = runGameShell({
      worldDir,
      io,
      t: vm.t,
      autoStart: false,
    });

    // /revise goes through SessionExit / handleShellCommand, not TuiSessionIO parsing.
    await submitCommand(vm, '/revise');
    await waitFor(() =>
      vm.messages.get().some(
        (message) =>
          message.role === 'error' && /DEEPSEEK_API_KEY|not initialized|World/i.test(message.text),
      ),
    );

    await submitCommand(vm, '/status');
    await waitFor(() =>
      vm.messages.get().some((message) => /Current:|Next action:/i.test(message.text)),
    );

    await submitCommand(vm, '/quit');
    await shell;

    assert.deepEqual(stderrChunks, []);
  } finally {
    process.stderr.write = originalWrite;
    if (previousKey === undefined) delete process.env.DEEPSEEK_API_KEY;
    else process.env.DEEPSEEK_API_KEY = previousKey;
    fs.rmSync(worldDir, { recursive: true, force: true });
  }
});

test('SessionIO write/warn/error never touch process.stderr', () => {
  const worldDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dayloom-tui-old-stderr-'));
  const stderrChunks = [];
  const originalWrite = process.stderr.write.bind(process.stderr);
  process.stderr.write = ((chunk, encoding, cb) => {
    stderrChunks.push(String(chunk));
    if (typeof encoding === 'function') encoding();
    else if (typeof cb === 'function') cb();
    return true;
  });

  try {
    const vm = createViewModel({ worldDir, locale: 'en' });
    const io = createTuiSessionIO(vm);
    io.write('hello\n');
    io.warn('careful');
    io.error('bad');
    assert.ok(vm.messages.get().some((message) => message.role === 'error'));
    assert.deepEqual(stderrChunks, []);
  } finally {
    process.stderr.write = originalWrite;
    fs.rmSync(worldDir, { recursive: true, force: true });
  }
});
