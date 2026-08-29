#!/usr/bin/env node

import { executeDraftV1 } from './run.js';
import { exitCodeForV1, normalizeDraftErrorV1 } from './errors.js';

try {
  const result = await executeDraftV1(process.argv.slice(2));
  process.exitCode = result.exitCode;
} catch (error) {
  const normalized = normalizeDraftErrorV1(error);
  process.stderr.write(`${normalized.code}: ${normalized.message}\n`);
  process.exitCode = exitCodeForV1(normalized.code);
}
