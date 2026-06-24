const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { reviseWorldFromProposal } = require('../../dist/revise/index.js');
const { projectRevisePayload } = require('../../dist/revise/project-payload.js');
const { validateRevisePayload } = require('../../dist/revise/validate-payload.js');

function createWorld() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'day-loom-revise-'));
  fs.mkdirSync(path.join(root, 'canon'), { recursive: true });
  fs.mkdirSync(path.join(root, 'logs'), { recursive: true });
  fs.writeFileSync(path.join(root, 'manifest.yaml'), 'id: test_world\n', 'utf8');
  fs.writeFileSync(path.join(root, 'canon', 'style.md'), '# Old style\n', 'utf8');
  fs.writeFileSync(path.join(root, 'logs', 'state_changes.jsonl'), '', 'utf8');
  return root;
}

function writeProposal(root, payload) {
  const filePath = path.join(root, 'proposal.json');
  fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  return filePath;
}

function stylePayload(content = '# New style\n') {
  return {
    summary: 'Update narrative style',
    operations: [{ op: 'replace_canon', section: 'style', content }],
  };
}

test('validateRevisePayload rejects unsupported operations', () => {
  assert.throws(
    () => validateRevisePayload({ summary: 'x', operations: [{ op: 'write_file' }] }),
    /Unsupported revise operation/
  );
});

test('projectRevisePayload maps canon sections to controlled paths', () => {
  assert.deepEqual(projectRevisePayload(stylePayload()), [
    { relativePath: 'canon/style.md', content: '# New style\n' },
  ]);
});

test('reviseWorldFromProposal dry run does not write files or logs', () => {
  const root = createWorld();
  const proposal = writeProposal(root, stylePayload());

  const result = reviseWorldFromProposal(root, proposal, { dryRun: true });

  assert.equal(result.description, 'update canon/style.md');
  assert.equal(result.revisionId, undefined);
  assert.equal(fs.readFileSync(path.join(root, 'canon', 'style.md'), 'utf8'), '# Old style\n');
  assert.equal(fs.readFileSync(path.join(root, 'logs', 'state_changes.jsonl'), 'utf8'), '');
  assert.equal(fs.existsSync(path.join(root, '.loom')), false);
  fs.rmSync(root, { recursive: true, force: true });
});

test('reviseWorldFromProposal requires --yes before applying changes', () => {
  const root = createWorld();
  const proposal = writeProposal(root, stylePayload());

  assert.throws(
    () => reviseWorldFromProposal(root, proposal),
    /requires --yes/
  );
  assert.equal(fs.readFileSync(path.join(root, 'canon', 'style.md'), 'utf8'), '# Old style\n');
  fs.rmSync(root, { recursive: true, force: true });
});

test('reviseWorldFromProposal backs up, applies, and logs a revision', () => {
  const root = createWorld();
  const proposal = writeProposal(root, stylePayload());

  const result = reviseWorldFromProposal(root, proposal, { yes: true });

  assert.match(result.revisionId, /^revision_\d{8}T\d{6}Z$/);
  assert.equal(fs.readFileSync(path.join(root, 'canon', 'style.md'), 'utf8'), '# New style\n');

  const revisionRoot = path.join(root, '.loom', 'revisions', result.revisionId);
  assert.equal(
    fs.readFileSync(path.join(revisionRoot, 'before', 'canon', 'style.md'), 'utf8'),
    '# Old style\n'
  );
  assert.equal(
    fs.readFileSync(path.join(revisionRoot, 'changes.txt'), 'utf8'),
    'update canon/style.md\n'
  );

  const entries = fs
    .readFileSync(path.join(root, 'logs', 'state_changes.jsonl'), 'utf8')
    .trim()
    .split('\n')
    .map(line => JSON.parse(line));
  assert.deepEqual(entries, [
    {
      type: 'world_revision',
      revision: result.revisionId,
      summary: 'Update narrative style',
      changed_files: ['canon/style.md'],
    },
  ]);
  fs.rmSync(root, { recursive: true, force: true });
});
