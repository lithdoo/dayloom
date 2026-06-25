import { Command } from 'commander';
import { InitCancelledError } from '../init/errors';
import { initWorldInteractive, initWorldQuick } from '../init';
import { addLangOption, type Translator } from '../i18n';

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

        const worldRoot = opts.quick
          ? initWorldQuick(opts.dir, options)
          : await initWorldInteractive(opts.dir, options);

        process.stdout.write(`Initialized World save: ${worldRoot}\n`);
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
