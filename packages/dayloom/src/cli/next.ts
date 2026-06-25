import { Command } from 'commander';
import { addLangOption, type Translator } from '../i18n';
import { InitCancelledError, runNext } from '../next';

export function registerNextCommand(program: Command, t: Translator): void {
  const command = program.command('next')
    .description(t('cli.next.description'))
    .requiredOption('-d, --dir <path>', t('cli.common.dir'))
    .option('--status', t('cli.next.status'))
    .option('--confirm', t('cli.next.confirm'))
    .option('--quick', t('cli.next.quick'))
    .option('--id <id>', t('cli.next.id'))
    .option('--title <title>', t('cli.next.title'))
    .option('--max-rounds <n>', t('cli.next.maxRounds'), parsePositiveInt(t), 12)
    .option('--dry-run', t('cli.next.dryRun'))
    .option('--yes', t('cli.next.yes'))
    .option('--keep-session', t('cli.next.keepSession'))
    .option('--max-tool-rounds <n>', t('cli.next.maxToolRounds'), parsePositiveInt(t), 8)
    .option('--max-event-rounds <n>', t('cli.next.maxEventRounds'), parsePositiveInt(t), 20)
    .option('--mcp-base-url <url>', t('cli.common.mcpBaseUrl'))
    .option('--mcp-token <token>', t('cli.common.mcpToken'));
  addLangOption(command, t)
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
          t,
        });
      } catch (err) {
        if (err instanceof InitCancelledError) {
          process.stderr.write(`${err.message}\n`);
          process.exit(0);
        }
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
