import {
  createSignal,
  computed,
  type ReadableSignal,
  type Signal,
} from 'bindtty';
import {
  createTranslator,
  inspectTuiHeader,
  normalizeLocale,
  type InputOptions,
  type Translator,
} from '@dayloom/core';

export type TuiInputMode = 'hidden' | 'text' | 'confirm';
export type TuiMessageRole = 'output' | 'warn' | 'error' | 'system';

export interface TuiMessage {
  id: string;
  role: TuiMessageRole;
  text: string;
  ts: number;
}

export interface ViewModel {
  worldDir: string;
  t: Translator;

  messages: Signal<readonly TuiMessage[]>;
  visibleMessages: ReadableSignal<readonly TuiMessage[]>;
  streamBuffer: Signal<string>;
  loadingLabel: Signal<string | null>;

  inputMode: Signal<TuiInputMode>;
  inputInstruction: Signal<string>;
  inputPrompt: Signal<string>;
  inputHint: Signal<string>;
  inputValue: Signal<string>;
  confirmQuestion: Signal<string>;

  headerPrimary: Signal<string>;
  headerSecondary: Signal<string>;
  headerActions: Signal<readonly string[]>;

  listHeight: Signal<number>;
  stickToBottom: Signal<boolean>;
  inputViewportRows: Signal<number>;
  inputResetToken: Signal<number>;

  appendMessage(role: TuiMessageRole, text: string): void;
  appendStream(chunk: string): void;
  flushStream(): void;
  refreshHeader(): void;

  beginInput(options: InputOptions, resolve: (value: string) => void): void;
  beginConfirm(question: string, resolve: (value: boolean) => void): void;
  clearInput(): void;
  submitTextInput(): void;
  submitConfirm(answer: boolean): void;

  setStickToBottom(value: boolean): void;
  setInputViewportRows(rows: number): void;
}

export interface CreateViewModelOptions {
  worldDir: string;
  locale?: string;
}

export function createViewModel(options: CreateViewModelOptions): ViewModel {
  const t = createTranslator(normalizeLocale(options.locale));
  const messages = createSignal<readonly TuiMessage[]>([]);
  const streamBuffer = createSignal('');
  const loadingLabel = createSignal<string | null>(null);
  const inputMode = createSignal<TuiInputMode>('hidden');
  const inputInstruction = createSignal('');
  const inputPrompt = createSignal('>');
  const inputHint = createSignal('');
  const inputValue = createSignal('');
  const confirmQuestion = createSignal('');
  const headerPrimary = createSignal('');
  const headerSecondary = createSignal('');
  const headerActions = createSignal<readonly string[]>([]);
  const listHeight = createSignal(12);
  const stickToBottom = createSignal(true);
  const inputViewportRows = createSignal(1);
  const inputResetToken = createSignal(0);
  let messageId = 0;
  let pendingInput: ((value: string) => void) | null = null;
  let pendingConfirm: ((value: boolean) => void) | null = null;

  const vm: ViewModel = {
    worldDir: options.worldDir,
    t,
    messages,
    visibleMessages: computed(() => {
      const stream = streamBuffer.get();
      if (stream === '') return messages.get();
      return [
        ...messages.get(),
        {
          id: 'stream',
          role: 'output' as const,
          text: stream,
          ts: Date.now(),
        },
      ];
    }),
    streamBuffer,
    loadingLabel,
    inputMode,
    inputInstruction,
    inputPrompt,
    inputHint,
    inputValue,
    confirmQuestion,
    headerPrimary,
    headerSecondary,
    headerActions,
    listHeight,
    stickToBottom,
    inputViewportRows,
    inputResetToken,
    appendMessage(role, text): void {
      if (text === '') return;
      const normalized = text.endsWith('\n') ? text.slice(0, -1) : text;
      messages.set([
        ...messages.get(),
        {
          id: String(++messageId),
          role,
          text: normalized,
          ts: Date.now(),
        },
      ]);
    },
    appendStream(chunk): void {
      if (chunk === '') return;
      streamBuffer.set(streamBuffer.get() + chunk);
    },
    flushStream(): void {
      const text = streamBuffer.get();
      if (text === '') return;
      streamBuffer.set('');
      vm.appendMessage('output', text);
    },
    refreshHeader(): void {
      try {
        const snapshot = inspectTuiHeader(options.worldDir);
        const phase = snapshot.phase ? ` · ${snapshot.phase}` : '';
        headerPrimary.set(`World: ${snapshot.worldRoot}${phase}`);
        headerSecondary.set(
          [snapshot.day, snapshot.eventTitle].filter(Boolean).join(' · '),
        );
        headerActions.set(snapshot.suggestedActions);
      } catch (err) {
        headerPrimary.set(`World: ${options.worldDir}`);
        headerSecondary.set(err instanceof Error ? err.message : '');
        headerActions.set([]);
      }
    },
    beginInput(inputOptions, resolve): void {
      assertNoPending(pendingInput, pendingConfirm);
      pendingInput = resolve;
      inputInstruction.set(inputOptions.instruction);
      inputPrompt.set(inputOptions.userPrompt);
      inputHint.set(inputOptions.commandHint ?? '');
      inputValue.set('');
      inputResetToken.set(inputResetToken.get() + 1);
      inputMode.set('text');
    },
    beginConfirm(question, resolve): void {
      assertNoPending(pendingInput, pendingConfirm);
      pendingConfirm = resolve;
      confirmQuestion.set(question);
      inputValue.set('');
      inputMode.set('confirm');
    },
    clearInput(): void {
      inputMode.set('hidden');
      inputInstruction.set('');
      inputPrompt.set('>');
      inputHint.set('');
      inputValue.set('');
      confirmQuestion.set('');
    },
    submitTextInput(): void {
      const resolve = pendingInput;
      if (!resolve) return;
      pendingInput = null;
      const value = inputValue.get();
      inputValue.set('');
      inputResetToken.set(inputResetToken.get() + 1);
      resolve(value);
    },
    submitConfirm(answer): void {
      const resolve = pendingConfirm;
      if (!resolve) return;
      pendingConfirm = null;
      vm.clearInput();
      resolve(answer);
    },
    setStickToBottom(value): void {
      stickToBottom.set(value);
    },
    setInputViewportRows(rows): void {
      inputViewportRows.set(Math.max(1, Math.min(6, Math.floor(rows))));
    },
  };

  vm.refreshHeader();
  return vm;
}

function assertNoPending(
  pendingInput: unknown,
  pendingConfirm: unknown,
): void {
  if (pendingInput || pendingConfirm) {
    throw new Error('TUI input request already pending.');
  }
}
