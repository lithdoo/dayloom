import { Command } from 'commander';
import {
  addLangOption,
  dailyFromProposal,
  runDailyInteractive,
  type Translator,
} from '@dayloom/core';
import { createCliSessionIO } from '../session-io/cli-io';

export function registerDailyCommand(program: Command, t: Translator): void {
  const command = program.command('daily')
    .description(t('cli.daily.description'))
    .requiredOption('-d, --dir <path>', t('cli.common.dir'))
    .option('--proposal <path>', t('cli.daily.proposal'))
    .option('--dry-run', t('cli.daily.dryRun'))
    .option('--yes', t('cli.daily.yes'))
    .option('--keep-session', t('cli.daily.keepSession'))
    .option('--max-tool-rounds <n>', t('cli.daily.maxToolRounds'), parsePositiveInt(t), 8)
    .option('--mcp-base-url <url>', t('cli.common.mcpBaseUrl'))
    .option('--mcp-token <token>', t('cli.common.mcpToken'));
  addLangOption(command, t)
    .action(async (opts: { dir: string; proposal?: string; dryRun?: boolean; yes?: boolean; keepSession?: boolean; maxToolRounds: number; mcpBaseUrl?: string; mcpToken?: string }) => {
      try {
        if (!opts.proposal) {
          const io = createCliSessionIO();
          const exit = await runDailyInteractive(opts.dir, { dryRun: opts.dryRun, yes: opts.yes, keepSession: opts.keepSession, maxToolRounds: opts.maxToolRounds, mcpBaseUrl: opts.mcpBaseUrl, mcpToken: opts.mcpToken ?? process.env.PROMPTPILE_MCP_TOKEN, io });
          if (exit.kind === 'shell-command') {
            process.stderr.write(`Shell command /${exit.command} is not available in CLI mode (Phase 3: runGameShell).\n`);
            process.exitCode = 1;
          }
          return;
        }
        const result = dailyFromProposal(opts.dir, opts.proposal, { dryRun: opts.dryRun, yes: opts.yes });
        process.stdout.write(`${result.description}\n`);
        process.stdout.write(result.applied ? `${t('cli.daily.applied')}\n` : `${t('cli.common.dryRunOnly')}\n`);
      } catch (err) {
        console.error(t('cli.error'), err instanceof Error ? err.message : err);
        process.exitCode = 1;
      }
    });
}

function parsePositiveInt(t: Translator): (value: string) => number {
  return value => {
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed < 1) throw new Error(t('cli.positiveInteger'));
    return parsed;
  };
}
