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
import type { SessionIO } from '../session-io';

export async function finalizeWorld(transcript: string, io: SessionIO): Promise<InitPayload> {
  const session = createFinalizeSession(transcript);
  appendUserMessage(session.messagesDir, FINALIZE_USER_PROMPT);

  try {
    const result = await io.withLoading('正在生成世界文件...', () => runPromptpile(session, [
      '--config',
      'promptpile.toml',
      '-d',
      'messages',
      '--continue',
      '--disable-tool',
    ]));

    assertPromptpileOk(result, 'Finalize');

    const assistantText =
      getLatestAssistantText(session.messagesDir);
    const payload = parseInitPayload<InitPayload>(assistantText);
    if (!isPayloadComplete(payload)) {
      throw new Error('Finalize payload is incomplete.');
    }
    return payload;
  } finally {
    cleanupSession(session);
  }
}
