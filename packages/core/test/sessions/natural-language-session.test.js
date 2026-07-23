const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  createFakeSessionFactory,
  createNaturalLanguageSessionFactory,
  createPromptpileConversationClient,
  createArchiveRepository,
  createArchiveSessionWorldReadModel,
  createDayloomRuntime,
} = require('../../dist/index.js');
const {
  chunks,
  waitFor,
} = require('../helpers/baseline.js');

test('natural-language Sessions consume the Archive read model through a complete flow', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dayloom-core-natural-archive-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const archive = createArchiveRepository({ worldRoot: root });
  const client = {
    streamReply(request) {
      if (request.purpose === 'dialogue') return chunks(['ack']);
      const payloads = {
        init: { id: 'archive-world', title: 'Archive World', premise: 'P', rules: 'R', style: 'S', userRole: 'U' },
        planning: { day: 'day_0001', intent: 'Investigate', beats: [{ id: 'beat_001', intent: 'Observe' }] },
        play: { summary: 'Observed the scene' },
        revise: { summary: 'Refine style', documents: [{ path: 'canon/style.md', content: 'Restrained.' }] },
      };
      return chunks([JSON.stringify(payloads[request.kind])]);
    },
  };
  const runtime = await createDayloomRuntime({
    worldRoot: root,
    archiveRepository: archive,
    sessionFactory: createNaturalLanguageSessionFactory({
      readModel: createArchiveSessionWorldReadModel(archive),
      client,
    }),
  });

  await runtime.executeCommand({ command: 'init' });
  await runtime.sendInput({ text: 'start' });
  await waitFor(() => runtime.getSnapshot().session.status === 'waiting-input');
  const initSubmit = await runtime.executeCommand({ command: 'submit' });
  assert.equal(initSubmit.ok, true, initSubmit.error?.message);

  await runtime.executeCommand({ command: 'daily' });
  await runtime.sendInput({ text: 'plan today' });
  await waitFor(() => runtime.getSnapshot().session.status === 'waiting-input');
  const planningSubmit = await runtime.executeCommand({ command: 'submit' });
  assert.equal(planningSubmit.ok, true, planningSubmit.error?.message);

  await runtime.executeCommand({ command: 'play' });
  await runtime.sendInput({ text: 'look around' });
  await waitFor(() => runtime.getSnapshot().session.status === 'waiting-input');
  const playSubmit = await runtime.executeCommand({ command: 'submit' });
  assert.equal(playSubmit.ok, true, playSubmit.error?.message);
  const played = await archive.readCurrent();
  assert.equal(played.status, 'ready');
  const playedDay = await archive.readDayRevision('day_0001', played.commit.dayHeads.day_0001.revision);
  assert.equal(playedDay.plan.beats[0].status, 'completed');
  assert.equal(playedDay.events[0].userInput, 'look around');

  await runtime.executeCommand({ command: 'settle' });
  await runtime.executeCommand({ command: 'revise' });
  assert.equal((await runtime.executeCommand({ command: 'submit' })).ok, true);
  const revised = await archive.readCurrent();
  assert.equal(revised.status, 'ready');
  const canon = await archive.readCanonRevision(revised.commit.canonRevision);
  assert.equal(canon.documents.style, 'Restrained.');
  assert.equal(canon.documents.premise, 'P');
  await runtime.dispose();
});

test('Archive Session read model rejects a stale snapshot revision', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dayloom-core-read-model-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const archive = createArchiveRepository({ worldRoot: root });
  const runtime = await createDayloomRuntime({
    worldRoot: root,
    archiveRepository: archive,
    sessionFactory: createFakeSessionFactory(),
  });
  await runtime.executeCommand({ command: 'init' });
  await runtime.executeCommand({ command: 'submit' });
  const snapshot = runtime.getSnapshot().world;
  await assert.rejects(
    createArchiveSessionWorldReadModel(archive).read({ ...snapshot, revision: snapshot.revision + 1 }),
    (error) => error.code === 'ARCHIVE_CONFLICT',
  );
  await runtime.dispose();
});

test('Promptpile conversation client consumes provider stream events', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dayloom-core-promptpile-bin-'));
  const bin = path.join(root, 'fake-promptpile');
  fs.writeFileSync(
    bin,
    [
      '#!/usr/bin/env node',
      "const fs = require('node:fs');",
      "fs.writeSync(3, JSON.stringify({ type: 'assistant_delta', content: 'hello' }) + '\\n');",
      "fs.writeSync(3, JSON.stringify({ type: 'assistant_delta', content: ' world' }) + '\\n');",
      "fs.writeSync(3, JSON.stringify({ type: 'assistant_done' }) + '\\n');",
    ].join('\n'),
    { mode: 0o755 },
  );
  const client = createPromptpileConversationClient({ promptpileBin: bin });
  const output = [];

  for await (const delta of client.streamReply({
    kind: 'init',
    purpose: 'dialogue',
    systemPrompt: 'test',
    messages: [{ role: 'user', text: 'hello' }],
    signal: new AbortController().signal,
  })) {
    output.push(delta);
  }

  assert.deepEqual(output, ['hello', ' world']);
  fs.rmSync(root, { recursive: true, force: true });
});
