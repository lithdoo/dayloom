import {
  InitCancelledError,
  createFilteredStreamOutput,
  type InputOptions,
  type SessionIO,
} from '@dayloom/core';
import type { ViewModel } from './view-model.js';
import { getSessionCapability } from './session/capabilities.js';
import { guardSessionInput } from './session/command-guard.js';

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
      vm.setSessionState({ kind: 'streaming' });
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
          const page = vm.page.get();
          if (page.kind === 'session') {
            const blocked = guardSessionInput(trimmed, getSessionCapability(page.command), vm.t);
            if (blocked) {
              vm.appendMessage('warn', `${blocked}\n`);
              vm.setStickToBottom(true);
              continue;
            }
          }
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
      const page = vm.page.get();
      if (page.kind === 'session') {
        vm.setSessionState({ kind: 'loading', label });
      }
      vm.loadingLabel.set(label);
      try {
        return await task({
          update(nextLabel: string): void {
            const currentPage = vm.page.get();
            if (currentPage.kind === 'session') {
              vm.setSessionState({ kind: 'loading', label: nextLabel });
            }
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
