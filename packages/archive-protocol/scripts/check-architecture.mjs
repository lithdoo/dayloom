import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const forbidden = [
  /(?:from\s+|require\()['"]node:fs(?:\/promises)?['"]/, /(?:from\s+|require\()['"]child_process['"]/,
  /['"]@dayloom\/(?:core|tui)(?:\/[^'"]*)?['"]/, /['"]promptpile[^'"]*['"]/,
];
const source = fileURLToPath(new URL('../src', import.meta.url));
for (const name of await readdir(source)) {
  if (!name.endsWith('.ts')) continue;
  const text = await readFile(join(source, name), 'utf8');
  for (const pattern of forbidden) {
    if (pattern.test(text)) throw new Error(`${name}: forbidden dependency ${pattern}`);
  }
}
