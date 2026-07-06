import { createTranslator } from '../i18n';
import { formatNextStatus, inspectNextState } from '../next/inspect';
import type { RecommendedActionOptions } from '../next/recommended-action';
import { parseShellLevelCommand } from '../session-io';
import { formatShellCommandHint, formatShellHelp, formatUnknownShellCommand } from './commands';
import { handleShellCommand, runShellNext } from './routing';
import type { GameShellOptions } from './types';

export type { GameShellOptions } from './types';
export { formatShellCommandHint, formatShellHelp, formatUnknownShellCommand, SHELL_WAIT_COMMANDS } from './commands';
export { handleShellCommand, runShellNext, parseShellWaitInput } from './routing';

export async function runGameShell(options: GameShellOptions): Promise<void> {
  const t = options.t ?? createTranslator('en');
  const actionOpts = pickRecommendedOptions(options, t);
  const ctx = { worldDir: options.worldDir, actionOpts, t };

  if (options.autoStart) {
    await runShellNext(ctx);
  }

  while (true) {
    const input = await options.io.readInput({
      instruction: t('shell.promptInstruction'),
      userPrompt: t('shell.prompt'),
      commandHint: formatShellCommandHint(t),
      emptyBehavior: 'ignore',
    });
    if (input === undefined) continue;

    const token = input.trim().split(/\s+/, 1)[0].toLowerCase();

    if (token === '/status') {
      const state = inspectNextState(options.worldDir);
      options.io.write(`${formatNextStatus(state, t)}\n`);
      continue;
    }
    if (token === '/help') {
      options.io.write(formatShellHelp(t));
      continue;
    }

    const shell = parseShellLevelCommand(input);
    if (!shell) {
      options.io.write(formatUnknownShellCommand(input, t));
      continue;
    }

    if (shell === 'quit') return;

    if (shell === 'next') {
      await runShellNext(ctx);
      continue;
    }

    if (shell === 'revise') {
      await handleShellCommand({ kind: 'shell-command', command: 'revise', raw: input }, ctx);
      continue;
    }
  }
}

function pickRecommendedOptions(options: GameShellOptions, t: ReturnType<typeof createTranslator>): RecommendedActionOptions {
  return {
    io: options.io,
    t,
    quick: options.quick,
    id: options.id,
    title: options.title,
    maxRounds: options.maxRounds,
    dryRun: options.dryRun,
    yes: options.yes,
    keepSession: options.keepSession,
    maxToolRounds: options.maxToolRounds,
    maxEventRounds: options.maxEventRounds,
    mcpBaseUrl: options.mcpBaseUrl,
    mcpToken: options.mcpToken,
  };
}
