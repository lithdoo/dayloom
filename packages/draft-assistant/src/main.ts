#!/usr/bin/env node

import { exitCodeForAssistantV1, normalizeAssistantErrorV1 } from './errors.js';
import { executeDraftAssistantV1 } from './run.js';

try {
  const result = await executeDraftAssistantV1(process.argv.slice(2));
  process.exitCode = result.exitCode;
} catch (error) {
  const normalized = normalizeAssistantErrorV1(error);
  process.stderr.write(`${normalized.code}: ${normalized.message}\n`);
  process.exitCode = exitCodeForAssistantV1(normalized.code);
}
