'use strict';

const fs = require('fs');
const path = require('path');

const REQUIRED_FILES = [
  'manifest.yaml',
  'current.yaml',
  'config.yaml',
  'canon/premise.md',
  'canon/rules.md',
  'canon/style.md',
  'canon/user_role.md',
  'state/world.yaml',
  'state/calendar.yaml',
  'state/progress.yaml',
  'state/variables.yaml',
  'characters/index.yaml',
  'scenes/index.yaml',
  'arcs/index.yaml',
  'memory/short_term.md',
  'memory/long_term.md',
  'memory/facts.yaml',
  'memory/unresolved_threads.yaml',
  'memory/important_events.yaml',
  'logs/state_changes.jsonl',
  'logs/generation_trace.md',
  'logs/errors.md',
];

const REQUIRED_DIRS = [
  'days',
  'exports/diaries',
  'exports/summaries',
];

const MODES = new Set(['quick', 'interactive', 'existing', 'revise']);

function parseArgs(argv) {
  const args = argv.slice(2);
  let worldRoot = null;
  let mode = 'quick';

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === '--mode') {
      mode = args[i + 1] || 'quick';
      i += 1;
    } else if (!arg.startsWith('-') && !worldRoot) {
      worldRoot = arg;
    }
  }

  if (!worldRoot) {
    console.error('Usage: node verify-world.js <worldRoot> [--mode quick|interactive|existing|revise]');
    process.exit(1);
  }

  if (!MODES.has(mode)) {
    console.error(`Unknown mode: ${mode}`);
    process.exit(1);
  }

  return { worldRoot: path.resolve(worldRoot), mode };
}

function fail(errors) {
  console.error('verify-world: FAILED');
  for (const err of errors) console.error(`  - ${err}`);
  process.exit(1);
}

function readText(filePath) {
  return fs.readFileSync(filePath, 'utf8');
}

function fileExists(root, rel) {
  return fs.existsSync(path.join(root, rel));
}

function nonEmpty(content) {
  return typeof content === 'string' && content.trim().length > 0;
}

function yamlFieldNonEmpty(content, field) {
  const match = content.match(new RegExp(`^${field}:\\s*(.+)$`, 'm'));
  if (!match) return false;
  const value = match[1].trim();
  return value.length > 0 && value !== '""' && value !== "''";
}

function verifyCommon(worldRoot, errors) {
  if (!fs.existsSync(worldRoot)) {
    errors.push(`world root does not exist: ${worldRoot}`);
    return;
  }

  for (const rel of REQUIRED_FILES) {
    if (!fileExists(worldRoot, rel)) errors.push(`missing file: ${rel}`);
  }

  for (const rel of REQUIRED_DIRS) {
    const full = path.join(worldRoot, rel);
    if (!fs.existsSync(full) || !fs.statSync(full).isDirectory()) errors.push(`missing directory: ${rel}`);
  }

  const manifestPath = path.join(worldRoot, 'manifest.yaml');
  if (fs.existsSync(manifestPath)) {
    const manifest = readText(manifestPath);
    if (!yamlFieldNonEmpty(manifest, 'id')) errors.push('manifest.yaml: id is empty');
    if (!yamlFieldNonEmpty(manifest, 'title')) errors.push('manifest.yaml: title is empty');
    if (!yamlFieldNonEmpty(manifest, 'protocol_version')) errors.push('manifest.yaml: protocol_version is empty');
  }

  const currentPath = path.join(worldRoot, 'current.yaml');
  if (fs.existsSync(currentPath) && !/^day:\s*day_\d+/im.test(readText(currentPath))) {
    errors.push('current.yaml: expected a day_* pointer');
  }
}

function verifyEmptyDays(worldRoot, errors) {
  const daysDir = path.join(worldRoot, 'days');
  if (!fs.existsSync(daysDir)) return;
  const dayEntries = fs.readdirSync(daysDir).filter(name => /^day_\d+/i.test(name));
  if (dayEntries.length > 0) errors.push(`days/ must be empty at init, found: ${dayEntries.join(', ')}`);
}

