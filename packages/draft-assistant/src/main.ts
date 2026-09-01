#!/usr/bin/env node

import { exitCodeForV1, normalizeDraftErrorV1 } from '@dayloom/draft';
import { executeDraftAssistantV1 } from './run.js';

try {
  const result = await executeDraftAssistantV1(process.argv.slice(2));
  process.exitCode = result.exitCode;
} catch (error) {
  const normalized = normalizeDraftErrorV1(error);
  process.stderr.write(`${normalized.code}: ${normalized.message}\n`);
  process.exitCode = exitCodeForV1(normalized.code);
}
