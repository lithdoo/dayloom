import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { stripVTControlCharacters } from 'node:util';
import test from 'node:test';

const packageRoot = path.resolve(import.meta.dirname, '..');
const repoRoot = path.resolve(packageRoot, '..', '..');
const mainPath = path.join(packageRoot, 'dist', 'main.js');

test('real PTY: Tab focus then Enter newline in Textarea', { concurrency: false }, async (t) => {
  const pty = await loadNodePty(t);
  if (!pty) return;

  const worldDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dayloom-tui-e2e-world-'));
  const session = spawnSession(pty, worldDir);

  try {
    await session.waitForVisible(/World:/, 8_000);
    await session.focusTextarea();

    await session.typeText('hello');
    session.write('\r');
    await delay(100);
    await session.typeText('world');

    await session.waitForVisible(/h\s*e\s*l\s*l\s*o/, 8_000);
    await session.waitForVisible(/w\s*o\s*r\s*l\s*d/, 8_000);
    session.write('\x03');

    const exitCode = await session.waitForExit(8_000);
    assert.equal(exitCode, 0);

    const visible = session.visibleOutput();
    assert.match(visible, /World:/);
    assert.doesNotMatch(visible, /Submit/);
  } finally {
    await session.dispose();
    fs.rmSync(worldDir, { recursive: true, force: true });
    await delay(400);
  }
});

test('real PTY: Shift+Tab focus traversal returns to Textarea', { concurrency: false }, async (t) => {
  const pty = await loadNodePty(t);
  if (!pty) return;

  const worldDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dayloom-tui-e2e-world-'));
  const session = spawnSession(pty, worldDir);

  try {
    await session.waitForVisible(/World:/, 8_000);
    await session.focusTextarea();
    await session.typeText('ab');
    await session.waitForVisible(/a\s*b/, 8_000);
    session.write('\x1b[Z');
    await delay(150);
    await session.focusTextarea(2);
    await session.typeText('cd');
    await session.waitForVisible(/c[\s\x08]*d/, 8_000);
    session.write('\x03');

    const exitCode = await session.waitForExit(8_000);
    assert.equal(exitCode, 0);
  } finally {
    await session.dispose();
    fs.rmSync(worldDir, { recursive: true, force: true });
    await delay(400);
  }
});

test('real PTY: Tab focus then /status with Ctrl+Enter', { concurrency: false }, async (t) => {
  await assertCtrlEnterSubmits(t, '\x1b[13;5~');
});

async function assertCtrlEnterSubmits(t, sequence) {
  const pty = await loadNodePty(t);
  if (!pty) return;

  const worldDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dayloom-tui-e2e-world-'));
  const session = spawnSession(pty, worldDir);

  try {
    await session.waitForVisible(/World:/, 8_000);
    await session.focusTextarea();
    await session.typeText('/status');
    session.write(sequence);

    await session.waitForVisible(/Current: uninitialized/, 8_000);
    await session.waitForVisible(/dayloom init -d/, 8_000);
    session.write('\x03');

    const exitCode = await session.waitForExit(8_000);
    assert.equal(exitCode, 0);

    const visible = session.visibleOutput();
    assert.match(visible, /Current: uninitialized/);
  } finally {
    await session.dispose();
    fs.rmSync(worldDir, { recursive: true, force: true });
    await delay(400);
  }
}

function spawnSession(pty, worldDir) {
  return new PtyHarness(
    pty.spawn(process.execPath, [mainPath, worldDir, '--no-auto-start', '--locale', 'en'], {
      name: 'xterm-256color',
      cols: 100,
      rows: 30,
      cwd: repoRoot,
      env: {
        ...process.env,
        TERM: 'xterm-256color',
        FORCE_COLOR: '0',
      },
    }),
  );
}

async function loadNodePty(t) {
  try {
    return await import('node-pty');
  } catch (err) {
    t.skip(`node-pty unavailable: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}

class PtyHarness {
  #output = '';
  #exitCode = null;
  #exitPromise;
  #dataDisposable;
  #exitDisposable;
  #disposed = false;

  constructor(ptyProcess) {
    this.ptyProcess = ptyProcess;
    this.#dataDisposable = ptyProcess.onData((chunk) => {
      this.#output += chunk;
    });
    this.#exitPromise = new Promise((resolve) => {
      this.#exitDisposable = ptyProcess.onExit(({ exitCode }) => {
        this.#exitCode = exitCode;
        resolve(exitCode);
      });
    });
  }

  write(data) {
    this.ptyProcess.write(data);
  }

  async focusTextarea(tabCount = 1) {
    for (let i = 0; i < tabCount; i += 1) {
      this.write('\t');
      await delay(80);
    }
    await delay(50);
  }

  async typeText(value) {
    for (const char of value) {
      this.write(char);
      await delay(30);
    }
  }

  visibleOutput() {
    return stripVTControlCharacters(this.#output);
  }

  async waitForVisible(pattern, timeoutMs) {
    await waitUntil(() => pattern.test(this.visibleOutput()), {
      timeoutMs,
      describe: () => `visible output to match ${pattern}\n\n${this.visibleOutput()}`,
    });
  }

  async waitForExit(timeoutMs) {
    await withTimeout(
      this.#exitPromise,
      timeoutMs,
      () => `PTY process to exit\n\n${this.visibleOutput()}`,
    );
    return this.#exitCode;
  }

  async dispose() {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#dataDisposable?.dispose();
    this.#exitDisposable?.dispose();
    try {
      this.ptyProcess.kill();
    } catch {
      // The process may already have exited.
    }
    try {
      await withTimeout(this.#exitPromise, 2_000, () => 'PTY dispose');
    } catch {
      // Best-effort cleanup between serial E2E runs.
    }
  }
}

async function waitUntil(predicate, options) {
  const started = Date.now();
  while (Date.now() - started < options.timeoutMs) {
    if (predicate()) return;
    await delay(50);
  }
  throw new Error(`Timed out waiting for ${options.describe()}`);
}

async function withTimeout(promise, timeoutMs, describe) {
  let timer;
  try {
    await Promise.race([
      promise,
      new Promise((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error(`Timed out waiting for ${describe()}`)), timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

function delay(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
