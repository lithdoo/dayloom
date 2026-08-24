import { execFileSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const tuiRoot = fileURLToPath(new URL('..', import.meta.url));
const packagesRoot = fileURLToPath(new URL('../../', import.meta.url));
const temporary = await mkdtemp(join(tmpdir(), 'dayloom-tui-pack-'));

try {
  const pack = (root) => {
    const result = JSON.parse(execFileSync('npm', ['pack', '--json', '--pack-destination', temporary], { cwd: root, encoding: 'utf8', shell: true }));
    return join(temporary, result[0].filename);
  };
  const tarballs = [
    pack(join(packagesRoot, 'archive-protocol')),
    pack(join(packagesRoot, 'core')),
    pack(tuiRoot),
  ];
  const consumer = join(temporary, 'consumer');
  await writeFile(join(temporary, 'package.json'), '{"private":true}\n');
  execFileSync('npm', ['install', '--ignore-scripts', '--prefix', consumer, ...tarballs], { stdio: 'inherit', shell: true });
  const api = `const tui=await import('@dayloom/tui');if(tui.tuiPackageName!=='@dayloom/tui')process.exit(1);`;
  execFileSync(process.execPath, ['--input-type=module', '-e', api], { cwd: consumer, stdio: 'inherit' });
  const cli = join(consumer, 'node_modules', '@dayloom', 'tui', 'dist', 'main.js');
  const help = execFileSync(process.execPath, [cli, '--help'], { cwd: consumer, encoding: 'utf8' });
  if (!help.includes('dayloom-tui')) throw new Error('Packed TUI CLI help is invalid.');
} finally {
  await rm(temporary, { recursive: true, force: true });
}
