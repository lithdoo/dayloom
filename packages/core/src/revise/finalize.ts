import fs from 'fs';
import { parseRevisePayload } from './parse-assistant';
import { runPromptpileUntilText } from './promptpile-loop';
import { createFinalizeSession, cleanupSession } from './session';
import type { ReviseDraft, RevisePayload } from './types';

export async function finalizeRevision(transcript: string, draft: ReviseDraft, toolsFile: string, baseUrl: string, token: string | undefined, maxToolRounds: number, keepSession = false): Promise<RevisePayload> {
  const session = createFinalizeSession(transcript, draft);
  fs.copyFileSync(toolsFile, session.toolsFile);
  try {
    return parseRevisePayload(await runPromptpileUntilText(session, baseUrl, token, maxToolRounds));
  } finally {
    if (keepSession) process.stderr.write(`Finalize session preserved at: ${session.root}\n`);
    else cleanupSession(session);
  }
}
