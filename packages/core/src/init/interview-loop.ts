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
import { askYesNo } from '../revise/read-user-input';
import { createTranslator } from '../i18n';
import { formatAvailableCommands, formatCommandHelp, formatUnknownCommand, parseSessionCommand, type SessionCommandSpec } from '../session-commands';
import {
  appendUserMessage,
  buildTranscript,
  createSession,
  getLatestAssistantText,
  writeOpeningAssistant,
} from './session';
import type { InitSession } from './types';

type InitCommand = 'help' | 'status' | 'save' | 'cancel' | 'exit';

const INIT_COMMANDS: Array<SessionCommandSpec<InitCommand>> = [
  { name: 'help', summary: 'Show init commands.', summaryKey: 'commands.help.summary', hintKey: 'commands.help.hint' },
  { name: 'status', summary: 'Show likely missing World setup topics.', summaryKey: 'commands.status.summary', hintKey: 'commands.status.hint' },
  { name: 'save', summary: 'Finalize and write the World save.', summaryKey: 'commands.save.summary', hintKey: 'commands.save.hint' },
  { name: 'cancel', summary: 'Cancel initialization.', summaryKey: 'commands.cancel.summary', hintKey: 'commands.cancel.hint' },
  { name: 'exit', summary: 'Exit initialization.', summaryKey: 'commands.exit.summary', hintKey: 'commands.exit.hint' },
];

async function runInterviewRound(session: InitSession, onDelta?: (text: string) => void): Promise<string> {
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
  const t = createTranslator();
  const session = createSession();
  writeOpeningAssistant(session.messagesDir, OPENING_ASSISTANT);

  process.stdout.write('\n--- World building interview ---\n\n');
  process.stdout.write(stripDisplay(OPENING_ASSISTANT));
  process.stdout.write('\n');

  for (let round = 1; round <= maxRounds; round += 1) {
    session.round = round;
    let userText: string;
    try {
      userText = await readUserInput({ commandHint: formatAvailableCommands(INIT_COMMANDS, t), t });
    } catch (err) {
      if (err instanceof InitCancelledError) {
        throw new InitCancelledError(err.message, session);
      }
      throw err;
    }

    const command = parseSessionCommand(userText, INIT_COMMANDS);
    if (command.kind === 'unknown') {
      process.stdout.write(formatUnknownCommand(command.raw, INIT_COMMANDS, t));
      round -= 1;
      continue;
    }
    if (command.kind === 'command') {
      if (command.name === 'help') {
        process.stdout.write(formatCommandHelp(INIT_COMMANDS, t));
        round -= 1;
        continue;
      }
      if (command.name === 'status') {
        printMissingTopics(buildTranscript(session.messagesDir));
        round -= 1;
        continue;
      }
      if (command.name === 'cancel') {
        throw new InitCancelledError('Initialization cancelled.', session);
      }
      if (command.name === 'exit') {
        throw new InitCancelledError('Initialization exited.', session);
      }
      if (command.name === 'save') {
        const transcript = buildTranscript(session.messagesDir);
        const missing = getInterviewMissingFromTranscript(transcript);
        if (missing.length > 0) {
          process.stdout.write(`Possible missing topics: ${missing.join(', ')}.\n`);
          if (!await askYesNo('Continue saving anyway? (Y/N): ')) {
            round -= 1;
            continue;
          }
        }
        process.stdout.write('\nInterview complete. Finalizing world save...\n');
        return { session, transcript };
      }
    }

    appendUserMessage(session.messagesDir, userText);
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

function printMissingTopics(transcript: string): void {
  const missing = getInterviewMissingFromTranscript(transcript);
  process.stdout.write(missing.length > 0
    ? `Likely missing topics: ${missing.join(', ')}\n`
    : 'No likely missing topics.\n');
}
