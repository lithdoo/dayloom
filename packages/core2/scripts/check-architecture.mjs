import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = process.env.CORE2_ARCHITECTURE_ROOT || fileURLToPath(new URL('../src/', import.meta.url));
const forbidden = [
  /^@dayloom\/(?:core|core-old|tui|tui-old)(?:\/|$)/,
  /^@dayloom\/archive-protocol\/(?:src|dist)\//,
  /^promptpile(?:-react)?\/(?:src|dist)\//,
  /^promptpile-protocol(?:\/|$)/,
];
const specifier = /(?:from\s+|import\s*(?:\(|)|require\s*\()\s*['"]([^'"]+)['"]/g;

async function files(directory) {
  const result = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) result.push(...await files(target));
    else if (/\.[cm]?tsx?$/.test(entry.name)) result.push(target);
  }
  return result;
}

const violations = [];
for (const file of await files(root)) {
  const source = await readFile(file, 'utf8');
  for (const match of source.matchAll(specifier)) {
    if (forbidden.some((rule) => rule.test(match[1]))) violations.push(`${file}: forbidden import ${match[1]}`);
  }
}
if (violations.length) {
  console.error(violations.join('\n'));
  process.exitCode = 1;
}
