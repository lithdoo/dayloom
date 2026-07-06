import { createTranslator } from '../i18n';
import { formatAvailableCommands, formatCommandHelp, formatUnknownCommand, parseSessionCommand, type SessionCommandSpec } from '../session-commands';
import { parseShellLevelCommand, type SessionExit, type SessionIO } from '../session-io';
import { DEFAULT_MAX_TOOL_ROUNDS, OPENING_ASSISTANT } from './constants';
import { applyDailyPlan, describeChanges } from './apply-plan';
import { finalizeDailyPlan } from './finalize';
import { assertDailyCanStart, assertInitializedWorld, readCurrentDay, readLastCommittedDay, resolveWorldRoot } from './guard';
import { connectOrStartGateway } from './mcp-gateway';
import { assertAllowedPlayerContextRoot, exportReadonlyTools } from './mcp-tools';
import { parseDailyStatus } from './parse-assistant';
import { buildPlayerContext } from './player-context';
import { projectDailyPlan } from './project-plan';
import { runPromptpileUntilText } from './promptpile-loop';
import { appendUserMessage, buildTranscript, cleanupSession, createDailySession, getLatestAssistantText, readDraft, writeDraft } from './session';
import type { DailyOptions, DailyResult, DailySession } from './types';
import { validateDailyPlan } from './validate-plan';

type DailyCommand = 'help' | 'status' | 'save' | 'cancel' | 'exit';

const DAILY_COMMANDS: Array<SessionCommandSpec<DailyCommand>> = [
  { name: 'help', summary: 'Show daily commands.', summaryKey: 'commands.help.summary', hintKey: 'commands.help.hint' },
  { name: 'status', aliases: ['pending'], summary: 'Show the current daily draft.', summaryKey: 'commands.status.summary', hintKey: 'commands.status.hint' },
  { name: 'save', aliases: ['start'], summary: 'Finalize and apply the daily plan.', summaryKey: 'commands.save.summary', hintKey: 'commands.save.hint' },
  { name: 'cancel', summary: 'Discard the current daily draft.', summaryKey: 'commands.cancel.summary', hintKey: 'commands.cancel.hint' },
  { name: 'exit', summary: 'Exit and preserve the daily session.', summaryKey: 'commands.exit.summary', hintKey: 'commands.exit.hint' },
];

export type DailyInteractiveOptions = DailyOptions & { io: SessionIO };

