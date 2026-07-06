export interface InputOptions {
  commandHint?: string;
  instruction: string;
  userPrompt: string;
  /**
   * init:         'ask-exit'        — empty input asks whether to exit
   * daily/revise: 'ask-save-draft' — empty input asks whether to save draft
   * play/shell:   'ignore'          — empty input continues waiting
   */
  emptyBehavior: 'ask-exit' | 'ask-save-draft' | 'ignore';
}

export interface StreamWriter {
  push(chunk: string): void;
  flush(): void;
}

export interface SessionIO {
  write(text: string): void;
  warn(text: string): void;
  error(text: string): void;
  createStreamWriter(options?: { hiddenBlocks?: string[] }): StreamWriter;
  readInput(options: InputOptions): Promise<string | undefined>;
  confirm(question: string): Promise<boolean>;
  withLoading<T>(
    label: string,
    task: (loading: { update(label: string): void }) => Promise<T> | T
  ): Promise<T>;
}

export type ShellCommand = 'revise' | 'next' | 'quit';

export type SessionExit<TResult = unknown> =
  | { kind: 'completed'; result?: TResult }
  | { kind: 'saved'; sessionPath?: string }
  | { kind: 'cancelled' }
  | { kind: 'shell-command'; command: ShellCommand; raw: string };

export interface InitResult {
  worldRoot: string;
}
