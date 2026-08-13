const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const TOML = require('@iarna/toml');
const { readCallerConfig, writeDerivedConfigs } = require('../dist/promptpile/config');
const { runReact } = require('../dist/promptpile/react-runner');
const { resolvePackagedBoundaries } = require('../dist/promptpile/binaries');
const { eventStream } = require('./helpers');

test('derived config preserves profiles and owns max-step and prompt paths', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'core2-config-')); t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const caller = path.join(root, 'caller.toml'); fs.writeFileSync(caller, '[[llm_api]]\nname="profile"\nmodel="m"\n[promptpile]\nllm_api="profile"\nllm_api_temperature=0.3\n');
  const config = await readCallerConfig(caller);
  const paths = { thought: path.join(root, 'thought.md'), sendFinal: path.join(root, 'send.md'), submitFinal: path.join(root, 'submit.md'), sendConfig: path.join(root, 'send.toml'), submitConfig: path.join(root, 'submit.toml') };
  await writeDerivedConfigs(config, paths);
  const send = TOML.parse(fs.readFileSync(paths.sendConfig, 'utf8')), submit = TOML.parse(fs.readFileSync(paths.submitConfig, 'utf8'));
  assert.equal(send.llm_api[0].name, 'profile'); assert.equal(send.promptpile.llm_api_temperature, 0.3);
  assert.deepEqual(send['promptpile-react'], { max_step: 1, thought_prompt: paths.thought, final_prompt: paths.sendFinal });
  assert.equal(submit['promptpile-react'].final_prompt, paths.submitFinal);
});
test('React runner rejects malformed, schema-invalid, gaps, session changes and Final mismatch', async () => {
  const boundaries = await resolvePackagedBoundaries();
  const base = { runner: null, reactBin: 'react', validate: boundaries.validateAgentEvent, config: 'c', context: 'x', conversation: 'y' };
  for (const stdout of [
    '{bad\n',
    JSON.stringify({ schema_version: 1, type: 'bad', session_id: 'x', sequence: 0 }) + '\n',
    eventStream('ok').replace('"sequence":1', '"sequence":2'),
    eventStream('ok').replace('"session_id":"react-session","sequence":1', '"session_id":"changed","sequence":1'),
    eventStream('ok').replace('"content":"ok"}}', '"content":"different"}}'),
  ]) {
    const runner = { run: async () => ({ code: 0, stdout, stderr: '' }) };
    await assert.rejects(() => runReact({ ...base, runner }));
  }
});
test('architecture guard rejects legacy and deep imports', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'core2-guard-'));
  try {
    fs.writeFileSync(path.join(root, 'bad.ts'), "import '@dayloom/core';\nimport 'promptpile-react/dist/runtime';\n");
    const result = spawnSync(process.execPath, [path.join(__dirname, '..', 'scripts', 'check-architecture.mjs')], { env: { ...process.env, CORE2_ARCHITECTURE_ROOT: root }, encoding: 'utf8' });
    assert.notEqual(result.status, 0); assert.match(result.stderr, /forbidden import @dayloom\/core/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
