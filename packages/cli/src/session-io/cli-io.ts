import {
  InitCancelledError,
  createFilteredStreamOutput,
  createTranslator,
  type InputOptions,
  type SessionIO,
} from '@dayloom/core';
import { askYesNo } from './ask-yes-no';
import { withLoading } from './loading-spinner';
import { readTerminalInput } from './terminal-input';

export function createCliSessionIO(): SessionIO {
  const t = createTranslator();

  return {
    write(text: string): void {
      process.stdout.write(text);
    },
    warn(text: string): void {
      process.stderr.write(text);
    },
    error(text: string): void {
      process.stderr.write(text);
    },
    createStreamWriter(options?: { hiddenBlocks?: string[] }): ReturnType<SessionIO['createStreamWriter']> {
      return createFilteredStreamOutput({
        hiddenBlocks: options?.hiddenBlocks ?? [],
        write: (text: string) => process.stdout.write(text),
      });
    },
    async readInput(options: InputOptions): Promise<string | undefined> {
      while (true) {
        const text = (await readTerminalInput({
          commandHint: options.commandHint,
          instruction: options.instruction,
          userPrompt: options.userPrompt,
        })).trim();

        if (text) return text;

        switch (options.emptyBehavior) {
          case 'ask-exit':
            if (await askYesNo(t('input.emptyExit'))) {
              throw new InitCancelledError();
            }
            break;
          case 'ask-save-draft':
            if (await askYesNo(t('input.emptySaveDraft'))) return undefined;
            break;
          case 'ignore':
            return undefined;
          default:
            return undefined;
        }
      }
    },
    confirm(question: string): Promise<boolean> {
      if (!process.stdin.isTTY || !process.stdout.isTTY) return Promise.resolve(false);
      return askYesNo(question);
    },
    withLoading<T>(
      label: string,
      task: (loading: { update(label: string): void }) => Promise<T> | T,
    ): Promise<T> {
      return withLoading(label, task);
    },
  };
}
