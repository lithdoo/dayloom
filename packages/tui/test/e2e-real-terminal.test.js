import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { stripVTControlCharacters } from 'node:util';

const packageRoot = path.resolve(import.meta.dirname, '..');
const repoRoot = path.resolve(packageRoot, '..', '..');
const productionMain = path.join(packageRoot, 'dist', 'main.js');
const scriptedMain = path.join(packageRoot, 'test', 'support', 'pty-entry.mjs');

test('production Core PTY smoke: empty Hub, help/status, resize, and clean quit', async (t) => {
  const pty = await loadNodePty(t); if (!pty) return;
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dayloom-tui-production-'));
  const world = path.join(root, 'world'), config = path.join(root, 'llm.toml');
  fs.mkdirSync(world); fs.writeFileSync(config, '[[llm_api]]\nname="test"\nmodel="test"\n');
  const session = spawn(pty, productionMain, [world, '--llm-config', config]);
  try {
    await session.waitForVisible(/未初始化/, 10_000);
    session.write('?'); await session.waitForVisible(/Session 输入/, 5_000);
    session.resize(58, 18); session.write('s'); await session.waitForVisible(/Status: 未初始化/, 5_000);
    session.write('q'); assert.equal(await session.waitForExit(8_000), 0);
  } finally { await session.dispose(); fs.rmSync(root, { recursive: true, force: true }); }
});

test('scripted PTY: natural language streams one message and explicit submit returns Hub', async (t) => {
  const pty = await loadNodePty(t); if (!pty) return;
  const session = spawn(pty, scriptedMain);
  try {
    await session.waitForVisible(/未初始化/, 8_000); session.write('\r');
    await session.waitForVisible(/你想从什么样的世界开始/, 5_000); session.resize(54, 20);
    await session.submitText('写实近未来'); await session.waitForVisible(/这是连续输出的中文回复/, 5_000);
    await session.waitForVisible(/等待输入/, 5_000); await session.submitText('/submit');
    await session.waitForVisible(/会话已提交/, 5_000); session.write('q');
    assert.equal(await session.waitForExit(8_000), 0);
    assert.match(session.visibleOutput().replace(/\s/g, ''), /这是连续输出的中文回复，用于验证流式片段聚合。/);
  } finally { await session.dispose(); }
});

test('scripted PTY: running /exit interrupts and cancel result owns Hub transition', async (t) => {
  const pty = await loadNodePty(t); if (!pty) return;
  const session = spawn(pty, scriptedMain, [], { DAYLOOM_TUI_TEST_SCENARIO: 'slow' });
  try {
    await session.waitForVisible(/未初始化/, 8_000); session.write('\r'); await session.waitForVisible(/等待输入/, 5_000);
    await session.submitText('开始'); await session.waitForVisible(/AI 回复中/, 5_000);
    await session.submitText('/exit'); await session.waitForVisible(/会话已取消/, 5_000);
    session.write('q'); assert.equal(await session.waitForExit(8_000), 0);
  } finally { await session.dispose(); }
});

test('scripted PTY: partial failure stays visible and dismiss keeps failed recent', async (t) => {
  const pty = await loadNodePty(t); if (!pty) return;
  const session = spawn(pty, scriptedMain, [], { DAYLOOM_TUI_TEST_SCENARIO: 'failure' });
  try {
    await session.waitForVisible(/未初始化/, 8_000); session.write('\r'); await session.waitForVisible(/等待输入/, 5_000);
    await session.submitText('触发失败'); await session.waitForVisible(/部分回复/, 5_000); await session.waitForVisible(/会话失败/, 5_000);
    await session.submitText('/exit'); await session.waitForVisible(/最近结果: 会话失败/, 5_000);
    assert.doesNotMatch(session.visibleOutput(), /最近结果: 会话已取消/);
    session.write('q'); assert.equal(await session.waitForExit(8_000), 0);
  } finally { await session.dispose(); }
});

function spawn(pty, entry, args = [], extraEnv = {}) {
  return new PtyHarness(pty.spawn(process.execPath, [entry, ...args], {
    name: 'xterm-256color', cols: 100, rows: 30, cwd: repoRoot,
    env: { ...process.env, ...extraEnv, TERM: 'xterm-256color', FORCE_COLOR: '0' },
  }));
}

async function loadNodePty(t) {
  try { return await import('node-pty'); }
  catch (error) {
    if (process.env.DAYLOOM_TUI_REQUIRE_PTY === '1') throw error;
    t.skip(`node-pty unavailable: ${error instanceof Error ? error.message : String(error)}`); return null;
  }
}

class PtyHarness {
  #output = ''; #exitCode = null; #exitPromise; #dataDisposable; #exitDisposable; #disposed = false;
  constructor(ptyProcess) {
    this.ptyProcess = ptyProcess;
    this.#dataDisposable = ptyProcess.onData((chunk) => { this.#output += chunk; });
    this.#exitPromise = new Promise((resolve) => { this.#exitDisposable = ptyProcess.onExit(({ exitCode }) => { this.#exitCode = exitCode; resolve(exitCode); }); });
  }
  write(data) { this.ptyProcess.write(data); }
  resize(cols, rows) { this.ptyProcess.resize(cols, rows); }
  async typeText(value) { for (const character of value) { this.write(character); await delay(12); } }
  async submitText(value) { await this.typeText(value); this.write('\x1bOQ'); await delay(80); }
  visibleOutput() { return stripVTControlCharacters(this.#output); }
  async waitForVisible(pattern, timeoutMs) { await waitUntil(() => pattern.test(this.visibleOutput()), timeoutMs, () => `${pattern}\n\n${this.visibleOutput()}`); }
  async waitForExit(timeoutMs) { await withTimeout(this.#exitPromise, timeoutMs, () => this.visibleOutput()); return this.#exitCode; }
  async dispose() {
    if (this.#disposed) return; this.#disposed = true; this.#dataDisposable?.dispose(); this.#exitDisposable?.dispose();
    try { this.ptyProcess.kill(); } catch {}
    try { await withTimeout(this.#exitPromise, 2_000, () => 'PTY dispose'); } catch {}
  }
}

async function waitUntil(predicate, timeoutMs, describe) {
  const started = Date.now(); while (Date.now() - started < timeoutMs) { if (predicate()) return; await delay(40); }
  throw new Error(`Timed out waiting for ${describe()}`);
}
async function withTimeout(promise, timeoutMs, describe) {
  let timer; try { await Promise.race([promise, new Promise((_resolve, reject) => { timer = setTimeout(() => reject(new Error(`Timed out waiting for ${describe()}`)), timeoutMs); })]); }
  finally { clearTimeout(timer); }
}
function delay(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }
