import path from 'node:path';
import type { DayloomCore } from '@dayloom/core';
import type { DiagnosticLogger } from '@bindtty/terminal';
import type { WorkVisibility } from '../types.js';
import { createDriverFromCore } from './driver.js';

export function createRuntimeDriverFromCoreForTest(options: {
  worldRoot: string;
  core: DayloomCore;
  diagnostic?: DiagnosticLogger;
  workVisibility?: WorkVisibility;
}) {
  return createDriverFromCore({ ...options, worldRoot: path.resolve(options.worldRoot) });
}