export async function runDailyInteractive(
  dir: string,
  options: DailyInteractiveOptions,
): Promise<SessionExit<DailyResult>> {
  const { io, ...dailyOptions } = options;
  const t = createTranslator();
  if (!process.env.DEEPSEEK_API_KEY?.trim()) throw new Error('DEEPSEEK_API_KEY is not set. Interactive daily requires an API key.');
  const worldRoot = resolveWorldRoot(dir);
  assertInitializedWorld(worldRoot);
  assertDailyCanStart(worldRoot);
  const day = readCurrentDay(worldRoot);
  const lastCommittedDay = readLastCommittedDay(worldRoot);
  const session = createDailySession();
  let preserveSession = dailyOptions.keepSession ?? false;
  let gateway: Awaited<ReturnType<typeof connectOrStartGateway>> | undefined;
  const maxToolRounds = dailyOptions.maxToolRounds ?? DEFAULT_MAX_TOOL_ROUNDS;

  try {
    await io.withLoading('正在准备当日计划...', async loading => {
      buildPlayerContext(worldRoot, session.playerContextRoot);
      loading.update('正在启动只读服务...');
      gateway = await connectOrStartGateway(session.root, session.playerContextRoot, dailyOptions.mcpBaseUrl, dailyOptions.mcpToken);
      loading.update('正在准备主角上下文...');
      await exportReadonlyTools(gateway.baseUrl, gateway.token, session.toolsFile);
      await assertAllowedPlayerContextRoot(gateway.baseUrl, gateway.token, session.playerContextRoot, session.root);
    });
    if (!gateway) throw new Error('Failed to initialize readonly gateway');
    io.write(`\n--- Daily planning session ---\n\n${OPENING_ASSISTANT}\n`);

    while (true) {
      const input = await io.readInput({
        commandHint: formatAvailableCommands(DAILY_COMMANDS, t),
        instruction: t('input.messageInstruction'),
        userPrompt: t('input.userPrompt'),
        emptyBehavior: 'ask-save-draft',
      });
      if (input === undefined) {
        preserveSession = true;
        io.write(`Daily draft saved in session: ${session.root}\n`);
        return { kind: 'saved', sessionPath: session.root };
      }

      const command = parseSessionCommand(input, DAILY_COMMANDS);
      if (command.kind === 'unknown') {
        const shell = parseShellLevelCommand(input);
        if (shell) return { kind: 'shell-command', command: shell, raw: input };
        io.write(formatUnknownCommand(command.raw, DAILY_COMMANDS, t));
        continue;
      }
      if (command.kind === 'command' && command.name === 'help') {
        io.write(formatCommandHelp(DAILY_COMMANDS, t));
        continue;
      }

      if (command.kind === 'command' && command.name === 'status') {
        io.write(`${JSON.stringify(readDraft(session), null, 2)}\n`);
        continue;
      }
      if (command.kind === 'command' && command.name === 'exit') {
        preserveSession = true;
        io.write(`Daily draft saved in session: ${session.root}\n`);
        return { kind: 'saved', sessionPath: session.root };
      }
      if (command.kind === 'command' && command.name === 'cancel') {
        if (await io.confirm('Discard the current daily draft? (Y/N): ')) {
          io.write('Daily planning cancelled.\n');
          return { kind: 'cancelled' };
        }
        io.write('Daily planning continues.\n');
        continue;
      }
      if (command.kind === 'command' && command.name === 'save') {
        const result = await finalizeAndApplyPlan(worldRoot, day, lastCommittedDay, session, gateway.baseUrl, gateway.token, maxToolRounds, io, dailyOptions);
        if (result) return { kind: 'completed', result };
        continue;
      }

      appendUserMessage(session.messagesDir, input);
      io.write('\nAI> ');
      const stream = io.createStreamWriter({ hiddenBlocks: ['daily-status'] });
      const reply = await runPromptpileUntilText(session, gateway.baseUrl, gateway.token, maxToolRounds, text => stream.push(text));
      stream.flush();
      try {
        const status = parseDailyStatus(reply);
        if (status) writeDraft(session, status);
      } catch (error) {
        io.warn(`Warning: ${error instanceof Error ? error.message : error}\n`);
      }
      io.write('\n');
    }
  } finally {
    if (gateway) await gateway.stop();
    if (preserveSession) io.warn(`Daily session preserved at: ${session.root}\n`);
    else cleanupSession(session);
  }
}

/** @deprecated Use runDailyInteractive */
export const dailyInteractive = runDailyInteractive;

async function finalizeAndApplyPlan(
  worldRoot: string,
  day: string,
  lastCommittedDay: string,
  session: DailySession,
  baseUrl: string,
  token: string | undefined,
  maxToolRounds: number,
  io: SessionIO,
  options: DailyOptions,
): Promise<DailyResult | null> {
  const draft = readDraft(session);
  if (!draft.user_intent.trim()) {
    io.write('No daily intent collected yet.\n');
    return null;
  }
  const transcript = buildTranscript(session.messagesDir);
  const plan = await io.withLoading('正在生成正式计划...', () =>
    finalizeDailyPlan(transcript, draft, day, session.toolsFile, baseUrl, token, maxToolRounds, options.keepSession, io));
  validateDailyPlan(plan, day);
  const changes = projectDailyPlan(plan, transcript, lastCommittedDay);
  const description = describeChanges(worldRoot, changes);
  io.write(`\n${description}\n`);
  if (options.dryRun) {
    io.write('Dry run only. No files changed.\n');
    return null;
  }
  if (!options.yes && !await io.confirm(`Generate and apply the ${day} plan? (Y/N): `)) {
    io.write('Daily plan not applied.\n');
    return null;
  }
  assertDailyCanStart(worldRoot);
  applyDailyPlan(worldRoot, plan, changes);
  io.write('Applied daily plan.\n');
  return { worldRoot, description, applied: true };
}
