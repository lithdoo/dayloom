import path from 'path';
import { archiveTranscript } from './archive-transcript';
import { applyPayload } from './apply-payload';
import { cleanupSession } from './cleanup';
import { DEFAULT_MAX_INTERVIEW_ROUNDS } from './constants';
import { InitCancelledError } from './errors';
import { finalizeWorld } from './finalize';
import {
  assertApiKey,
  assertNotInitialized,
  ensureWorldRootParent,
  resolveWorldRoot,
} from './guard';
import { runInterviewLoop } from './interview-loop';
import { scaffoldEmptyWorld } from './scaffold';
import type { InitOptions, InitSession } from './types';
import type { InitResult, SessionExit, SessionIO } from '../session-io';

export type InitInteractiveOptions = InitOptions & { io: SessionIO };

export function initWorldQuick(dir: string, options: InitOptions = {}): string {
  const worldRoot = resolveWorldRoot(dir);
  assertNotInitialized(worldRoot);
  ensureWorldRootParent(worldRoot);

  const id = options.id ?? path.basename(worldRoot);
  const title = options.title ?? id;

  scaffoldEmptyWorld(worldRoot, { id, title });
  return worldRoot;
}

export async function runInitInteractive(
  dir: string,
  options: InitInteractiveOptions,
): Promise<SessionExit<InitResult>> {
  const { io, ...initOptions } = options;
  assertApiKey();

  const worldRoot = resolveWorldRoot(dir);
  assertNotInitialized(worldRoot);
  ensureWorldRootParent(worldRoot);

  const maxRounds = initOptions.maxRounds ?? DEFAULT_MAX_INTERVIEW_ROUNDS;
  let interviewSession: InitSession | undefined;

  try {
    const interview = await runInterviewLoop(io, maxRounds);
    if ('kind' in interview) return interview as SessionExit<InitResult>;

    interviewSession = interview.session;

    const payload = await finalizeWorld(interview.transcript, io);

    const id = initOptions.id ?? payload.manifest.id ?? path.basename(worldRoot);
    const title = initOptions.title ?? payload.manifest.title ?? id;
    payload.manifest.id = id;
    payload.manifest.title = title;

    assertNotInitialized(worldRoot);
    scaffoldEmptyWorld(worldRoot, { id, title });
    applyPayload(worldRoot, payload);
    archiveTranscript(interview.session, worldRoot);
    cleanupSession(interview.session);

    return { kind: 'completed', result: { worldRoot } };
  } catch (err) {
    const cancelledSession =
      err instanceof InitCancelledError ? err.session : interviewSession;

    if (cancelledSession && initOptions.keepSessionOnError) {
      io.warn(`Init session preserved at: ${cancelledSession.root}\n`);
    } else if (cancelledSession) {
      cleanupSession(cancelledSession);
    }

    if (err instanceof InitCancelledError) {
      return { kind: 'cancelled' };
    }
    throw err;
  }
}

/** @deprecated Use runInitInteractive */
export const initWorldInteractive = runInitInteractive;

export { InitCancelledError } from './errors';
