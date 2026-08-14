import { spawn } from 'node:child_process';
import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const packageRoot = fileURLToPath(new URL('../', import.meta.url));
const testDirectory = path.join(packageRoot, 'test');
const testFiles = (await readdir(testDirectory))
  .filter((name) => name.endsWith('.test.js'))
  .sort()
  .map((name) => path.join(testDirectory, name));

if (testFiles.length === 0) throw new Error('No TUI test files were found.');

const child = spawn(process.execPath, ['--test', '--test-concurrency=1', ...testFiles], {
  cwd: packageRoot,
  stdio: 'inherit',
  windowsHide: true,
});

child.once('error', (error) => {
  console.error(error);
  process.exitCode = 1;
});
child.once('close', (code, signal) => {
  process.exitCode = code ?? (signal ? 1 : 0);
});
