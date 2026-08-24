import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sourceRoot = path.join(packageRoot, 'src');
const forbiddenImports = [
  /from\s+['"]@dayloom\/(?:core2|core-old)['"]/,
  /from\s+['"]@dayloom\/core\/(?:src|dist)\//,
];
const forbiddenNames = [
  'RuntimeBackend', 'CoreBackend', 'BackendProvider', 'CommandRegistry', 'EventNormalizer',
  'SessionManager', 'OperationQueue', 'CancellationManager',
];

for (const file of walk(sourceRoot)) {
  const source = fs.readFileSync(file, 'utf8');
  for (const pattern of forbiddenImports) if (pattern.test(source)) fail(file, `forbidden import ${pattern}`);
  for (const name of forbiddenNames) if (new RegExp(`\\b${name}\\b`).test(source)) fail(file, `forbidden architecture name ${name}`);
}

function* walk(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) yield* walk(target);
    else if (/\.(?:ts|tsx)$/.test(entry.name)) yield target;
  }
}
function fail(file, message) { throw new Error(`${path.relative(packageRoot, file)}: ${message}`); }
