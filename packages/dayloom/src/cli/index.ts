import { Command } from 'commander';
import { registerDailyCommand } from './daily';
import { registerInitCommand } from './init';
import { registerNextCommand } from './next';
import { registerReviseCommand } from './revise';
import { registerPlayCommand } from './play';
import { registerSettleCommand } from './settle';
import { addLangOption, createTranslator, detectLocale } from '../i18n';

export function parseCli(argv: string[] = process.argv): void {
  const t = createTranslator(detectLocale(argv, process.env));
  const program = new Command();
  program
    .name('dayloom')
    .description(t('cli.description'))
    .version('0.0.0', '-V, --version', t('cli.version'))
    .helpOption('-h, --help', t('cli.help'))
    .helpCommand('help [command]', t('cli.helpCommand'));
  addLangOption(program, t);

  registerInitCommand(program, t);
  registerNextCommand(program, t);
  registerDailyCommand(program, t);
  registerPlayCommand(program, t);
  registerSettleCommand(program, t);
  registerReviseCommand(program, t);

  program.parse(argv);
}
