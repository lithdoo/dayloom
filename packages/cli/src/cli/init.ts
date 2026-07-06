import { Command } from 'commander';
import {
  InitCancelledError,
  addLangOption,
  initWorldQuick,
  runInitInteractive,
  type Translator,
} from '@dayloom/core';
import { createCliSessionIO } from '../session-io/cli-io';

export function registerInitCommand(program: Command, t: Translator): void {
  const command = program
    .command('init')
    .description(t('cli.init.description'))
    .requiredOption('-d, --dir <path>', t('cli.common.dir'))
    .option('--quick', t('cli.init.quick'))
    .option('--id <id>', t('cli.init.id'))
    .option('--title <title>', t('cli.init.title'))
    .option(
      '--max-rounds <n>',
      t('cli.init.maxRounds'),
      (v: string) => parseInt(v, 10),
      12
    )
    .option('--keep-session', t('cli.init.keepSession'));
  addLangOption(command, t)
    .action(async (opts: {
      dir: string;
      quick?: boolean;
      id?: string;
      title?: string;
      maxRounds: number;
      keepSession?: boolean;
    }) => {
      try {
        const options = {
          id: opts.id,
          title: opts.title,
          maxRounds: opts.maxRounds,
          keepSessionOnError: opts.keepSession,
        };

        if (opts.quick) {
          const worldRoot = initWorldQuick(opts.dir, options);
          process.stdout.write(`Initialized World save: ${worldRoot}\n`);
          return;
        }

        const io = createCliSessionIO();
        const exit = await runInitInteractive(opts.dir, { io, ...options });
        if (exit.kind === 'completed' && exit.result) {
          process.stdout.write(`Initialized World save: ${exit.result.worldRoot}\n`);
        } else if (exit.kind === 'cancelled') {
          process.stderr.write('Initialization cancelled.\n');
          process.exit(0);
        } else if (exit.kind === 'shell-command') {
          process.stderr.write(`Shell command /${exit.command} is not available in CLI mode (Phase 3: runGameShell).\n`);
          process.exit(1);
        }
      } catch (err) {
        if (err instanceof InitCancelledError) {
          process.stderr.write(`${err.message}\n`);
          process.exit(0);
        }
        console.error(t('cli.error'), err instanceof Error ? err.message : err);
        process.exit(1);
      }
    });
}
