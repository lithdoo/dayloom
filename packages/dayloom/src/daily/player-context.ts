import fs from 'fs';
import path from 'path';

export interface PlayerContextResult { root: string; }

export function buildPlayerContext(worldRoot: string, outputRoot: string): PlayerContextResult {
  fs.rmSync(outputRoot, { recursive: true, force: true });
  fs.mkdirSync(outputRoot, { recursive: true });
  copyDirFiles(worldRoot, outputRoot, 'canon', ['premise.md', 'rules.md', 'style.md', 'user_role.md']);
  copyProtagonist(worldRoot, outputRoot);
  copyKnownCharacters(worldRoot, outputRoot);
  copyKnownScenes(worldRoot, outputRoot);
  copyDirFiles(worldRoot, outputRoot, 'memory', ['short_term.md', 'long_term.md', 'facts.yaml']);
  writeRecentHistory(worldRoot, outputRoot);
  return { root: outputRoot };
}

function copyProtagonist(worldRoot: string, outputRoot: string): void {
  const id = findProtagonistId(worldRoot);
  const base = path.join(worldRoot, 'characters', id);
  const chunks: string[] = [`# Protagonist\n\nID: ${id}\n`];
  for (const file of ['profile.md', 'memory.md', 'timeline.md']) {
    const filePath = path.join(base, file);
    if (fs.existsSync(filePath)) chunks.push(`\n## ${file}\n\n${fs.readFileSync(filePath, 'utf8')}`);
  }
  writeFile(path.join(outputRoot, 'protagonist.md'), chunks.join('\n'));
}

function findProtagonistId(worldRoot: string): string {
  const charactersDir = path.join(worldRoot, 'characters');
  const preferred = path.join(charactersDir, 'char_protagonist');
  if (fs.existsSync(preferred)) return 'char_protagonist';
  if (!fs.existsSync(charactersDir)) return 'char_protagonist';
  const first = fs.readdirSync(charactersDir, { withFileTypes: true }).find(entry => entry.isDirectory())?.name;
  return first ?? 'char_protagonist';
}

function copyKnownCharacters(worldRoot: string, outputRoot: string): void {
  const charactersDir = path.join(worldRoot, 'characters');
  if (!fs.existsSync(charactersDir)) return;
  for (const entry of fs.readdirSync(charactersDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const src = path.join(charactersDir, entry.name, 'profile.md');
    if (fs.existsSync(src)) copyFile(src, path.join(outputRoot, 'known-characters', entry.name, 'profile.md'));
  }
}

function copyKnownScenes(worldRoot: string, outputRoot: string): void {
  const scenesDir = path.join(worldRoot, 'scenes');
  if (!fs.existsSync(scenesDir)) return;
  for (const entry of fs.readdirSync(scenesDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const src = path.join(scenesDir, entry.name, 'profile.md');
    if (fs.existsSync(src)) copyFile(src, path.join(outputRoot, 'known-scenes', entry.name, 'profile.md'));
  }
}

function copyDirFiles(worldRoot: string, outputRoot: string, relDir: string, files: string[]): void {
  for (const file of files) {
    const src = path.join(worldRoot, relDir, file);
    if (fs.existsSync(src)) copyFile(src, path.join(outputRoot, relDir, file));
  }
}

function writeRecentHistory(worldRoot: string, outputRoot: string): void {
  const daysDir = path.join(worldRoot, 'days');
  const lines: string[] = ['# Recent History', ''];
  if (fs.existsSync(daysDir)) {
    for (const day of fs.readdirSync(daysDir).sort().slice(-7)) {
      const diary = path.join(daysDir, day, 'diary.md');
      if (fs.existsSync(diary)) lines.push(`## ${day}`, '', fs.readFileSync(diary, 'utf8').trim(), '');
    }
  }
  writeFile(path.join(outputRoot, 'recent-history.md'), `${lines.join('\n').trim()}\n`);
}

function copyFile(src: string, dest: string): void { writeFile(dest, fs.readFileSync(src, 'utf8')); }
function writeFile(filePath: string, content: string): void { fs.mkdirSync(path.dirname(filePath), { recursive: true }); fs.writeFileSync(filePath, content, 'utf8'); }
