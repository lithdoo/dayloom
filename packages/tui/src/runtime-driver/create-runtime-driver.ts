import path from 'node:path';
import { createDayloomCore } from '@dayloom/core2';
import type { DiagnosticLogger } from '@bindtty/terminal';
import type { WorkVisibility } from '../types.js';
import { createDriverFromCore } from './driver.js';

export interface CreateRuntimeDriverOptions {
  worldRoot: string;
  llmConfigPath: string;
  diagnostic?: DiagnosticLogger;
  workVisibility?: WorkVisibility;
}

export async function createRuntimeDriver(options: CreateRuntimeDriverOptions) {
  const worldRoot = path.resolve(options.worldRoot);
  const core = await createDayloomCore({
    worldRoot,
    llmConfigPath: path.resolve(options.llmConfigPath),
  });
  return createDriverFromCore({ worldRoot, core, diagnostic: options.diagnostic, workVisibility: options.workVisibility });
}
