import { Command } from 'commander';
import { settleFromProposal, settleWithAi } from '../settle';

export function registerSettleCommand(program: Command): void {
  program.command('settle')
    .description('Settle the completed day and advance to the next idle day')
    .requiredOption('-d, --dir <path>', 'World save root directory')
    .option('--proposal <path>', 'Apply an existing settlement proposal JSON file')
    .option('--dry-run', 'Show projected file changes without committing the settlement')
    .option('--yes', 'Apply the validated settlement without stopping at a generated draft')
    .option('--keep-session', 'Preserve temporary AI and MCP sessions')
    .option('--max-tool-rounds <n>', 'Maximum MCP tool rounds for the AI call', parsePositiveInt, 8)
    .option('--mcp-base-url <url>', 'Use an existing promptpile-mcp gateway')
    .option('--mcp-token <token>', 'Bearer token for an existing promptpile-mcp gateway')
    .action(async (opts: { dir: string; proposal?: string; dryRun?: boolean; yes?: boolean; keepSession?: boolean; maxToolRounds: number; mcpBaseUrl?: string; mcpToken?: string }) => {
      try {
        const common = { dryRun: opts.dryRun, yes: opts.yes };
        const result = opts.proposal
          ? settleFromProposal(opts.dir, opts.proposal, common)
          : await settleWithAi(opts.dir, { ...common, keepSession: opts.keepSession, maxToolRounds: opts.maxToolRounds, mcpBaseUrl: opts.mcpBaseUrl, mcpToken: opts.mcpToken ?? process.env.PROMPTPILE_MCP_TOKEN });
        process.stdout.write(`${result.description}\n`);
        if (result.applied) process.stdout.write(`Settled ${result.day}; advanced to ${result.nextDay}.\n`);
        else if ('proposalPath' in result && result.proposalPath) process.stdout.write(`Generated settlement proposal: ${result.proposalPath}\nReview it, then rerun with --proposal and --yes.\n`);
        else process.stdout.write('Dry run only. No files changed.\n');
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
