import { readCurrent, resolveWorldRoot } from './guard';
import { runPlayLoop } from './event-loop';
import type { PlayInteractiveOptions } from './event-loop';
import type { SessionExit } from '../session-io';

export async function runPlayInteractive(dir: string, options: PlayInteractiveOptions): Promise<SessionExit> {
  const worldRoot = resolveWorldRoot(dir);
  const { day } = readCurrent(worldRoot);
  return runPlayLoop(worldRoot, day, options);
}

/** @deprecated Use runPlayInteractive */
export const playInteractive = runPlayInteractive;

export * from './types';
