const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const protocol = require('@dayloom/archive-protocol');

function write(root, relative, bytes) {
  const target = path.join(root, ...relative.split('/'));
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, bytes);
}
function archiveFixture({ phase = 'planned', day = 'day1', malformedPlan = false, profileVersion = 1 } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'core-world-'));
  const documents = new Map([
    ['canon/premise.md', Buffer.from('Premise')], ['canon/rules.md', Buffer.from('Rules')],
    ['canon/style.md', Buffer.from('Style')], ['canon/user-role.md', Buffer.from('User role')],
    [`days/${day}/plan.json`, Buffer.from(JSON.stringify(malformedPlan ? { intent: '' } : { version: 1, intent: 'Live the day', knownContext: [], constraints: [], openQuestions: [], maxEvents: 1, beats: [{ id: 'beat1', intent: 'Begin', priority: 'required', dependsOn: [] }] }))],
  ]);
  documents.set('profile/dayloom.json', Buffer.from(JSON.stringify({ schemaVersion: 1, profile: 'dayloom', profileVersion })));
  if (profileVersion === 1) for (const [documentPath, content] of [
      ['state/world.yaml', 'schemaVersion: 1\ntitle: World\nstatus: active\n'],
      ['state/calendar.yaml', 'schemaVersion: 1\ncurrentDay: null\nelapsed: null\n'],
      ['state/progress.yaml', 'schemaVersion: 1\nactiveArcIds: []\n'],
      ['state/variables.yaml', 'schemaVersion: 1\nvariables: {}\n'],
      ['characters/index.yaml', 'schemaVersion: 1\nids: []\n'],
      ['locations/index.yaml', 'schemaVersion: 1\nids: []\n'],
      ['arcs/index.yaml', 'schemaVersion: 1\nids: []\n'],
      ['memory/short-term.md', ''], ['memory/long-term.md', ''],
      ['memory/facts.yaml', 'schemaVersion: 1\nfacts: []\n'],
      ['memory/unresolved-threads.yaml', 'schemaVersion: 1\nthreads: []\n'],
      ['memory/important-events.yaml', 'schemaVersion: 1\nevents: []\n'],
      ['story-seeds/active.yaml', 'schemaVersion: 1\nseeds: []\n'],
  ]) documents.set(documentPath, Buffer.from(content));
  const entries = [...documents].map(([documentPath, bytes]) => {
    const blobHash = protocol.hashBlobV1(bytes); write(root, protocol.formatBlobObjectPathV1(blobHash), bytes);
    const mediaType = documentPath.endsWith('.json') ? 'application/json' : documentPath.endsWith('.yaml') ? 'application/yaml' : 'text/markdown';
    return { path: documentPath, blobHash, mediaType, bytes: bytes.length };
  });
  const tree = protocol.createRootTreeV1(entries), rootTreeHash = protocol.hashRootTreeV1(tree);
  write(root, protocol.formatTreeObjectPathV1(rootTreeHash), protocol.encodeRootTreeCanonicalV1(tree));
  const now = '2026-08-13T00:00:00.000Z';
  const commit = protocol.parseArchiveCommitV2({ schemaVersion: 2, id: 'commit_base', revision: 1, parentCommitId: null, operationId: 'op_init', createdAt: now, rootTreeHash, control: { phase, day: phase === 'idle' ? null : day, lastSettledDay: null } });
  write(root, protocol.formatCommitObjectPathV2(commit.id), JSON.stringify(commit));
  write(root, 'manifest.json', JSON.stringify({ schemaVersion: 2, worldId: 'world1', title: 'World', createdAt: now }));
  write(root, 'current.json', JSON.stringify({ schemaVersion: 2, revision: 1, commitId: commit.id, updatedAt: now }));
  const config = path.join(root, 'llm.toml'); fs.writeFileSync(config, '[[llm_api]]\nname = "test"\nmodel = "test"\n');
  return { root, config, cleanup: () => fs.rmSync(root, { recursive: true, force: true }) };
}
function eventStream(content, options = {}) {
  const process_id = `react_${'1'.repeat(32)}`, work_id = `work_${'2'.repeat(32)}`, work_path = 'C:/tmp/react/work';
  const continueDecision = options.continueDecision ?? false;
  const stopReason = options.stopReason ?? (continueDecision ? 'max_step' : 'final');
  return [
    { schema_version: 1, process_id, sequence: 0, type: 'process.started', max_steps: 1, work_id, work_path, work_lifecycle: 'cleanup' },
    { schema_version: 1, process_id, sequence: 1, type: 'phase.started', phase: 'thought', step_index: 0 },
    { schema_version: 1, process_id, sequence: 2, type: 'phase.completed', phase: 'thought', step_index: 0 },
    { schema_version: 1, process_id, sequence: 3, type: 'phase.started', phase: 'observe', step_index: 0 },
    { schema_version: 1, process_id, sequence: 4, type: 'phase.completed', phase: 'observe', step_index: 0 },
    { schema_version: 1, process_id, sequence: 5, type: 'phase.started', phase: 'check', step_index: 0 },
    { schema_version: 1, process_id, sequence: 6, type: 'phase.completed', phase: 'check', step_index: 0, continue: continueDecision },
    { schema_version: 1, process_id, sequence: 7, type: 'work.ready', work_id, work_path, status: 'checked' },
    { schema_version: 1, process_id, sequence: 8, type: 'phase.started', phase: 'final' },
    { schema_version: 1, process_id, sequence: 9, type: 'phase.delta', phase: 'final', channel: 'assistant_text', content },
    { schema_version: 1, process_id, sequence: 10, type: 'phase.completed', phase: 'final' },
    { schema_version: 1, process_id, sequence: 11, type: 'process.completed', stop_reason: stopReason, steps_completed: 1, final: { status: 'completed', content } },
  ].map(JSON.stringify).join('\n') + '\n';
}
class FakeRunner {
  constructor(finals = []) { this.finals = [...finals]; this.calls = []; }
  async run(bin, args, options = {}) {
    this.calls.push({ bin, args: [...args], stdin: options.stdin });
    if (args[0] === 'conversation') return { code: 0, stdout: '', stderr: '' };
    const stream = eventStream(this.finals.shift() ?? ''); options.onExtraPipe?.(stream);
    return { code: 0, stdout: '', stderr: '' };
  }
}
module.exports = { archiveFixture, FakeRunner, eventStream };
