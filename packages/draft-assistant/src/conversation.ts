import { mkdir } from 'node:fs/promises';
import { assistantErrorV1 } from './errors.js';
import { runNodeCliV1 } from './process.js';

export async function appendConversationUserV1(input: { promptpileBin: string; directory: string; message: string }): Promise<void> {
  try { await mkdir(input.directory, { recursive: true }); }
  catch { throw assistantErrorV1('CONVERSATION_FAILED', `Conversation directory could not be created: ${input.directory}.`); }
  try {
    const result = await runNodeCliV1(input.promptpileBin, ['conversation', 'append-user', '-d', input.directory, '--quiet'], { stdin: input.message, timeoutMs: 30_000 });
    if (result.code !== 0) throw new Error(result.stderr.trim() || 'Promptpile append-user failed.');
  } catch (error) {
    throw assistantErrorV1('CONVERSATION_FAILED', error instanceof Error ? error.message : 'Promptpile append-user failed.');
  }
}
