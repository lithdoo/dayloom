import readline from 'readline';
import { createTranslator, type Translator } from '../i18n';
import { readTerminalInput } from '../shared/terminal-input';
import { InitCancelledError } from './errors';

interface ReadUserInputOptions {
  commandHint?: string;
  t?: Translator;
}

function askExitOnEmpty(t: Translator): Promise<boolean> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise(resolve => {
    rl.question(t('input.emptyExit'), answer => {
      rl.close();
      resolve(/^y$/i.test(answer.trim()));
    });
  });
}

export async function readUserInput(options: ReadUserInputOptions = {}): Promise<string> {
  const t = options.t ?? createTranslator();
  while (true) {
    const text = (await readTerminalInput({
      commandHint: options.commandHint,
      instruction: t('input.replyInstruction'),
      userPrompt: t('input.userPrompt'),
    })).trim();
    if (text) {
      return text;
    }
    if (await askExitOnEmpty(t)) {
      throw new InitCancelledError();
    }
  }
}
