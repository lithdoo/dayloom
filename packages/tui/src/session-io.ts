import {
  InitCancelledError,
  createFilteredStreamOutput,
  type InputOptions,
  type SessionIO,
} from '@dayloom/core';
import type { ViewModel } from './view-model.js';

export function createTuiSessionIO(vm: ViewModel): SessionIO {
  const io: SessionIO = {
    write(text: string): void {
      vm.flushStream();
      vm.appendMessage('output', text);
      vm.refreshHeader();
    },
    warn(text: string): void {
      vm.flushStream();
      vm.appendMessage('warn', text);
    },
    error(text: string): void {
      vm.flushStream();
      vm.appendMessage('error', text);
    },
    createStreamWriter(options?: { hiddenBlocks?: string[] }) {
      return createFilteredStreamOutput({
        hiddenBlocks: options?.hiddenBlocks ?? [],
        write: (text) => vm.appendStream(text),
      });
    },
    async readInput(options: InputOptions): Promise<string | undefined> {
      while (true) {
        const text = await new Promise<string>((resolve) => {
          vm.beginInput(options, resolve);
        });
        const trimmed = text.trim();

        if (trimmed !== '') {
          vm.appendMessage('user', trimmed);
          vm.setStickToBottom(true);
          return trimmed;
        }

        switch (options.emptyBehavior) {
          case 'ask-exit':
            if (await io.confirm(vm.t('input.emptyExit'))) {
              throw new InitCancelledError();
            }
            break;
          case 'ask-save-draft':
            if (await io.confirm(vm.t('input.emptySaveDraft'))) {
              return undefined;
            }
            break;
          case 'ignore':
            return undefined;
        }
      }
    },
    confirm(question: string): Promise<boolean> {
      return new Promise((resolve) => {
        vm.beginConfirm(question, resolve);
      });
    },
    async withLoading<T>(
      label: string,
      task: (loading: { update(label: string): void }) => Promise<T> | T,
    ): Promise<T> {
      vm.loadingLabel.set(label);
      try {
        return await task({
          update(nextLabel: string): void {
            vm.loadingLabel.set(nextLabel);
          },
        });
      } finally {
        vm.loadingLabel.set(null);
        vm.flushStream();
        vm.refreshHeader();
      }
    },
  };

  return io;
}
