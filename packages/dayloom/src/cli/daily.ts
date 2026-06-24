import { Command } from 'commander';
import { dailyFromProposal, dailyInteractive } from '../daily';

export function registerDailyCommand(program: Command): void {
  program.command('daily')
    .description('Plan the current day from the protagonist perspective')
    .requiredOption('-d, --dir <path>', 'World save root directory')
    .option('--proposal <path>', 'Apply a daily plan JSON file instead of starting AI chat')
    .option('--dry-run', 'Show projected file changes without writing')
    .option('--yes', 'Apply the validated daily plan without prompting')
    .option('--keep-session', 'Preserve temporary AI daily sessions')
    .option('--max-tool-rounds <n>', 'Maximum MCP tool rounds per user message', parsePositiveInt, 8)
    .option('--mcp-base-url <url>', 'Use an existing promptpile-mcp gateway')
    .option('--mcp-token <token>', 'Bearer token for an existing promptpile-mcp gateway')
    .action(async (opts: { dir: string; proposal?: string; dryRun?: boolean; yes?: boolean; keepSession?: boolean; maxToolRounds: number; mcpBaseUrl?: string; mcpToken?: string }) => {
      try {
        if (!opts.proposal) {
          await dailyInteractive(opts.dir, { dryRun: opts.dryRun, yes: opts.yes, keepSession: opts.keepSession, maxToolRounds: opts.maxToolRounds, mcpBaseUrl: opts.mcpBaseUrl, mcpToken: opts.mcpToken ?? process.env.PROMPTPILE_MCP_TOKEN });
          return;
        }
        const result = dailyFromProposal(opts.dir, opts.proposal, { dryRun: opts.dryRun, yes: opts.yes });
        process.stdout.write(`${result.description}\n`);
        process.stdout.write(result.applied ? 'Applied daily plan.\n' : 'Dry run only. No files changed.\n');
      } catch (err) {
        console.error('Error:', err instanceof Error ? err.message : err);
        process.exitCode = 1;
      }
    });
}

function parsePositiveInt(value: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) throw new Error('--max-tool-rounds must be a positive integer');
  return parsed;
}
