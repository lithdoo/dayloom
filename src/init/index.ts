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

export function initWorldQuick(dir: string, options: InitOptions = {}): string {
  const worldRoot = resolveWorldRoot(dir);
  assertNotInitialized(worldRoot);
  ensureWorldRootParent(worldRoot);

  const id = options.id ?? path.basename(worldRoot);
  const title = options.title ?? id;

  scaffoldEmptyWorld(worldRoot, { id, title });
  return worldRoot;
}

export async function initWorldInteractive(
  dir: string,
  options: InitOptions = {}
): Promise<string> {
  assertApiKey();

  const worldRoot = resolveWorldRoot(dir);
  assertNotInitialized(worldRoot);
  ensureWorldRootParent(worldRoot);

  const maxRounds = options.maxRounds ?? DEFAULT_MAX_INTERVIEW_ROUNDS;
  let interviewSession: InitSession | undefined;

  try {
    const interview = await runInterviewLoop(maxRounds);
    interviewSession = interview.session;

    const payload = await finalizeWorld(interview.transcript);

    const id = options.id ?? payload.manifest.id ?? path.basename(worldRoot);
    const title = options.title ?? payload.manifest.title ?? id;
    payload.manifest.id = id;
    payload.manifest.title = title;

    assertNotInitialized(worldRoot);
    scaffoldEmptyWorld(worldRoot, { id, title });
    applyPayload(worldRoot, payload);
    archiveTranscript(interview.session, worldRoot);
    cleanupSession(interview.session);

    return worldRoot;
  } catch (err) {
    const cancelledSession =
      err instanceof InitCancelledError ? err.session : interviewSession;

    if (cancelledSession && options.keepSessionOnError) {
      process.stderr.write(
        `Init session preserved at: ${cancelledSession.root}\n`
      );
    } else if (cancelledSession) {
      cleanupSession(cancelledSession);
    }
    throw err;
  }
}
