import { isPayloadComplete } from './checklist';
import { parseInitPayload } from './parse-assistant';
import { assertPromptpileOk, runPromptpile } from './promptpile-run';
import {
  appendUserMessage,
  createFinalizeSession,
  getLatestAssistantText,
} from './session';
import { cleanupSession } from './cleanup';
import type { InitPayload } from './types';
import { FINALIZE_USER_PROMPT } from './constants';
import { withLoading } from '../utils/loading';

export async function finalizeWorld(transcript: string): Promise<InitPayload> {
  const session = createFinalizeSession(transcript);
  appendUserMessage(session.messagesDir, FINALIZE_USER_PROMPT);

  try {
    const result = await withLoading('正在生成世界文件...', () => runPromptpile(session, [
      '--config',
      'promptpile.toml',
      '-d',
      'messages',
      '--continue',
      '--disable-tool',
    ]));

    assertPromptpileOk(result, 'Finalize');

    const assistantText =
      result.stdout.trim() || getLatestAssistantText(session.messagesDir);

    const payload = parseInitPayload<InitPayload>(assistantText);
    const missing = isPayloadComplete(payload);
    if (missing.length > 0) {
      throw new Error(
        `Init payload incomplete: ${missing.join(', ')}. Re-run init or edit prompts.`
      );
    }

    return payload;
  } finally {
    cleanupSession(session);
  }
}
