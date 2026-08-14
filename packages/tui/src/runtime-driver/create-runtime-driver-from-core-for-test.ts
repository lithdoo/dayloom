import path from 'node:path';
import type { DayloomCore } from '@dayloom/core2';
import type { DiagnosticLogger } from '@bindtty/terminal';
import { createDriverFromCore } from './driver.js';

export function createRuntimeDriverFromCoreForTest(options: {
  worldRoot: string;
  core: DayloomCore;
  diagnostic?: DiagnosticLogger;
}) {
  return createDriverFromCore({ ...options, worldRoot: path.resolve(options.worldRoot) });
}
