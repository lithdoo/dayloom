const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { applyPayload } = require('../../dist/init/apply-payload.js');
const { projectPayload } = require('../../dist/init/project-payload.js');

function payload() {
  return {
    manifest: { id: 'test_world', title: 'Test' },
    canon: {
      'premise.md': 'p',
      'rules.md': 'r',
      'style.md': 's',
      'user_role.md': 'u',
    },
    state: { 'world.yaml': 'title: Test\n' },
    characters: [
      {
        id: 'char_a',
        profileMd: '# A\n\nA character.\n',
      },
      {
        id: 'char_b',
        profileMd: '# B\n\nAnother character.\n',
        relationshipsMd: '# Relationships\n\n## char_a\nTrusted ally.\n',
        meta: { status: 'inactive', tags: ['friend', 'smith'] },
      },
    ],
    scenes: [
      {
        id: 'scene_square',
        profileMd: '# Square\n\nA public square.\n',
      },
    ],
  };
}

function fileMap(files) {
  return new Map(files.map(file => [file.relativePath, file.content]));
}

test('projectPayload stores entity context as markdown with generated metadata', () => {
  const files = fileMap(projectPayload(payload()));

  assert.equal(files.get('characters/char_a/profile.md'), '# A\n\nA character.\n');
  assert.equal(files.get('characters/char_a/relationships.md'), '# Relationships\n\n');
  assert.match(files.get('characters/char_a/meta.yaml'), /type: character/);
  assert.match(files.get('characters/char_a/meta.yaml'), /status: \"active\"/);
  assert.match(files.get('characters/char_a/meta.yaml'), /tags: \[\]/);

  assert.equal(files.get('characters/char_b/relationships.md'), '# Relationships\n\n## char_a\nTrusted ally.\n');
  assert.match(files.get('characters/char_b/meta.yaml'), /status: \"inactive\"/);
  assert.match(files.get('characters/char_b/meta.yaml'), /  - \"smith\"/);

  assert.equal(files.get('scenes/scene_square/profile.md'), '# Square\n\nA public square.\n');
  assert.match(files.get('scenes/scene_square/meta.yaml'), /type: scene/);
  assert.equal(files.get('scenes/scene_square/triggers.yaml'), 'triggers: []\n');

  assert.equal(files.has('characters/char_a/profile.yaml'), false);
  assert.equal(files.has('characters/char_a/relationships.yaml'), false);
  assert.equal(files.has('scenes/scene_square/profile.yaml'), false);
});


test('applyPayload writes projected markdown entity files to disk', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'day-loom-payload-'));
  applyPayload(dir, payload());

  assert.equal(fs.readFileSync(path.join(dir, 'characters/char_a/profile.md'), 'utf8'), '# A\n\nA character.\n');
  assert.equal(fs.existsSync(path.join(dir, 'characters/char_a/meta.yaml')), true);
  assert.equal(fs.existsSync(path.join(dir, 'characters/char_a/profile.yaml')), false);
  assert.equal(fs.existsSync(path.join(dir, 'scenes/scene_square/profile.md')), true);

  fs.rmSync(dir, { recursive: true, force: true });
});
