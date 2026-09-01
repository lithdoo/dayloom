import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { executeCliV1 } from '../../cli/dist/index.js';
import { executeDraftAssistantV1 } from '../dist/run.js';
import { capture, tempDir } from './support/helpers.mjs';
import { startAssistantOpenAiStub } from './support/assistant-openai-stub.mjs';
import { makePublishedWorld } from './support/world.mjs';

async function withRealAssistant(options, run) {
  const root = await tempDir();
  const stub = await startAssistantOpenAiStub(options);
  const previous = process.env.DAYLOOM_ASSISTANT_TEST_KEY;
  process.env.DAYLOOM_ASSISTANT_TEST_KEY = 'test-key';
  try {
    const config = path.join(root, 'llm.toml');
    await writeFile(config, `[[llm_api]]\nname = "test"\nmodel = "test"\nbase_url = "${stub.baseUrl}"\napi_key_env = "DAYLOOM_ASSISTANT_TEST_KEY"\n\n[promptpile]\nllm_api = "test"\n`);
    await run({ root, config, stub });
  } finally {
    if (previous === undefined) delete process.env.DAYLOOM_ASSISTANT_TEST_KEY;
    else process.env.DAYLOOM_ASSISTANT_TEST_KEY = previous;
    await stub.close();
    await rm(root, { recursive: true, force: true });
  }
}

test('real play preserves player agency, records accepted scene facts, and feeds CLI dry-run', { timeout: 120_000 }, async () => {
  const reply = 'The innkeeper looks up as the door opens. “Who are you looking for?”';
  const projected = '# Play facts\n- The user opens the door.\n- The innkeeper looks up and asks who they seek.\n';
  await withRealAssistant({ reply, draftPath: 'play.md', draftContent: projected }, async ({ root, config }) => {
    const world = path.join(root, 'world');
    await mkdir(world);
    await makePublishedWorld(world, { phase: 'planned', day: 'day1', lastSettledDay: null });
    const draft = path.join(root, 'play.md');
    const io = capture();
    const result = await executeDraftAssistantV1([
      'play', '--world', world, '--draft', draft, '--conversation', path.join(root, 'conversation'),
      '--llm-config', config, '--message', 'I open the door.',
    ], { cwd: root, stdout: io.stdout, stderr: io.stderr });
    assert.equal(result.exitCode, 0, io.err());
    assert.equal(io.out(), `${reply}\n`);
    assert.equal(await readFile(draft, 'utf8'), projected);
    assert.doesNotMatch(projected, /walks to|draws|decides to/);

    const files = {
      'days/day1/play-index.json': '{"version":1,"eventIds":["event1"]}\n',
      'days/day1/events/index.yaml': 'schemaVersion: 1\nids:\n  - event1\n',
      'days/day1/events/event1/scene.md': '# Scene\nThe door opens.\n',
      'days/day1/events/event1/dialogue.md': '# Dialogue\nWho are you looking for?\n',
      'days/day1/events/event1/user-action.md': 'The user opens the door.\n',
      'days/day1/events/event1/event.yaml': 'schemaVersion: 1\nid: event1\nbeatId: null\ntitle: The Door\nlocationId: null\nparticipantIds: []\nstatus: resolved\n',
      'days/day1/events/event1/result.yaml': 'schemaVersion: 1\nsummary: The innkeeper notices the user.\nlearnedFacts: []\ntimeAdvanced: null\ncompletedBeatIds: []\nskippedBeatIds: []\nendDay: false\n',
      'days/day1/events/event1/state-patch.yaml': 'schemaVersion: 1\nchanges: []\n',
    };
    const cli = await executeCliV1(['play', world, '--draft', draft, '--dry-run'], { draftEditor: { async edit(input) {
      for (const [relative, contents] of Object.entries(files)) {
        const target = path.join(input.workspaceRoot, ...relative.split('/'));
        await mkdir(path.dirname(target), { recursive: true });
        await writeFile(target, contents);
      }
    } } });
    assert.equal(cli.result.mode, 'dry-run');
    assert.equal(cli.result.patch.command, 'play');
  });
});

test('real multi-turn Sync replaces rejected intent instead of retaining it', { timeout: 120_000 }, async () => {
  await withRealAssistant({
    reply: 'Understood.',
    draftContent: ({ syncThoughtCount }) => syncThoughtCount === 1 ? '# Current intent\nColor: red\n' : '# Current intent\nColor: blue\n',
  }, async ({ root, config }) => {
    const draft = path.join(root, 'intent.md');
    const conversation = path.join(root, 'conversation');
    for (const message of ['Use red as the main color.', 'I changed my mind: replace red with blue.']) {
      const result = await executeDraftAssistantV1(['init', '--draft', draft, '--conversation', conversation, '--llm-config', config, '--message', message], { cwd: root, ...capture() });
      assert.equal(result.exitCode, 0);
    }
    const current = await readFile(draft, 'utf8');
    assert.match(current, /blue/);
    assert.doesNotMatch(current, /red/);
  });
});

test('real Sync excludes an unconfirmed Assistant suggestion', { timeout: 120_000 }, async () => {
  await withRealAssistant({
    reply: 'One option would be to add dragons. Which direction do you want?',
    draftContent: '# Current intent\nNo setting element has been confirmed yet.\n',
  }, async ({ root, config }) => {
    const draft = path.join(root, 'intent.md');
    const result = await executeDraftAssistantV1([
      'init', '--draft', draft, '--conversation', path.join(root, 'conversation'),
      '--llm-config', config, '--message', 'Give me an option, but I have not chosen one.',
    ], { cwd: root, ...capture() });
    assert.equal(result.exitCode, 0);
    assert.doesNotMatch(await readFile(draft, 'utf8'), /dragon/i);
  });
});
