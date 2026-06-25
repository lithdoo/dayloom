import { Command } from 'commander';
import { InitCancelledError, runNext } from '../next';

export function registerNextCommand(program: Command): void {
  program.command('next')
    .description('Inspect a World save and run the next appropriate dayloom phase')
    .requiredOption('-d, --dir <path>', 'World save root directory')
    .option('--status', 'Only show current state and recommended next command')
    .option('--confirm', 'Ask before running the next action')
    .option('--quick', 'When uninitialized, scaffold an empty World without AI interview')
    .option('--id <id>', 'World id for init')
    .option('--title <title>', 'World title for init')
    .option('--max-rounds <n>', 'Maximum init interview rounds', parsePositiveInt, 12)
    .option('--dry-run', 'Pass dry-run mode to daily or settle')
    .option('--yes', 'Apply generated daily or settlement changes without prompting where supported')
    .option('--keep-session', 'Preserve temporary AI and MCP sessions where supported')
    .option('--max-tool-rounds <n>', 'Maximum MCP tool rounds per AI call', parsePositiveInt, 8)
    .option('--max-event-rounds <n>', 'Maximum user turns in one play event', parsePositiveInt, 20)
    .option('--mcp-base-url <url>', 'Use an existing promptpile-mcp gateway')
    .option('--mcp-token <token>', 'Bearer token for an existing promptpile-mcp gateway')
    .action(async (opts: {
      dir: string;
      status?: boolean;
      confirm?: boolean;
      quick?: boolean;
      id?: string;
      title?: string;
      maxRounds: number;
      dryRun?: boolean;
      yes?: boolean;
      keepSession?: boolean;
      maxToolRounds: number;
      maxEventRounds: number;
      mcpBaseUrl?: string;
      mcpToken?: string;
    }) => {
      try {
        await runNext(opts.dir, {
          statusOnly: opts.status,
          confirm: opts.confirm,
          quick: opts.quick,
          id: opts.id,
          title: opts.title,
          maxRounds: opts.maxRounds,
          dryRun: opts.dryRun,
          yes: opts.yes,
          keepSession: opts.keepSession,
          maxToolRounds: opts.maxToolRounds,
          maxEventRounds: opts.maxEventRounds,
          mcpBaseUrl: opts.mcpBaseUrl,
          mcpToken: opts.mcpToken ?? process.env.PROMPTPILE_MCP_TOKEN,
        });
      } catch (err) {
        if (err instanceof InitCancelledError) {
          process.stderr.write(`${err.message}\n`);
          process.exit(0);
        }
        console.error('Error:', err instanceof Error ? err.message : err);
        process.exitCode = 1;
      }
    });
}

function parsePositiveInt(value: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) throw new Error('Expected a positive integer');
  return parsed;
}
