import { Command } from 'commander';
import { addLangOption, runPlayInteractive, type Translator } from '@dayloom/core';
import { createCliSessionIO } from '../session-io/cli-io';

export function registerPlayCommand(program: Command, t: Translator): void {
  const command = program.command('play')
    .description(t('cli.play.description'))
    .requiredOption('-d, --dir <path>', t('cli.common.dir'))
    .option('--keep-session', t('cli.play.keepSession'))
    .option('--max-tool-rounds <n>', t('cli.play.maxToolRounds'), positive(t), 8)
    .option('--max-event-rounds <n>', t('cli.play.maxEventRounds'), positive(t), 20)
    .option('--mcp-base-url <url>', t('cli.common.mcpBaseUrl'))
    .option('--mcp-token <token>', t('cli.common.mcpToken'));
  addLangOption(command, t)
    .action(async (opts: {
      dir: string;
      keepSession?: boolean;
      maxToolRounds: number;
      maxEventRounds: number;
      mcpBaseUrl?: string;
      mcpToken?: string;
    }) => {
      try {
        const io = createCliSessionIO();
        const exit = await runPlayInteractive(opts.dir, {
          keepSession: opts.keepSession,
          maxToolRounds: opts.maxToolRounds,
          maxEventRounds: opts.maxEventRounds,
          mcpBaseUrl: opts.mcpBaseUrl,
          mcpToken: opts.mcpToken ?? process.env.PROMPTPILE_MCP_TOKEN,
          io,
        });
        if (exit.kind === 'shell-command') {
          process.stderr.write(`Shell command /${exit.command} is not available in CLI mode (Phase 3: runGameShell).\n`);
          process.exitCode = 1;
        }
      } catch (err) {
        console.error(t('cli.error'), err instanceof Error ? err.message : err);
        process.exitCode = 1;
      }
    });
}

function positive(t: Translator): (value: string) => number {
  return value => {
    const n = Number(value);
    if (!Number.isInteger(n) || n < 1) throw new Error(t('cli.positiveInteger'));
    return n;
  };
}
