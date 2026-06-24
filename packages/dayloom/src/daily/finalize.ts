import fs from 'fs';
import { parseDailyPlan } from './parse-assistant';
import { runPromptpileUntilText } from './promptpile-loop';
import { cleanupSession, createFinalizeSession } from './session';
import type { DailyDraft, DailyPlan } from './types';

export async function finalizeDailyPlan(transcript: string, draft: DailyDraft, day: string, toolsFile: string, baseUrl: string, token: string | undefined, maxToolRounds: number, keepSession = false): Promise<DailyPlan> {
  const session = createFinalizeSession(transcript, draft, day);
  fs.copyFileSync(toolsFile, session.toolsFile);
  try { return parseDailyPlan(await runPromptpileUntilText(session, baseUrl, token, maxToolRounds)); }
  finally {
    if (keepSession) process.stderr.write(`Daily finalize session preserved at: ${session.root}\n`);
    else cleanupSession(session);
  }
}
