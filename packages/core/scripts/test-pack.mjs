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
  execFileSync('npm', ['install', '--ignore-scripts', '--prefix', consumer, protocolTarball, coreTarball], { stdio: 'inherit', shell: true });
  const smoke = `
    const core = require('@dayloom/core');
    const migration = require('@dayloom/core/migration');
    if (Object.keys(core).sort().join(',') !== 'CoreInitializationError,createDayloomCore') process.exit(1);
    if (Object.keys(migration).join(',') !== 'migrateLegacyWorldProfileV1') process.exit(1);
  `;
  execFileSync(process.execPath, ['-e', smoke], { cwd: consumer, stdio: 'inherit' });
  const cli = join(consumer, 'node_modules', '@dayloom', 'core', 'dist', 'migration', 'cli.js');
  const help = execFileSync(process.execPath, [cli, '--help'], { cwd: consumer, encoding: 'utf8' });
  if (!help.includes('dayloom-core archive migrate-world-profile-v1')) throw new Error('Packed migration CLI help is invalid.');
} finally {
  await rm(temporary, { recursive: true, force: true });
}
