import readline from 'readline';
import { createTranslator, type Translator } from '../i18n';
import { readTerminalInput } from '../shared/terminal-input';

interface ReadReviseUserInputOptions {
  commandHint?: string;
  t?: Translator;
}

export async function readReviseUserInput(options: ReadReviseUserInputOptions = {}): Promise<string | undefined> {
  const t = options.t ?? createTranslator();
  while (true) {
    const text = (await readTerminalInput({
      commandHint: options.commandHint,
      instruction: t('input.messageInstruction'),
      userPrompt: t('input.userPrompt'),
    })).trim();
    if (text) return text;
    if (await askYesNo(t('input.emptySaveDraft'))) return undefined;
  }
}

export function askYesNo(question: string): Promise<boolean> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(resolve => {
    rl.question(question, answer => {
      rl.close();
      resolve(/^y(es)?$/i.test(answer.trim()));
    });
  });
}
