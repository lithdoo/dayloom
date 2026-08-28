#!/usr/bin/env node

import { executeCliV1 } from './cli/run.js';
import { exitCodeForV1, normalizeCliErrorV1 } from './cli/errors.js';
import { errorEnvelopeV1, renderHumanSuccessV1, successEnvelopeV1 } from './cli/output.js';
import { promptpileWorkspaceEditorV1 } from './ai/promptpile-editor.js';

const argv = process.argv.slice(2);
const jsonRequested = argv.includes('--json');
const rawCommand = argv[0] ?? 'unknown';

try {
  const executed = await executeCliV1(argv, { draftEditor: promptpileWorkspaceEditorV1 });
  if (executed.invocation.json) {
    process.stdout.write(`${JSON.stringify(successEnvelopeV1(executed.invocation.command, executed.result))}\n`);
  } else {
    process.stdout.write(`${renderHumanSuccessV1(executed.invocation.command, executed.result)}\n`);
  }
} catch (error) {
  const normalized = normalizeCliErrorV1(error);
  if (jsonRequested) {
    process.stdout.write(`${JSON.stringify(errorEnvelopeV1(rawCommand, normalized))}\n`);
  } else {
    process.stderr.write(`${normalized.code}: ${normalized.message}\n`);
  }
  process.exitCode = exitCodeForV1(normalized.code);
}
