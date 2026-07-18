import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { stripVTControlCharacters } from 'node:util';
import test from 'node:test';
import { pathToFileURL } from 'node:url';

const packageRoot = path.resolve(import.meta.dirname, '..');
const repoRoot = path.resolve(packageRoot, '..', '..');
const mainPath = path.join(packageRoot, 'dist', 'main.js');

test('real PTY: Hub Enter opens session, then Enter inserts newline in Textarea', { concurrency: false }, async (t) => {
  const pty = await loadNodePty(t);
  if (!pty) return;

  const worldDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dayloom-tui-e2e-world-'));
  const session = spawnSession(pty, worldDir);

  try {
    await session.waitForVisible(/Current: uninitialized/, 8_000);
    session.write('\r');
    await session.waitForVisible(/Enter your reply/, 8_000);

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

test('real PTY: Shift+Tab focus traversal returns to Textarea after entering session', { concurrency: false }, async (t) => {
  const pty = await loadNodePty(t);
  if (!pty) return;

  const worldDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dayloom-tui-e2e-world-'));
  const session = spawnSession(pty, worldDir);

  try {
    await session.waitForVisible(/Current: uninitialized/, 8_000);
    session.write('\r');
    await session.waitForVisible(/Enter your reply/, 8_000);
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

test('real PTY: session blocks /status with Ctrl+Enter', { concurrency: false }, async (t) => {
  await assertCtrlEnterSubmits(t, '\x1b[13;5~');
});

test('real PTY: Hub shortcuts switch status and help without Tab', { concurrency: false }, async (t) => {
  const pty = await loadNodePty(t);
  if (!pty) return;

  const worldDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dayloom-tui-e2e-world-'));
  const session = spawnSession(pty, worldDir);

  try {
    await session.waitForVisible(/Current: uninitialized/, 8_000);
    session.write('?');

    await session.waitForVisible(/对话页/, 8_000);
    await session.waitForVisible(/\/exit/, 8_000);

    session.write('s');

    await session.waitForVisible(/Current: uninitialized/, 8_000);
    session.write('\x03');

    const exitCode = await session.waitForExit(8_000);
    assert.equal(exitCode, 0);
  } finally {
    await session.dispose();
    fs.rmSync(worldDir, { recursive: true, force: true });
    await delay(400);
  }
});

test('real PTY: autofocus accepts confirm answer without Tab', { concurrency: false }, async (t) => {
  const pty = await loadNodePty(t);
  if (!pty) return;

  const session = spawnConfirmSession(pty);

  try {
    await session.waitForVisible(/Proceed\?/, 8_000);
    session.write('y');

    const exitCode = await session.waitForExit(8_000);
    assert.equal(exitCode, 0);
  } finally {
    await session.dispose();
    await delay(400);
  }
});

async function assertCtrlEnterSubmits(t, sequence) {
  const pty = await loadNodePty(t);
  if (!pty) return;

  const worldDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dayloom-tui-e2e-world-'));
  const session = spawnSession(pty, worldDir);

  try {
    await session.waitForVisible(/Current: uninitialized/, 8_000);
    session.write('\r');
    await session.waitForVisible(/Enter your reply/, 8_000);
    await session.typeText('/status');
    session.write(sequence);

    await session.waitForVisible(/当前正在会话中/, 8_000);
    session.write('\x03');

    const exitCode = await session.waitForExit(8_000);
    assert.equal(exitCode, 0);

    const visible = session.visibleOutput();
    assert.match(visible, /当前正在会话中/);
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

function spawnConfirmSession(pty) {
  return new PtyHarness(
    pty.spawn(process.execPath, ['--input-type=module', '--eval', confirmHarnessScript()], {
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

function confirmHarnessScript() {
  const appUrl = pathToFileURL(path.join(packageRoot, 'dist', 'app.js')).href;
  const viewModelUrl = pathToFileURL(path.join(packageRoot, 'dist', 'view-model.js')).href;

  return `
    import { mountApp } from ${JSON.stringify(appUrl)};
    import { createViewModel } from ${JSON.stringify(viewModelUrl)};

    const vm = createViewModel({ worldDir: process.cwd(), locale: 'en' });
    vm.setSessionPage('init');
    let mounted = mountApp(vm, {
      onExitRequest() {
        mounted?.dispose();
        process.exit(2);
      }
    });

    const timer = setTimeout(() => {
      mounted?.dispose();
      process.exit(3);
    }, 8000);

    vm.beginConfirm('Proceed?', (answer) => {
      clearTimeout(timer);
      mounted?.dispose();
      process.exit(answer ? 0 : 4);
    });
  `;
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
