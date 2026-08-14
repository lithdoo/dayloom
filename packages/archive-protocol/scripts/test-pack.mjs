import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const packageRoot = fileURLToPath(new URL('..', import.meta.url));
const temporary = await mkdtemp(join(tmpdir(), 'dayloom-archive-protocol-'));
try {
  const pack = JSON.parse(execFileSync('npm', ['pack', '--json', '--pack-destination', temporary], { cwd: packageRoot, encoding: 'utf8', shell: true }));
  const tarball = join(temporary, pack[0].filename);
  const consumer = join(temporary, 'consumer');
  await writeFile(join(temporary, 'package.json'), '{"private":true}\n');
  execFileSync('npm', ['install', '--ignore-scripts', '--prefix', consumer, tarball], { stdio: 'inherit', shell: true });
  const smoke = `
    const root=require('@dayloom/archive-protocol');
    const path=require('@dayloom/archive-protocol/path');
    const tree=require('@dayloom/archive-protocol/tree');
    const staging=require('@dayloom/archive-protocol/staging');
    const bytes=Buffer.from('hello\\n');
    if(root.hashBlobV1(bytes)!=='5891b5b522d5df086d0ff0b110fbd9d21bb4fc7163af34d08286a2e846f6be03')process.exit(1);
    if(path.parseWorldDocumentPathV1('canon/premise.md')!=='canon/premise.md')process.exit(1);
    const value={schemaVersion:1,entries:[{path:'canon/premise.md',blobHash:root.hashBlobV1(bytes),mediaType:'text/markdown',bytes:6}]};
    if(tree.hashRootTreeV1(value)!=='27d96125ceeb206b70591066493ca295df224b1eeaee83fd25d67525ba186f10')process.exit(1);
    if(typeof staging.buildCandidateTreeV1!=='function')process.exit(1);
  `;
  execFileSync(process.execPath, ['-e', smoke], { cwd: consumer, stdio: 'inherit' });
  await readFile(tarball);
} finally {
  await rm(temporary, { recursive: true, force: true });
}
