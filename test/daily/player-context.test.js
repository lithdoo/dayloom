const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { buildPlayerContext } = require('../../dist/daily/player-context.js');

function tempDir() { return fs.mkdtempSync(path.join(os.tmpdir(), 'day-loom-player-context-')); }
function write(root, rel, content) { const file = path.join(root, rel); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, content, 'utf8'); }

test('buildPlayerContext exposes public profiles but excludes private memories and triggers', () => {
  const root = tempDir();
  write(root, 'manifest.yaml', 'id: x\n');
  write(root, 'canon/premise.md', '# Premise\n');
  write(root, 'characters/char_protagonist/profile.md', '# Me\n');
  write(root, 'characters/char_protagonist/memory.md', 'my memory\n');
  write(root, 'characters/char_npc/profile.md', '# NPC\n');
  write(root, 'characters/char_npc/memory.md', 'secret npc memory\n');
  write(root, 'characters/char_npc/relationships.md', 'secret relationship\n');
  write(root, 'scenes/scene_market/profile.md', '# Market\n');
  write(root, 'scenes/scene_market/triggers.yaml', 'secret: true\n');
  write(root, 'memory/short_term.md', 'known short\n');
  const out = path.join(root, 'context');

  buildPlayerContext(root, out);

  assert.equal(fs.readFileSync(path.join(out, 'canon', 'premise.md'), 'utf8'), '# Premise\n');
  assert.match(fs.readFileSync(path.join(out, 'protagonist.md'), 'utf8'), /my memory/);
  assert.equal(fs.readFileSync(path.join(out, 'known-characters', 'char_npc', 'profile.md'), 'utf8'), '# NPC\n');
  assert.equal(fs.existsSync(path.join(out, 'known-characters', 'char_npc', 'memory.md')), false);
  assert.equal(fs.existsSync(path.join(out, 'known-characters', 'char_npc', 'relationships.md')), false);
  assert.equal(fs.readFileSync(path.join(out, 'known-scenes', 'scene_market', 'profile.md'), 'utf8'), '# Market\n');
  assert.equal(fs.existsSync(path.join(out, 'known-scenes', 'scene_market', 'triggers.yaml')), false);
  fs.rmSync(root, { recursive: true, force: true });
});
