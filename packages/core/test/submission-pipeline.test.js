const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const YAML = require('yaml');
const { openDraftV1 } = require('../dist/session/draft-store');
const { runSubmissionPipelineV1, SubmissionPipelineErrorV1 } = require('../dist/session/submission-pipeline');
const { publishMutation } = require('../dist/world/publish');
const { readPublishedWorld } = require('../dist/world/read');

const temporary = (t) => { const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dayloom-pipeline-')); t.after(() => fs.rmSync(root, { recursive: true, force: true })); return root; };
const write = (root, relative, content) => { const target = path.join(root, ...relative.split('/')); fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, content); };
const session = (root) => ({ id: 'session_pipeline', kind: 'init', root: path.join(root, 'session'), contextDir: path.join(root, 'session/context'), conversationDir: path.join(root, 'session/conversation'), sendConfig: '', requestsDir: '', summaryConfigPath: '', summaryPromptPath: '', pinned: null, day: null });

async function confirmedDraft(runtimeRoot) {
  const draft = await openDraftV1({ runtimeRoot, kind: 'init', worldIdentity: 'world-key', baseCommitId: null, baseRootTreeHash: null, targetDay: null });
  const value = YAML.parse(fs.readFileSync(path.join(draft.root, 'draft.yaml'), 'utf8'));
  value.title = { decision: 'confirmed', value: 'Pipeline World' };
  for (const item of Object.values(value.canon)) item.decision = 'confirmed';
  value.worldState.decision = 'confirmed';
  fs.writeFileSync(path.join(draft.root, 'draft.yaml'), YAML.stringify(value));
  return draft;
}

function installValidInit(root) {
  const files = {
    'canon/premise.md': '', 'canon/rules.md': '', 'canon/style.md': '', 'canon/user-role.md': '',
    'state/world.yaml': 'schemaVersion: 1\ntitle: Pipeline World\nstatus: active\n',
    'state/calendar.yaml': 'schemaVersion: 1\ncurrentDay: null\nelapsed: null\n',
    'state/progress.yaml': 'schemaVersion: 1\nactiveArcIds: []\n',
    'state/variables.yaml': 'schemaVersion: 1\nvariables: {}\n',
    'characters/index.yaml': 'schemaVersion: 1\nids: []\n', 'locations/index.yaml': 'schemaVersion: 1\nids: []\n', 'arcs/index.yaml': 'schemaVersion: 1\nids: []\n',
    'memory/short-term.md': '', 'memory/long-term.md': '',
    'memory/facts.yaml': 'schemaVersion: 1\nfacts: []\n', 'memory/unresolved-threads.yaml': 'schemaVersion: 1\nthreads: []\n', 'memory/important-events.yaml': 'schemaVersion: 1\nevents: []\n',
    'story-seeds/active.yaml': 'schemaVersion: 1\nseeds: []\n',
  };
  for (const [relative, content] of Object.entries(files)) write(root, relative, content);
}

test('submission pipeline publishes validated Candidate with complete audit and archives Draft', async (t) => {
  const root = temporary(t), runtime = path.join(root, 'runtime'), world = path.join(root, 'world'), activeSession = session(root); fs.mkdirSync(activeSession.conversationDir, { recursive: true });
  const draft = await confirmedDraft(runtime), stages = [];
  const result = await runSubmissionPipelineV1({ worldRoot: world, transientRoot: activeSession.root, session: activeSession, draft,
    converter: { async run(input) { installValidInit(input.candidateRoot); } },
    reviewer: { async review() { return { raw: { advisory: [] }, advisory: [] }; } },
    stage(stage, attempt) { stages.push(`${stage}:${attempt}`); },
    publish: (input) => publishMutation(world, input),
  });
  assert.equal(result.published.view.title, 'Pipeline World'); assert.equal((await readPublishedWorld(world)).commit.revision, 1);
  assert.deepEqual(stages, ['lint:1', 'allocate:1', 'convert:1', 'validate:1', 'review:1', 'diff:1', 'publish:1']);
  assert.equal(fs.existsSync(draft.root), false); assert.equal(fs.existsSync(path.join(runtime, 'drafts/archive', draft.id, 'draft.yaml')), true);
  const auditPaths = result.published.tree.entries.map((entry) => entry.path).filter((entry) => entry.startsWith('audit/sessions/session_pipeline/'));
  for (const name of ['meta.json', 'transcript.json', 'draft-index.json', 'assignment.json', 'conversion-transcript.json', 'validation.json', 'review.json', 'candidate-diff.json']) assert.ok(auditPaths.includes(`audit/sessions/session_pipeline/${name}`), name);
  assert.equal(fs.existsSync(path.join(activeSession.root, 'candidate')), false);
});

test('repeated Candidate diagnostics stop repair early, preserve World and keep resumable Draft', async (t) => {
  const root = temporary(t), runtime = path.join(root, 'runtime'), world = path.join(root, 'world'), activeSession = session(root); fs.mkdirSync(activeSession.conversationDir, { recursive: true });
  const draft = await confirmedDraft(runtime); let calls = 0;
  await assert.rejects(() => runSubmissionPipelineV1({ worldRoot: world, transientRoot: activeSession.root, session: activeSession, draft,
    converter: { async run() { calls += 1; } }, reviewer: { async review() { throw new Error('must not review invalid Candidate'); } }, stage() {}, publish: (input) => publishMutation(world, input),
  }), (error) => error instanceof SubmissionPipelineErrorV1 && error.code === 'CANDIDATE_INVALID' && error.diagnostics.length > 0);
  assert.equal(calls, 2, 'one conversion plus one repair before identical diagnostics terminate');
  assert.equal(fs.existsSync(path.join(world, 'current.json')), false); assert.equal(draft.meta().status, 'submit-failed'); assert.equal(fs.existsSync(draft.root), true);
  assert.equal(fs.existsSync(path.join(activeSession.root, 'candidate')), false);
});
