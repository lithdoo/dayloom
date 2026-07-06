import { Command } from 'commander';
import {
  addLangOption,
  runSettleInteractive,
  settleFromProposal,
  type Translator,
} from '@dayloom/core';
import { createCliSessionIO } from '../session-io/cli-io';

export function registerSettleCommand(program: Command, t: Translator): void {
  const command = program.command('settle')
    .description(t('cli.settle.description'))
    .requiredOption('-d, --dir <path>', t('cli.common.dir'))
    .option('--proposal <path>', t('cli.settle.proposal'))
    .option('--dry-run', t('cli.settle.dryRun'))
    .option('--yes', t('cli.settle.yes'))
    .option('--keep-session', t('cli.settle.keepSession'))
    .option('--max-tool-rounds <n>', t('cli.settle.maxToolRounds'), parsePositiveInt(t), 8)
    .option('--mcp-base-url <url>', t('cli.common.mcpBaseUrl'))
    .option('--mcp-token <token>', t('cli.common.mcpToken'));
  addLangOption(command, t)
    .action(async (opts: { dir: string; proposal?: string; dryRun?: boolean; yes?: boolean; keepSession?: boolean; maxToolRounds: number; mcpBaseUrl?: string; mcpToken?: string }) => {
      try {
        const common = { dryRun: opts.dryRun, yes: opts.yes, t };
        if (opts.proposal) {
          const result = settleFromProposal(opts.dir, opts.proposal, common);
          process.stdout.write(`${result.description}\n`);
          if (result.applied) process.stdout.write(`${t('cli.settle.settled', { day: result.day, nextDay: result.nextDay })}\n`);
          else process.stdout.write(`${t('cli.common.dryRunOnly')}\n`);
          return;
        }
        const io = createCliSessionIO();
        const exit = await runSettleInteractive(opts.dir, { ...common, keepSession: opts.keepSession, maxToolRounds: opts.maxToolRounds, mcpBaseUrl: opts.mcpBaseUrl, mcpToken: opts.mcpToken ?? process.env.PROMPTPILE_MCP_TOKEN, io });
        if (exit.kind === 'completed' && exit.result) {
          const result = exit.result;
          process.stdout.write(`${result.description}\n`);
          if (result.applied) process.stdout.write(`${t('cli.settle.settled', { day: result.day, nextDay: result.nextDay })}\n`);
          else if (result.proposalPath) process.stdout.write(`${t('cli.settle.generatedProposal', { proposalPath: result.proposalPath })}\n${t('cli.settle.reviewProposal')}\n`);
          else process.stdout.write(`${t('cli.common.dryRunOnly')}\n`);
        } else if (exit.kind === 'shell-command') {
          process.stderr.write(`Shell command /${exit.command} is not available in CLI mode (Phase 3: runGameShell).\n`);
          process.exitCode = 1;
        }
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
