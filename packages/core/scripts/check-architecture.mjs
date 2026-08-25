import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = process.env.CORE_ARCHITECTURE_ROOT || fileURLToPath(new URL('../src/', import.meta.url));
const forbidden = [
  /^@dayloom\/(?:core|core-old|tui|tui-old)(?:\/|$)/,
  /^@dayloom\/archive-protocol\/(?:src|dist)\//,
  /^promptpile(?:-react)?\/(?:src|dist)\//,
  /^promptpile-compress\/(?:src|dist)\//,
  /^promptpile-protocol\/(?:src|dist)\//,
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
    if (match[1] === 'promptpile-protocol' && !file.endsWith(`${path.sep}promptpile${path.sep}archive-retrieval-artifacts.ts`)) violations.push(`${file}: promptpile-protocol package root may only be imported by archive-retrieval-artifacts.ts`);
    if (forbidden.some((rule) => rule.test(match[1]))) violations.push(`${file}: forbidden import ${match[1]}`);
    if (file.endsWith(`${path.sep}session${path.sep}lifecycle.ts`) && match[1] === './play') violations.push(`${file}: shared Session policy must not be owned by Play`);
  }
  const sessionRoot = `${path.sep}session${path.sep}`;
  const promptsRoot = `${path.sep}session${path.sep}prompts${path.sep}`;
  if (file.includes(sessionRoot) && !file.includes(promptsRoot) && /\b(?:PROMPT|POLICY|GUIDE|DISCIPLINE|AUTHORITY_NOTE|SESSION_ROLE|SUBMIT_MARKER)\b\s*=\s*`/.test(source)) {
    violations.push(`${file}: model prompts must be owned by session/prompts`);
  }
}
const packageJson = JSON.parse(await readFile(fileURLToPath(new URL('../package.json', import.meta.url)), 'utf8'));
if (/play-only|minimal.*play runtime/i.test(packageJson.description)) violations.push('package description must describe the complete product lifecycle');
if (packageJson.exports?.['./prompts']?.require !== './dist/session/prompts/index.js') violations.push('package must export the dedicated Chinese prompts subpath');
if (violations.length) {
  console.error(violations.join('\n'));
  process.exitCode = 1;
}
