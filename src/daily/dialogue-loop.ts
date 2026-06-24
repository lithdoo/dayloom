import { createFilteredStreamOutput } from '../shared/filtered-stream-output';
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
    process.stdout.write(`\n--- Daily planning session ---\n\n${OPENING_ASSISTANT}\n`);

    while (true) {
      const input = await readDailyUserInput();
      if (input === undefined) {
        preserveSession = true;
        process.stdout.write(`Daily draft saved in session: ${session.root}\n`);
        return;
      }

      const explicit = parseExplicitDailyAction(input);
      if (explicit === 'help') {
        printHelp();
        continue;
      }

      let action: DailyAction;
      if (explicit) action = explicit;
      else {
        let intent = fallbackDailyIntent('Intent router was not called');
        try {
          intent = await withLoading('正在识别操作...', () => routeDailyIntent(
            input,
            readDraft(session),
            getLatestAssistantText(session.messagesDir),
            gateway!.baseUrl,
            gateway!.token,
            maxToolRounds,
            false,
          ));
        } catch (error) {
          process.stderr.write(`Warning: daily intent router failed; treating input as a planning message: ${error instanceof Error ? error.message : error}\n`);
          intent = fallbackDailyIntent('Router failure');
        }
        action = effectiveDailyAction(intent);
      }

      if (action === 'pending') {
        process.stdout.write(`${JSON.stringify(readDraft(session), null, 2)}\n`);
        continue;
      }
      if (action === 'exit') {
        preserveSession = true;
        process.stdout.write(`Daily draft saved in session: ${session.root}\n`);
        return;
      }
      if (action === 'cancel') {
        if (await askYesNo('Discard the current daily draft? (Y/N): ')) {
          process.stdout.write('Daily planning cancelled.\n');
          return;
        }
        process.stdout.write('Daily planning continues.\n');
        continue;
      }
      if (action === 'start') {
        if (!explicit) appendUserMessage(session.messagesDir, input);
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

function printHelp(): void {
  process.stdout.write('Use natural language to discuss, inspect, confirm, cancel, or save the plan. Commands remain available: /pending /start /cancel /exit\n');
}
