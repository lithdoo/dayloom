import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const forbidden = [
  /(?:from\s+|require\()['"]node:fs(?:\/promises)?['"]/, /(?:from\s+|require\()['"]child_process['"]/,
  /(?:from\s+|require\()['"]node:(?:child_process|process)['"]/, /\bprocess\.(?:env|cwd)\b/,
  /['"]@dayloom\/(?:core|tui)(?:\/[^'"]*)?['"]/, /['"]promptpile[^'"]*['"]/,
];
const source = fileURLToPath(new URL('../src', import.meta.url));
for (const file of await sourceFiles(source)) {
  const text = await readFile(file, 'utf8');
  for (const pattern of forbidden) {
    if (pattern.test(text)) throw new Error(`${file}: forbidden dependency ${pattern}`);
  }
}

async function sourceFiles(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await sourceFiles(path));
    else if (entry.isFile() && entry.name.endsWith('.ts')) files.push(path);
  }
  return files;
}
