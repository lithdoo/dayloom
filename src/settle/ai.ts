import fs from 'fs';
import path from 'path';
import { runPromptpileUntilText } from '../daily/promptpile-loop';
import { cleanupSettlementSession, createSettlementSession } from './session';

export async function callSettlementAi(
  userContent: string,
  toolsFile: string,
  baseUrl: string,
  token: string | undefined,
  maxToolRounds: number,
  keepSession = false,
): Promise<string> {
  const prompt = fs.readFileSync(path.resolve(__dirname, '..', '..', 'prompts', 'settle.system.md'), 'utf8');
  const session = createSettlementSession(prompt, userContent, toolsFile);
  try {
    return await runPromptpileUntilText(session, baseUrl, token, maxToolRounds);
  } finally {
    if (keepSession) process.stderr.write(`Settlement AI session preserved at: ${session.root}\n`);
    else cleanupSettlementSession(session);
  }
}
