import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { stripVTControlCharacters } from 'node:util';
import protocol from '@dayloom/archive-protocol';

const packageRoot = path.resolve(import.meta.dirname, '..');
const repoRoot = path.resolve(packageRoot, '..', '..');
const mainPath = path.join(packageRoot, 'dist', 'main.js');

test('real PTY: Core2 Hub supports shortcuts, resize, and quit', async (t) => {
  const pty = await loadNodePty(t); if (!pty) return;
  const fixture = createPlannedWorld();
  const session = spawnSession(pty, fixture.root, fixture.config);
  try {
    await session.waitForVisible(/已计划/, 8_000);
    assert.match(session.visibleOutput(), /进入行动/);
    session.write('?'); await session.waitForVisible(/Session 输入/, 8_000);
    session.resize(58, 18); session.write('s'); await session.waitForVisible(/Revision: 1/, 8_000);
    session.write('q'); assert.equal(await session.waitForExit(8_000), 0);
  } finally { await session.dispose(); fixture.cleanup(); }
});

test('real PTY: Core2 Play enters Session, cancel returns to Hub, and focus recovers', async (t) => {
  const pty = await loadNodePty(t); if (!pty) return;
  const fixture = createPlannedWorld();
  const session = spawnSession(pty, fixture.root, fixture.config);
  try {
    await session.waitForVisible(/已计划/, 8_000);
    session.write('\r'); await session.waitForVisible(/等待输入/, 8_000);
    await session.typeText('/exit'); await delay(100); session.write('\x1bOQ');
    await session.waitForVisible(/会话已取消/, 8_000);
    session.resize(72, 22); session.write('?'); await session.waitForVisible(/Session 输入/, 8_000);
    session.write('q'); assert.equal(await session.waitForExit(8_000), 0);
  } finally { await session.dispose(); fixture.cleanup(); }
});

function createPlannedWorld() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dayloom-tui-core2-'));
  const documents = new Map([
    ['canon/premise.md', Buffer.from('Premise')], ['canon/rules.md', Buffer.from('Rules')],
    ['canon/style.md', Buffer.from('Style')], ['canon/user-role.md', Buffer.from('User role')],
    ['days/day1/plan.json', Buffer.from(JSON.stringify({ intent: 'Live the day', beats: [{ id: 'beat1', intent: 'Begin' }] }))],
  ]);
  const entries = [...documents].map(([documentPath, bytes]) => {
    const blobHash = protocol.hashBlobV1(bytes); write(root, protocol.formatBlobObjectPathV1(blobHash), bytes);
    return { path: documentPath, blobHash, mediaType: documentPath.endsWith('.json') ? 'application/json' : 'text/markdown', bytes: bytes.length };
  });
  const tree = protocol.createRootTreeV1(entries), rootTreeHash = protocol.hashRootTreeV1(tree);
  write(root, protocol.formatTreeObjectPathV1(rootTreeHash), protocol.encodeRootTreeCanonicalV1(tree));
  const now = '2026-08-13T00:00:00.000Z';
  const commit = protocol.parseArchiveCommitV2({ schemaVersion: 2, id: 'commit_base', revision: 1, parentCommitId: null, operationId: 'op_init', createdAt: now, rootTreeHash, control: { phase: 'planned', day: 'day1', lastSettledDay: null } });
  write(root, protocol.formatCommitObjectPathV2(commit.id), JSON.stringify(commit));
  write(root, 'manifest.json', JSON.stringify({ schemaVersion: 2, worldId: 'world1', title: 'PTY World', createdAt: now }));
  write(root, 'current.json', JSON.stringify({ schemaVersion: 2, revision: 1, commitId: commit.id, updatedAt: now }));
  const config = path.join(root, 'llm.toml'); fs.writeFileSync(config, '[[llm_api]]\nname = "test"\nmodel = "test"\n');
  return { root, config, cleanup: () => fs.rmSync(root, { recursive: true, force: true }) };
}

function write(root, relative, bytes) { const target = path.join(root, ...relative.split('/')); fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, bytes); }
function spawnSession(pty, worldRoot, config) {
  return new PtyHarness(pty.spawn(process.execPath, [mainPath, worldRoot, '--llm-config', config], {
    name: 'xterm-256color', cols: 100, rows: 30, cwd: repoRoot,
    env: { ...process.env, TERM: 'xterm-256color', FORCE_COLOR: '0' },
  }));
}
async function loadNodePty(t) { try { return await import('node-pty'); } catch (error) { t.skip(`node-pty unavailable: ${error instanceof Error ? error.message : String(error)}`); return null; } }

class PtyHarness {
  #output = ''; #exitCode = null; #exitPromise; #dataDisposable; #exitDisposable; #disposed = false;
  constructor(ptyProcess) {
    this.ptyProcess = ptyProcess; this.#dataDisposable = ptyProcess.onData((chunk) => { this.#output += chunk; });
    this.#exitPromise = new Promise((resolve) => { this.#exitDisposable = ptyProcess.onExit(({ exitCode }) => { this.#exitCode = exitCode; resolve(exitCode); }); });
  }
  write(data) { this.ptyProcess.write(data); }
  resize(cols, rows) { this.ptyProcess.resize(cols, rows); }
  async typeText(value) { for (const character of value) { this.write(character); await delay(25); } }
  visibleOutput() { return stripVTControlCharacters(this.#output); }
  async waitForVisible(pattern, timeoutMs) { await waitUntil(() => pattern.test(this.visibleOutput()), timeoutMs, () => `visible output to match ${pattern}\n\n${this.visibleOutput()}`); }
  async waitForExit(timeoutMs) { await withTimeout(this.#exitPromise, timeoutMs, () => `PTY process to exit\n\n${this.visibleOutput()}`); return this.#exitCode; }
  async dispose() { if (this.#disposed) return; this.#disposed = true; this.#dataDisposable?.dispose(); this.#exitDisposable?.dispose(); try { this.ptyProcess.kill(); } catch {} try { await withTimeout(this.#exitPromise, 2_000, () => 'PTY dispose'); } catch {} }
}
async function waitUntil(predicate, timeoutMs, describe) { const started = Date.now(); while (Date.now() - started < timeoutMs) { if (predicate()) return; await delay(50); } throw new Error(`Timed out waiting for ${describe()}`); }
async function withTimeout(promise, timeoutMs, describe) { let timer; try { await Promise.race([promise, new Promise((_resolve, reject) => { timer = setTimeout(() => reject(new Error(`Timed out waiting for ${describe()}`)), timeoutMs); })]); } finally { clearTimeout(timer); } }
function delay(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }
