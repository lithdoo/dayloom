import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const packageRoot = fileURLToPath(new URL('../', import.meta.url));
const sourceRoot = process.env.TUI_ARCHITECTURE_ROOT || path.join(packageRoot, 'src');
const specifier = /(?:from\s+|import\s*(?:\(|)|require\s*\()\s*['"]([^'"]+)['"]/g;
const violations = [];

async function files(directory) {
  const result = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) result.push(...await files(target));
    else if (/\.[cm]?tsx?$/.test(entry.name)) result.push(target);
  }
  return result;
}

for (const file of await files(sourceRoot)) {
  const source = await readFile(file, 'utf8');
  for (const match of source.matchAll(specifier)) {
    if (/^@dayloom\/(?:core|core-old)(?:\/|$)/.test(match[1])) violations.push(`${file}: legacy Core import ${match[1]}`);
    if (/^@dayloom\/core2\//.test(match[1])) violations.push(`${file}: Core2 deep import ${match[1]}`);
  }
}
const packageJson = JSON.parse(await readFile(path.join(packageRoot, 'package.json'), 'utf8'));
if (packageJson.dependencies?.['@dayloom/core']) violations.push('package.json: legacy Core dependency');
if (packageJson.dependencies?.['@dayloom/core-old']) violations.push('package.json: legacy Core dependency');
if (!packageJson.dependencies?.['@dayloom/core2']) violations.push('package.json: missing Core2 dependency');
if (violations.length) { console.error(violations.join('\n')); process.exitCode = 1; }
