import { Command } from 'commander';
import { InitCancelledError } from '../init/errors';
import { initWorldInteractive, initWorldQuick } from '../init';

export function registerInitCommand(program: Command): void {
  program
    .command('init')
    .description('Initialize a new World save directory (see prompts/spec.md)')
    .requiredOption('-d, --dir <path>', 'World save root directory')
    .option('--quick', 'Empty scaffold only, no AI interview')
    .option('--id <id>', 'World id (default: directory basename or payload id)')
    .option('--title <title>', 'World title')
    .option(
      '--max-rounds <n>',
      'Maximum interview rounds',
      (v: string) => parseInt(v, 10),
      12
    )
    .option('--keep-session', 'On failure, preserve temp interview session path')
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
        console.error('Error:', err instanceof Error ? err.message : err);
        process.exit(1);
      }
    });
}
