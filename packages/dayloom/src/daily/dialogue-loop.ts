import { createFilteredStreamOutput } from '../shared/filtered-stream-output';
import { formatAvailableCommands, formatCommandHelp, formatUnknownCommand, parseSessionCommand, type SessionCommandSpec } from '../session-commands';
import { withLoading } from '../utils/loading';
import { DEFAULT_MAX_TOOL_ROUNDS, OPENING_ASSISTANT } from './constants';
import { applyDailyPlan, describeChanges } from './apply-plan';
import { finalizeDailyPlan } from './finalize';
import { assertDailyCanStart, assertInitializedWorld, readCurrentDay, readLastCommittedDay, resolveWorldRoot } from './guard';
import { effectiveDailyAction, fallbackDailyIntent, parseExplicitDailyAction, routeDailyIntent } from './intent-router';
import { connectOrStartGateway } from './mcp-gateway';
import { assertAllowedPlayerContextRoot, exportReadonlyTools } from './mcp-tools';
import { parseDailyStatus } from './parse-assistant';
import { buildPlayerContext } from './player-context';
import { projectDailyPlan } from './project-plan';
import { runPromptpileUntilText } from './promptpile-loop';
import { askYesNo, readDailyUserInput } from './read-user-input';
import { appendUserMessage, buildTranscript, cleanupSession, createDailySession, getLatestAssistantText, readDraft, writeDraft } from './session';
import type { DailyAction, DailyOptions, DailySession } from './types';
import { validateDailyPlan } from './validate-plan';

type DailyCommand = 'help' | 'status' | 'save' | 'cancel' | 'exit';

const DAILY_COMMANDS: Array<SessionCommandSpec<DailyCommand>> = [
  { name: 'help', summary: 'Show daily commands.' },
  { name: 'status', aliases: ['pending'], summary: 'Show the current daily draft.' },
  { name: 'save', aliases: ['start'], summary: 'Finalize and apply the daily plan.' },
  { name: 'cancel', summary: 'Discard the current daily draft.' },
  { name: 'exit', summary: 'Exit and preserve the daily session.' },
];

export async function dailyInteractive(dir: string, options: DailyOptions = {}): Promise<void> {
  if (!process.env.DEEPSEEK_API_KEY?.trim()) throw new Error('DEEPSEEK_API_KEY is not set. Interactive daily requires an API key.');
  const worldRoot = resolveWorldRoot(dir);
  assertInitializedWorld(worldRoot);
  assertDailyCanStart(worldRoot);
  const day = readCurrentDay(worldRoot);
  const lastCommittedDay = readLastCommittedDay(worldRoot);
  const session = createDailySession();
  let preserveSession = options.keepSession ?? false;
  let gateway: Awaited<ReturnType<typeof connectOrStartGateway>> | undefined;
  const maxToolRounds = options.maxToolRounds ?? DEFAULT_MAX_TOOL_ROUNDS;

  try {
    await withLoading('正在准备当日计划...', async loading => {
      buildPlayerContext(worldRoot, session.playerContextRoot);
      loading.update('正在启动只读服务...');
      gateway = await connectOrStartGateway(session.root, session.playerContextRoot, options.mcpBaseUrl, options.mcpToken);
      loading.update('正在准备主角上下文...');
      await exportReadonlyTools(gateway.baseUrl, gateway.token, session.toolsFile);
      await assertAllowedPlayerContextRoot(gateway.baseUrl, gateway.token, session.playerContextRoot, session.root);
    });
    if (!gateway) throw new Error('Failed to initialize readonly gateway');
    process.stdout.write(`\n--- Daily planning session ---\n\n${formatAvailableCommands(DAILY_COMMANDS)}\n${OPENING_ASSISTANT}\n`);

    while (true) {
      const input = await readDailyUserInput();
      if (input === undefined) {
        preserveSession = true;
        process.stdout.write(`Daily draft saved in session: ${session.root}\n`);
        return;
      }

      const command = parseSessionCommand(input, DAILY_COMMANDS);
      if (command.kind === 'unknown') {
        process.stdout.write(formatUnknownCommand(command.raw));
        continue;
      }
      if (command.kind === 'command' && command.name === 'help') {
        process.stdout.write(formatCommandHelp(DAILY_COMMANDS));
        continue;
      }

      if (command.kind === 'command' && command.name === 'status') {
        process.stdout.write(`${JSON.stringify(readDraft(session), null, 2)}\n`);
        continue;
      }
      if (command.kind === 'command' && command.name === 'exit') {
        preserveSession = true;
        process.stdout.write(`Daily draft saved in session: ${session.root}\n`);
        return;
      }
      if (command.kind === 'command' && command.name === 'cancel') {
        if (await askYesNo('Discard the current daily draft? (Y/N): ')) {
          process.stdout.write('Daily planning cancelled.\n');
          return;
        }
        process.stdout.write('Daily planning continues.\n');
        continue;
      }
      if (command.kind === 'command' && command.name === 'save') {
        const applied = await finalizeAndApplyPlan(worldRoot, day, lastCommittedDay, session, gateway.baseUrl, gateway.token, maxToolRounds, options);
        if (applied) return;
        continue;
      }

      appendUserMessage(session.messagesDir, input);
      process.stdout.write('\nAI> ');
      const stream = createFilteredStreamOutput({ hiddenBlocks: ['daily-status'] });
      const reply = await runPromptpileUntilText(session, gateway.baseUrl, gateway.token, maxToolRounds, text => stream.push(text));
      stream.flush();
      try {
        const status = parseDailyStatus(reply);
        if (status) writeDraft(session, status);
      } catch (error) {
        process.stderr.write(`Warning: ${error instanceof Error ? error.message : error}\n`);
      }
      process.stdout.write('\n');
    }
  } finally {
    if (gateway) await gateway.stop();
    if (preserveSession) process.stderr.write(`Daily session preserved at: ${session.root}\n`);
    else cleanupSession(session);
  }
}

async function finalizeAndApplyPlan(
  worldRoot: string,
  day: string,
  lastCommittedDay: string,
  session: DailySession,
  baseUrl: string,
  token: string | undefined,
  maxToolRounds: number,
  options: DailyOptions,
): Promise<boolean> {
  const draft = readDraft(session);
  if (!draft.user_intent.trim()) {
    process.stdout.write('No daily intent collected yet.\n');
    return false;
  }
  const transcript = buildTranscript(session.messagesDir);
  const plan = await withLoading('正在生成正式计划...', () =>
    finalizeDailyPlan(transcript, draft, day, session.toolsFile, baseUrl, token, maxToolRounds, options.keepSession));
  validateDailyPlan(plan, day);
  const changes = projectDailyPlan(plan, transcript, lastCommittedDay);
  const description = describeChanges(worldRoot, changes);
  process.stdout.write(`\n${description}\n`);
  if (options.dryRun) {
    process.stdout.write('Dry run only. No files changed.\n');
    return false;
  }
  if (!options.yes && !await askYesNo(`Generate and apply the ${day} plan? (Y/N): `)) {
    process.stdout.write('Daily plan not applied.\n');
    return false;
  }
  assertDailyCanStart(worldRoot);
  applyDailyPlan(worldRoot, plan, changes);
  process.stdout.write('Applied daily plan.\n');
  return true;
}
