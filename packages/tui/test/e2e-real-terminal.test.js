import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { stripVTControlCharacters } from 'node:util';

const packageRoot = path.resolve(import.meta.dirname, '..');
const repoRoot = path.resolve(packageRoot, '..', '..');
const mainPath = path.join(packageRoot, 'dist', 'main.js');

test('real PTY: Hub shortcuts, resize, and quit work without an AI provider', async (t) => {
  const pty = await loadNodePty(t);
  if (!pty) return;
  const worldRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'dayloom-tui-hub-'));
  const session = spawnSession(pty, worldRoot);

  try {
    await session.waitForVisible(/未初始化/, 8_000);
    session.write('?');
    await session.waitForVisible(/Session 输入/, 8_000);
    session.resize(58, 18);
    session.write('s');
    await session.waitForVisible(/Initialized: no/, 8_000);
    session.write('q');

    assert.equal(await session.waitForExit(8_000), 0);
    assert.match(session.visibleOutput(), /World:/);
  } finally {
    await session.dispose();
    fs.rmSync(worldRoot, { recursive: true, force: true });
  }
});

test('real PTY: natural-language init streams one assistant message and submits explicitly', async (t) => {
  const pty = await loadNodePty(t);
  if (!pty) return;
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dayloom-tui-session-'));
  const worldRoot = path.join(root, 'world');
  fs.mkdirSync(worldRoot);
  const promptpileBin = createFakePromptpile(root);
  const session = spawnSession(pty, worldRoot, { PROMPTPILE_BIN: promptpileBin });

  try {
    await session.waitForVisible(/未初始化/, 8_000);
    session.write('\r');
    await session.waitForVisible(/你想从什么样的世界开始/, 8_000);
    session.resize(54, 20);

    await session.typeText('写实近未来');
    session.write('\x1b[13;5~');
    await session.waitForVisible(/这是连续输出的中文回复/, 8_000);
    await session.waitForVisible(/等待输入/, 8_000);

    session.write('\t');
    await session.waitForVisible(/消息\s+Up\/Down/, 8_000);
    session.write('\x1b[A');
    session.write('\x1b[B');
    await delay(100);
    session.write('\t');
    await delay(150);
    await session.typeText('/submit');
    session.write('\x1b[13;5~');
    await waitUntil(() => fs.existsSync(path.join(worldRoot, 'manifest.json')), {
      timeoutMs: 8_000,
      describe: () => `manifest.json to be created\n\n${session.visibleOutput()}`,
    });
    await session.waitForVisible(/空闲/, 8_000);
    const current = JSON.parse(fs.readFileSync(path.join(worldRoot, 'current.json'), 'utf8'));
    const commit = JSON.parse(fs.readFileSync(
      path.join(worldRoot, 'commits', `${current.commitId}.json`),
      'utf8',
    ));
    assert.equal(commit.world.phase, 'idle');

    session.write('q');
    assert.equal(await session.waitForExit(8_000), 0);
    const visible = session.visibleOutput();
    assert.match(visible, /这是连续输出的中文回复/);
    assert.match(
      visible.replace(/\s/g, ''),
      /这是连续输出的中文回复，用于验证窄终端中的中文自动换行不会丢失行尾字符，也不会把每个流式片段拆成独立消息。/,
    );
    assert.doesNotMatch(visible, /每个词都成了一行/);
  } finally {
    await session.dispose();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('real PTY: Session cancel returns to Hub and restores Hub focus', async (t) => {
  const pty = await loadNodePty(t);
  if (!pty) return;
  const worldRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'dayloom-tui-cancel-'));
  const session = spawnSession(pty, worldRoot);

  try {
    await session.waitForVisible(/未初始化/, 8_000);
    session.write('\r');
    await session.waitForVisible(/\/submit 提交/, 8_000);
    await session.typeText('/exit');
    session.write('\x1b[13;5~');
    await session.waitForVisible(/会话已取消/, 8_000);
    session.resize(72, 22);
    session.write('?');
    await session.waitForVisible(/Session 输入/, 8_000);
    session.write('q');

    assert.equal(await session.waitForExit(8_000), 0);
  } finally {
    await session.dispose();
    fs.rmSync(worldRoot, { recursive: true, force: true });
  }
});

test('real PTY: partial AI failure remains visible and can be cancelled', async (t) => {
  const pty = await loadNodePty(t);
  if (!pty) return;
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dayloom-tui-ai-failure-'));
  const worldRoot = path.join(root, 'world');
  fs.mkdirSync(worldRoot);
  const session = spawnSession(pty, worldRoot, {
    PROMPTPILE_BIN: createFakePromptpile(root, 'ai-failure'),
  });

  try {
    await session.waitForVisible(/未初始化/, 8_000);
    session.write('\r');
    await session.waitForVisible(/等待输入/, 8_000);
    await session.typeText('触发失败');
    session.write('\x1b[13;5~');
    await session.waitForVisible(/部分回复/, 8_000);
    await session.waitForVisible(/会话失败/, 8_000);

    await session.typeText('/exit');
    session.write('\x1b[13;5~');
    await session.waitForVisible(/会话已取消/, 8_000);
    session.write('q');
    assert.equal(await session.waitForExit(8_000), 0);
  } finally {
    await session.dispose();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('real PTY: invalid submit payload stays in Session and supports recovery', async (t) => {
  const pty = await loadNodePty(t);
  if (!pty) return;
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dayloom-tui-submit-failure-'));
  const worldRoot = path.join(root, 'world');
  fs.mkdirSync(worldRoot);
  const session = spawnSession(pty, worldRoot, {
    PROMPTPILE_BIN: createFakePromptpile(root, 'invalid-submit'),
  });

  try {
    await session.waitForVisible(/未初始化/, 8_000);
    session.write('\r');
    await session.waitForVisible(/等待输入/, 8_000);
    await session.typeText('/submit');
    session.write('\x1b[13;5~');
    await session.waitForVisible(/invalid submit payload/, 8_000);
    await session.waitForVisible(/会话失败/, 8_000);

    await session.typeText('/cancel');
    session.write('\x1b[13;5~');
    await session.waitForVisible(/会话已取消/, 8_000);
    session.write('q');
    assert.equal(await session.waitForExit(8_000), 0);
  } finally {
    await session.dispose();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

function spawnSession(pty, worldRoot, extraEnv = {}) {
  return new PtyHarness(
    pty.spawn(process.execPath, [mainPath, worldRoot], {
      name: 'xterm-256color',
      cols: 100,
      rows: 30,
      cwd: repoRoot,
      env: {
        ...process.env,
        ...extraEnv,
        TERM: 'xterm-256color',
        FORCE_COLOR: '0',
      },
    }),
  );
}

function createFakePromptpile(root, mode = 'success') {
  const bin = path.join(root, 'fake-promptpile');
  fs.writeFileSync(
    bin,
    [
      '#!/usr/bin/env node',
      "const fs = require('node:fs');",
      "const path = require('node:path');",
      "const system = fs.readFileSync(path.join(process.cwd(), 'messages', '[0]system.md'), 'utf8');",
      `const mode = ${JSON.stringify(mode)};`,
      "if (mode === 'ai-failure' && !system.includes('提交产物生成器')) {",
      "  fs.writeSync(3, JSON.stringify({ type: 'assistant_delta', content: '部分回复' }) + '\\n');",
      "  fs.writeSync(3, JSON.stringify({ type: 'error', message: 'provider failed' }) + '\\n');",
      "  process.exit(1);",
      "}",
      "const content = mode === 'invalid-submit' && system.includes('提交产物生成器')",
      "  ? 'not-json'",
      "  : system.includes('提交产物生成器')",
      "  ? JSON.stringify({ id: 'pty-world', title: 'PTY World', premise: '近未来', rules: '写实', style: '克制', userRole: '调查员' })",
      "  : '这是连续输出的中文回复，用于验证窄终端中的中文自动换行不会丢失行尾字符，也不会把每个流式片段拆成独立消息。';",
      "const middle = Math.ceil(content.length / 2);",
      "fs.writeSync(3, JSON.stringify({ type: 'assistant_delta', content: content.slice(0, middle) }) + '\\n');",
      "fs.writeSync(3, JSON.stringify({ type: 'assistant_delta', content: content.slice(middle) }) + '\\n');",
      "fs.writeSync(3, JSON.stringify({ type: 'assistant_done' }) + '\\n');",
    ].join('\n'),
    { mode: 0o755 },
  );
  return bin;
}

async function loadNodePty(t) {
  try {
    return await import('node-pty');
  } catch (error) {
    t.skip(`node-pty unavailable: ${error instanceof Error ? error.message : String(error)}`);
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

  resize(cols, rows) {
    this.ptyProcess.resize(cols, rows);
  }

  async typeText(value) {
    for (const character of value) {
      this.write(character);
      await delay(25);
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
