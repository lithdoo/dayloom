import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const docRoot = path.join(projectRoot, 'doc');
const excludedDirectories = new Set(['.vitepress', 'archive', 'redirects']);
const metadataExempt = new Set(['index.md']);
const forbiddenPublishedTerms = ['@dayloom/core2', 'packages/core2', '@dayloom/cli', 'core-old', 'tui-old'];
const errors = [];

const activeFiles = walk(docRoot).filter((file) => {
  const relative = path.relative(docRoot, file);
  return file.endsWith('.md') && !relative.split(path.sep).some((part) => excludedDirectories.has(part));
});
const publishedFiles = [
  ...activeFiles,
  path.join(projectRoot, 'README.md'),
  path.join(projectRoot, 'packages', 'core', 'README.md'),
  path.join(projectRoot, 'packages', 'tui', 'README.md'),
  path.join(projectRoot, 'examples', 'dayloom-tui', 'README.md'),
];

for (const file of publishedFiles) {
  const isSiteDocument = file.startsWith(docRoot + path.sep);
  const relative = path.relative(isSiteDocument ? docRoot : projectRoot, file).split(path.sep).join('/');
  const source = fs.readFileSync(file, 'utf8');

  if (isSiteDocument && !metadataExempt.has(relative)) {
    for (const marker of ['**\u72b6\u6001**', '**\u6700\u540e\u6838\u5bf9**']) {
      if (!source.includes(marker)) errors.push(`${relative}: missing ${marker}`);
    }
  }

  for (const term of forbiddenPublishedTerms) {
    if (source.toLowerCase().includes(term)) errors.push(`${relative}: published docs contain ${term}`);
  }

  for (const match of source.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)) {
    const target = match[1].split('#', 1)[0];
    if (!target || /^(https?:|mailto:)/.test(target)) continue;
    if (isSiteDocument && target.startsWith('/')) {
      const candidate = path.join(docRoot, `${target.slice(1).replace(/\/$/, '/index')}.md`);
      if (!fs.existsSync(candidate)) errors.push(`${relative}: missing site target ${target}`);
      continue;
    }
    const candidate = path.resolve(path.dirname(file), target);
    if (isSiteDocument && !candidate.startsWith(docRoot + path.sep)) {
      errors.push(`${relative}: repository files must use an absolute GitHub URL (${target})`);
    } else if (!fs.existsSync(candidate)) {
      errors.push(`${relative}: missing relative target ${target}`);
    }
  }
}

if (errors.length > 0) {
  process.stderr.write(`${errors.join('\n')}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write(`Checked ${publishedFiles.length} published Markdown files.\n`);
}

function walk(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const target = path.join(directory, entry.name);
    return entry.isDirectory() ? walk(target) : [target];
  });
}
