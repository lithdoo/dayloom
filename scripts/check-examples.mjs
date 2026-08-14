import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = fileURLToPath(new URL('../', import.meta.url));
const examplesRoot = path.join(repoRoot, 'examples');
const expectedFiles = new Set([
  'dayloom-tui/.gitignore',
  'dayloom-tui/README.md',
  'dayloom-tui/init-world.mjs',
  'dayloom-tui/llm.example.toml',
  'dayloom-tui/open-world.bat',
  'dayloom-tui/open-world.sh',
  'dayloom-tui/verify-resize.bat',
]);
const forbiddenContent = [
  { label: 'legacy package or path', pattern: /(?:@dayloom\/(?:cli|core(?:-old)?|tui-old)(?![\w-])|packages\/(?:core-old|tui-old)(?![\w-]))/i },
  { label: 'legacy command', pattern: /\bdayloom\s+(?:init|daily|revise|settle)\b/i },
  { label: 'legacy World layout', pattern: /(?:manifest\.yaml|current\.yaml|(?:^|[\\/])\.loom(?:[\\/]|$))/im },
  { label: 'legacy provider override', pattern: /DAYLOOM_LLM_(?:MODEL|BASE_URL|API_NAME|API_KEY_ENV)/ },
  { label: 'MCP configuration', pattern: /(?:PROMPTPILE_MCP_|\bMCP\b)/i },
];

async function files(directory) {
  const result = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const target = path.join(directory, entry.name);
    const relative = path.relative(examplesRoot, target).split(path.sep).join('/');
    if (entry.isDirectory() && (entry.name === '.runtime' || relative === 'dayloom-tui/world')) continue;
    if (entry.isFile() && relative === 'dayloom-tui/llm.toml') continue;
    if (entry.isDirectory()) result.push(...await files(target));
    else if (entry.isFile()) result.push(target);
  }
  return result;
}

const violations = [];
const actualFiles = await files(examplesRoot);
const relativeFiles = actualFiles.map((file) => path.relative(examplesRoot, file).split(path.sep).join('/'));

for (const expected of expectedFiles) {
  if (!relativeFiles.includes(expected)) violations.push(`examples/${expected}: required file is missing`);
}
for (const relative of relativeFiles) {
  if (!expectedFiles.has(relative)) violations.push(`examples/${relative}: unexpected example file`);
}

for (let index = 0; index < actualFiles.length; index += 1) {
  const source = await readFile(actualFiles[index], 'utf8');
  for (const rule of forbiddenContent) {
    if (rule.pattern.test(source)) violations.push(`examples/${relativeFiles[index]}: ${rule.label}`);
  }
}

const launchers = ['dayloom-tui/open-world.sh', 'dayloom-tui/open-world.bat', 'dayloom-tui/verify-resize.bat'];
for (const launcher of launchers) {
  const source = await readFile(path.join(examplesRoot, ...launcher.split('/')), 'utf8');
  if (!source.includes('--llm-config')) violations.push(`examples/${launcher}: current TUI must receive --llm-config`);
  if (!source.includes('@dayloom/archive-protocol') || !source.includes('@dayloom/core2') || !source.includes('@dayloom/tui')) {
    violations.push(`examples/${launcher}: required current packages are not built`);
  }
}

if (violations.length > 0) {
  console.error(violations.join('\n'));
  process.exitCode = 1;
} else {
  console.log(`Examples architecture check passed (${actualFiles.length} files).`);
}
