import { mkdir } from 'node:fs/promises';
import { draftErrorV1 } from './errors.js';
import { runNodeCliV1 } from './process.js';

export async function appendConversationUserV1(input: {
  promptpileBin: string;
  directory: string;
  message: string;
}): Promise<void> {
  try {
    await mkdir(input.directory, { recursive: true });
  } catch {
    throw draftErrorV1('CONVERSATION_FAILED', `Conversation directory could not be created: ${input.directory}.`);
  }

  let result;
  try {
    result = await runNodeCliV1(
      input.promptpileBin,
      ['conversation', 'append-user', '-d', input.directory, '--quiet'],
      { stdin: input.message, timeoutMs: 30_000 },
    );
  } catch (error) {
    throw draftErrorV1(
      'CONVERSATION_FAILED',
      error instanceof Error ? error.message : 'Promptpile append-user failed.',
    );
  }
  if (result.code !== 0) {
    throw draftErrorV1('CONVERSATION_FAILED', result.stderr.trim() || 'Promptpile append-user failed.');
  }
}
