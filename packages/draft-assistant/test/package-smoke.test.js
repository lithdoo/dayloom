import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const repositoryRoot = fileURLToPath(new URL('../../../', import.meta.url));
const npmBin = process.platform === 'win32' ? 'npm.cmd' : 'npm';

test('packed assistant installs with its local publishable dependency closure and runs its bin', { timeout: 180_000 }, async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'dayloom-assistant-package-'));
  try {
    const packs = path.join(root, 'packs');
    const fresh = path.join(root, 'fresh');
    await mkdir(packs);
    await mkdir(fresh);
    await execFileAsync(npmBin, [
      'pack', '-w', '@dayloom/archive-protocol', '-w', '@dayloom/draft-assistant',
      '--pack-destination', packs,
    ], { cwd: repositoryRoot, windowsHide: true, shell: process.platform === 'win32', maxBuffer: 4 * 1024 * 1024 });

    const tarballs = {
      '@dayloom/archive-protocol': 'dayloom-archive-protocol-1.0.0-beta.1.tgz',
      '@dayloom/draft-assistant': 'dayloom-draft-assistant-1.0.0-beta.1.tgz',
    };
    await writeFile(path.join(fresh, 'package.json'), `${JSON.stringify({
      name: 'assistant-package-smoke',
      private: true,
      dependencies: Object.fromEntries(Object.entries(tarballs).map(([name, filename]) => [name, `file:${path.join(packs, filename)}`])),
    }, null, 2)}\n`);
    await execFileAsync(npmBin, ['install', '--ignore-scripts', '--no-audit', '--no-fund'], {
      cwd: fresh, windowsHide: true, shell: process.platform === 'win32', maxBuffer: 4 * 1024 * 1024,
    });

    const assistantPackage = JSON.parse(await readFile(path.join(fresh, 'node_modules', '@dayloom', 'draft-assistant', 'package.json'), 'utf8'));
    assert.equal(assistantPackage.private, undefined);
    assert.equal(assistantPackage.dependencies['@dayloom/cli'], undefined);
    assert.equal(assistantPackage.dependencies['@dayloom/draft'], undefined);
    assert.equal(assistantPackage.dependencies['promptpile-react'], '0.1.0-beta.7');
    const publicApi = await import(pathToFileURL(path.join(fresh, 'node_modules', '@dayloom', 'draft-assistant', 'dist', 'index.js')));
    assert.deepEqual(Object.keys(publicApi), ['executeDraftAssistantV1']);
    const bin = path.join(fresh, 'node_modules', '@dayloom', 'draft-assistant', 'dist', 'main.js');
    const help = await execFileAsync(process.execPath, [bin, '--help'], { cwd: fresh, windowsHide: true });
    assert.match(help.stdout, /dayloom-draft-assistant/);
    const version = await execFileAsync(process.execPath, [bin, '--version'], { cwd: fresh, windowsHide: true });
    assert.equal(version.stdout.trim(), '1.0.0-beta.1');

    const reactPackage = JSON.parse(await readFile(path.join(fresh, 'node_modules', 'promptpile-react', 'package.json'), 'utf8'));
    assert.equal(reactPackage.version, '0.1.0-beta.7');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
