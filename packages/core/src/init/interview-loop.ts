import {
  DEFAULT_MAX_INTERVIEW_ROUNDS,
  OPENING_ASSISTANT,
} from './constants';
import { isInterviewReady, getInterviewMissingFromTranscript } from './checklist';
import { InitCancelledError } from './errors';
import { parseInterviewStatus } from './parse-assistant';
import { assertPromptpileOk, runPromptpile } from './promptpile-run';
import { createTranslator } from '../i18n';
import { formatAvailableCommands, formatCommandHelp, formatUnknownCommand, parseSessionCommand, type SessionCommandSpec } from '../session-commands';
import { parseShellLevelCommand, type SessionExit, type SessionIO } from '../session-io';
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

export type InterviewLoopResult =
  | { session: InitSession; transcript: string }
  | SessionExit;

export async function runInterviewLoop(
  io: SessionIO,
  maxRounds: number = DEFAULT_MAX_INTERVIEW_ROUNDS,
): Promise<InterviewLoopResult> {
  const t = createTranslator();
  const session = createSession();
  writeOpeningAssistant(session.messagesDir, OPENING_ASSISTANT);

  io.write('\n--- World building interview ---\n\n');
  io.write(stripDisplay(OPENING_ASSISTANT));
  io.write('\n');

  for (let round = 1; round <= maxRounds; round += 1) {
    session.round = round;
    let userText: string | undefined;
    while (userText === undefined) {
      try {
        const input = await io.readInput({
          commandHint: formatAvailableCommands(INIT_COMMANDS, t),
          instruction: t('input.replyInstruction'),
          userPrompt: t('input.userPrompt'),
          emptyBehavior: 'ask-exit',
        });
        if (input !== undefined) userText = input;
      } catch (err) {
        if (err instanceof InitCancelledError) {
          throw new InitCancelledError(err.message, session);
        }
        throw err;
      }
    }

    const command = parseSessionCommand(userText, INIT_COMMANDS);
    if (command.kind === 'unknown') {
      const shell = parseShellLevelCommand(userText);
      if (shell) return { kind: 'shell-command', command: shell, raw: userText };
      io.write(formatUnknownCommand(command.raw, INIT_COMMANDS, t));
      round -= 1;
      continue;
    }
    if (command.kind === 'command') {
      if (command.name === 'help') {
        io.write(formatCommandHelp(INIT_COMMANDS, t));
        round -= 1;
        continue;
      }
      if (command.name === 'status') {
        printMissingTopics(io, buildTranscript(session.messagesDir));
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
          io.write(`Possible missing topics: ${missing.join(', ')}.\n`);
          if (!await io.confirm('Continue saving anyway? (Y/N): ')) {
            round -= 1;
            continue;
          }
        }
        io.write('\nInterview complete. Finalizing world save...\n');
        return { session, transcript };
      }
    }

    appendUserMessage(session.messagesDir, userText);
    io.write('\n--- Assistant ---\n\n');
    const displayStream = createInitDisplayStream(io);
    const assistantText = await runInterviewRound(session, text => displayStream.push(text));
    displayStream.flush();
    io.write('\n');

    const status = parseInterviewStatus(assistantText);
    const transcript = buildTranscript(session.messagesDir);

    if (isInterviewReady(status, transcript)) {
      io.write('\nInterview complete. Finalizing world save...\n');
      return { session, transcript };
    }

    if (status.status === 'ready') {
      const gaps = [
        ...status.missing,
        ...getInterviewMissingFromTranscript(transcript),
      ];
      io.write(
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

function createInitDisplayStream(io: SessionIO): { push(text: string): void; flush(): void } {
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
    io.write(line);
    if (hasNewline) {
      io.write('\n');
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

function printMissingTopics(io: SessionIO, transcript: string): void {
  const missing = getInterviewMissingFromTranscript(transcript);
  io.write(missing.length > 0
    ? `Likely missing topics: ${missing.join(', ')}\n`
    : 'No likely missing topics.\n');
}
