import {
  DEFAULT_MAX_INTERVIEW_ROUNDS,
  FINALIZE_USER_PROMPT,
  OPENING_ASSISTANT,
} from './constants';
import { isInterviewReady, getInterviewMissingFromTranscript } from './checklist';
import { InitCancelledError } from './errors';
import { parseInterviewStatus } from './parse-assistant';
import { assertPromptpileOk, runPromptpile } from './promptpile-run';
import { readUserInput } from './read-user-input';
import {
  appendUserMessage,
  buildTranscript,
  createSession,
  getLatestAssistantText,
  writeOpeningAssistant,
} from './session';
import type { InitSession } from './types';

async function runInterviewRound(session: InitSession, onDelta?: (text: string) => void): Promise<string> {
  let userText: string;
  try {
    userText = await readUserInput();
  } catch (err) {
    if (err instanceof InitCancelledError) {
      throw new InitCancelledError(err.message, session);
    }
    throw err;
  }
  appendUserMessage(session.messagesDir, userText);

  const result = await runPromptpile(session, [
    '--config',
    'promptpile.toml',
    '-d',
    'messages',
    '--continue',
    '--disable-tool',
  ], { onDelta });

  assertPromptpileOk(result, 'Interview round');
  return getLatestAssistantText(session.messagesDir);
}

export async function runInterviewLoop(
  maxRounds: number = DEFAULT_MAX_INTERVIEW_ROUNDS
): Promise<{ session: InitSession; transcript: string }> {
  const session = createSession();
  writeOpeningAssistant(session.messagesDir, OPENING_ASSISTANT);

  process.stdout.write('\n--- World building interview ---\n\n');
  process.stdout.write(stripDisplay(OPENING_ASSISTANT));
  process.stdout.write('\n');

  for (let round = 1; round <= maxRounds; round += 1) {
    session.round = round;
    process.stdout.write('\n--- Assistant ---\n\n');
    const displayStream = createInitDisplayStream();
    const assistantText = await runInterviewRound(session, text => displayStream.push(text));
    displayStream.flush();
    process.stdout.write('\n');

    const status = parseInterviewStatus(assistantText);
    const transcript = buildTranscript(session.messagesDir);

    if (isInterviewReady(status, transcript)) {
      process.stdout.write('\nInterview complete. Finalizing world save...\n');
      return { session, transcript };
    }

    if (status.status === 'ready') {
      const gaps = [
        ...status.missing,
        ...getInterviewMissingFromTranscript(transcript),
      ];
      process.stdout.write(
        `\nNote: model marked ready but checklist incomplete (${[...new Set(gaps)].join(', ')}). Continuing...\n`
      );
    }
  }

  throw new Error(
    `Interview did not complete within ${maxRounds} rounds. Re-run init or increase --max-rounds.`
  );
}

function stripDisplay(text: string): string {
  return text.replace(/```(?:json\s+)?init-status\s*\n[\s\S]*?```/gi, '').trim();
}

function createInitDisplayStream(): { push(text: string): void; flush(): void } {
  let buffer = '';
  let suppressBlock = false;

  const handleLine = (line: string, hasNewline: boolean): void => {
    const trimmed = line.trim();
    if (suppressBlock) {
      if (trimmed.startsWith('```')) {
        suppressBlock = false;
      }
      return;
    }
    if (/^```.*(?:init-status|init-payload)/i.test(trimmed)) {
      suppressBlock = true;
      return;
    }
    process.stdout.write(line);
    if (hasNewline) {
      process.stdout.write('\n');
    }
  };

  return {
    push(text: string): void {
      buffer += text;
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        handleLine(line, true);
      }
    },
    flush(): void {
      if (buffer !== '') {
        const line = buffer;
        buffer = '';
        handleLine(line, false);
      }
    }
  };
}
