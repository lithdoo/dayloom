#!/usr/bin/env node

import { mkdtemp, readdir, readFile, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import * as TOML from '@iarna/toml';

const argv = process.argv.slice(2);
const configPath = flag('--config');
const outputDir = flag('--output-dir');
const outputFormat = flag('--output-format') ?? 'terminal';
if (!configPath || !outputDir) {
  process.stderr.write('fake-react requires --config and --output-dir\n');
  process.exit(2);
}

const scenario = JSON.parse(process.env.DAYLOOM_DRAFT_FAKE ?? '{}');
if (typeof scenario.stamp === 'string') await writeFile(scenario.stamp, 'started\n', 'utf8');

const config = TOML.parse(await readFile(configPath, 'utf8'));
const afterHook = config['promptpile-react']?.after_hook;
if (typeof afterHook !== 'string' || afterHook.trim() === '') {
  process.stderr.write('fake-react missing after_hook\n');
  process.exit(1);
}

const rounds = scenario.rounds ?? (scenario.calls ? [scenario.calls] : []);
const evidence = [];
const artifactRoot = await mkdtemp(path.join(os.tmpdir(), 'dayloom-draft-fake-'));

for (let index = 0; index < rounds.length; index += 1) {
  const calls = rounds[index];
  const callsPath = path.join(artifactRoot, `[${index + 1}]assistant.calls.jsonl`);
  await writeFile(callsPath, `${calls.map((call) => JSON.stringify({
    id: call.id ?? `call-${index + 1}`,
    type: 'function',
    function: {
      name: call.name,
      arguments: JSON.stringify(call.arguments ?? {}),
    },
  })).join('\n')}\n`, 'utf8');

  const hook = spawnSync(afterHook, {
    encoding: 'utf8',
    env: {
      ...process.env,
      PROMPTPILE_HAS_TOOL_CALLS: '1',
      PROMPTPILE_ASSISTANT_CALL_FILE: callsPath,
      PROMPTPILE_OUTPUT_DIRECTORY: artifactRoot,
    },
    timeout: 25_000,
    windowsHide: true,
    shell: process.platform === 'win32',
  });
  if (hook.status !== 0) {
    process.stderr.write(hook.stderr || `fake-react hook exited ${hook.status}\n`);
    process.exit(hook.status ?? 1);
  }
  const resultPath = path.join(artifactRoot, `[${index + 1}]assistant.result.jsonl`);
  const raw = await readFile(resultPath, 'utf8');
  evidence.push(raw.split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line)));
}

if (typeof scenario.evidence === 'string') {
  await writeFile(scenario.evidence, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');
}

const names = await readdir(outputDir);
const maxIndex = names.reduce((maximum, name) => {
  const match = /^\[(\d+)\]/.exec(name);
  return match ? Math.max(maximum, Number(match[1])) : maximum;
}, 0);
await writeFile(path.join(outputDir, `[${maxIndex + 1}]assistant.md`), `${scenario.final ?? 'Draft updated.'}\n`, 'utf8');

const finalText = scenario.final ?? 'Draft updated.';
if (outputFormat === 'stream-json') {
  const session = 'fake-session';
  const events = [
    { schema_version: 1, type: 'session.started', session_id: session, sequence: 0, max_steps: 1 },
    { schema_version: 1, type: 'phase.started', session_id: session, sequence: 1, phase: 'thought', step_index: 0 },
    { schema_version: 1, type: 'phase.completed', session_id: session, sequence: 2, phase: 'thought', step_index: 0 },
    { schema_version: 1, type: 'phase.started', session_id: session, sequence: 3, phase: 'observe', step_index: 0 },
    { schema_version: 1, type: 'phase.completed', session_id: session, sequence: 4, phase: 'observe', step_index: 0 },
    { schema_version: 1, type: 'phase.started', session_id: session, sequence: 5, phase: 'check', step_index: 0 },
    { schema_version: 1, type: 'phase.completed', session_id: session, sequence: 6, phase: 'check', step_index: 0, continue: false },
    { schema_version: 1, type: 'phase.started', session_id: session, sequence: 7, phase: 'final', steps_completed: 1 },
    { schema_version: 1, type: 'final.delta', session_id: session, sequence: 8, content: finalText },
    { schema_version: 1, type: 'phase.completed', session_id: session, sequence: 9, phase: 'final', steps_completed: 1 },
    { schema_version: 1, type: 'session.completed', session_id: session, sequence: 10, stop_reason: 'final', steps_completed: 1, final: { status: 'completed', content: finalText } },
  ];
  process.stdout.write(`${events.map((event) => JSON.stringify(event)).join('\n')}\n`);
} else {
  process.stdout.write(`${finalText}\n`);
}

process.exit(scenario.exitCode ?? 0);

function flag(name) {
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] : undefined;
}