function verifyQuick(worldRoot, errors) {
  verifyEmptyDays(worldRoot, errors);
  const charsDir = path.join(worldRoot, 'characters');
  const charIndexPath = path.join(charsDir, 'index.yaml');
  if (!fs.existsSync(charIndexPath)) return;
  const index = readText(charIndexPath);
  const charDirs = fs.readdirSync(charsDir, { withFileTypes: true }).filter(e => e.isDirectory()).map(e => e.name);
  if (charDirs.length > 0) errors.push(`quick mode: expected no character subdirs, found: ${charDirs.join(', ')}`);
  if (!/characters:\s*\[\]/i.test(index) && /characters:\s*\n\s*-\s+\S+/i.test(index)) {
    errors.push('quick mode: characters/index.yaml should list no characters');
  }
}

function verifyInteractive(worldRoot, errors) {
  verifyEmptyDays(worldRoot, errors);
  for (const rel of ['canon/premise.md', 'canon/rules.md', 'canon/style.md', 'canon/user_role.md']) {
    const full = path.join(worldRoot, rel);
    if (fs.existsSync(full) && !nonEmpty(readText(full))) errors.push(`interactive mode: ${rel} is empty`);
  }

  const worldYamlPath = path.join(worldRoot, 'state', 'world.yaml');
  if (fs.existsSync(worldYamlPath) && !yamlFieldNonEmpty(readText(worldYamlPath), 'title')) {
    errors.push('interactive mode: state/world.yaml title is empty');
  }

  const charsDir = path.join(worldRoot, 'characters');
  const charDirs = fs.existsSync(charsDir)
    ? fs.readdirSync(charsDir, { withFileTypes: true }).filter(e => e.isDirectory()).map(e => e.name)
    : [];
  if (charDirs.length === 0) errors.push('interactive mode: expected at least one character directory');
  for (const id of charDirs) {
    const profilePath = path.join(charsDir, id, 'profile.md');
    if (!fs.existsSync(profilePath) || !nonEmpty(readText(profilePath))) {
      errors.push(`interactive mode: characters/${id}/profile.md missing or empty`);
    }
  }

  const indexPath = path.join(charsDir, 'index.yaml');
  if (fs.existsSync(indexPath) && !/characters:\s*\n\s*-\s+\S+/i.test(readText(indexPath))) {
    errors.push('interactive mode: characters/index.yaml lists no characters');
  }

  const transcriptDir = path.join(worldRoot, '.loom', 'init-transcript');
  if (!fs.existsSync(transcriptDir)) errors.push('interactive mode: missing .loom/init-transcript/');
  else if (!fs.existsSync(path.join(transcriptDir, 'messages'))) errors.push('interactive mode: .loom/init-transcript/messages/ missing');
}

function verifyRevise(worldRoot, errors) {
  const stylePath = path.join(worldRoot, 'canon', 'style.md');
  if (!fs.existsSync(stylePath) || !readText(stylePath).includes('轻松、细腻')) {
    errors.push('revise mode: canon/style.md was not updated');
  }

  const scenePath = path.join(worldRoot, 'scenes', 'scene_library', 'profile.md');
  if (!fs.existsSync(scenePath) || !nonEmpty(readText(scenePath))) {
    errors.push('revise mode: scenes/scene_library/profile.md missing or empty');
  }

  const revisionsDir = path.join(worldRoot, '.loom', 'revisions');
  const revisions = fs.existsSync(revisionsDir)
    ? fs.readdirSync(revisionsDir).filter(name => /^revision_/.test(name))
    : [];
  if (revisions.length === 0) {
    errors.push('revise mode: no revision archive found');
  } else {
    const latest = revisions.sort().at(-1);
    for (const rel of ['payload.json', 'changes.txt']) {
      if (!fs.existsSync(path.join(revisionsDir, latest, rel))) errors.push(`revise mode: revision archive missing ${rel}`);
    }
  }

  const logPath = path.join(worldRoot, 'logs', 'state_changes.jsonl');
  if (!fs.existsSync(logPath) || !readText(logPath).includes('"type":"world_revision"')) {
    errors.push('revise mode: world_revision log entry missing');
  }
}

function main() {
  const { worldRoot, mode } = parseArgs(process.argv);
  const errors = [];

  verifyCommon(worldRoot, errors);
  if (mode === 'quick') verifyQuick(worldRoot, errors);
  if (mode === 'interactive') verifyInteractive(worldRoot, errors);
  if (mode === 'revise') verifyRevise(worldRoot, errors);

  if (errors.length > 0) fail(errors);
  console.log(`verify-world: OK (${mode}) ${worldRoot}`);
}

main();
