import { execFileSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const coreRoot = fileURLToPath(new URL('..', import.meta.url));
const protocolRoot = fileURLToPath(new URL('../../archive-protocol/', import.meta.url));
const temporary = await mkdtemp(join(tmpdir(), 'dayloom-core-pack-'));

try {
  const pack = (root) => {
    const result = JSON.parse(execFileSync('npm', ['pack', '--json', '--pack-destination', temporary], { cwd: root, encoding: 'utf8', shell: true }));
    return join(temporary, result[0].filename);
  };
  const protocolTarball = pack(protocolRoot);
  const coreTarball = pack(coreRoot);
  const consumer = join(temporary, 'consumer');
  await writeFile(join(temporary, 'package.json'), '{"private":true}\n');
  execFileSync('npm', ['install', '--prefix', consumer, protocolTarball, coreTarball], { stdio: 'inherit', shell: true });
  const smoke = `
    const fs = require('node:fs');
    const path = require('node:path');
    const { execFileSync } = require('node:child_process');
    const core = require('@dayloom/core');
    if (Object.keys(core).sort().join(',') !== 'CoreInitializationError,createDayloomCore') process.exit(1);
    const prompts = require('@dayloom/core/prompts');
    if (!prompts.INIT_THOUGHT_PROMPT?.includes('世界设计师') || !prompts.buildDayloomCheckPrompt(false)?.includes('retrieval_available=false')) process.exit(4);
    const dist = path.dirname(require.resolve('@dayloom/core'));
    const { resolvePackagedBoundaries } = require(path.join(dist, 'promptpile', 'binaries.js'));
    resolvePackagedBoundaries().then((boundaries) => {
      for (const target of [boundaries.promptpileBin, boundaries.reactBin, boundaries.promptpileMcpBin, ...boundaries.filesystemMcp.argsPrefix]) {
        if (!path.isAbsolute(target) || !fs.statSync(target).isFile()) process.exit(2);
      }
      execFileSync(process.execPath, [boundaries.promptpileMcpBin, '--version'], { stdio: 'inherit' });
      execFileSync(boundaries.filesystemMcp.command, [...boundaries.filesystemMcp.argsPrefix, '--version'], { stdio: 'inherit' });
    }).catch((error) => { console.error(error); process.exit(3); });
  `;
  execFileSync(process.execPath, ['-e', smoke], { cwd: consumer, stdio: 'inherit' });
} finally {
  await rm(temporary, { recursive: true, force: true });
}
