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
import { STREAM_THROTTLE_MS } from './components/constants.js';
import {
  appendTuiMessage,
  type TuiMessage,
  type TuiMessageRole,
} from './message-history.js';
import {
  formatHubHelp,
  formatHubStatus,
  resolveHubHelp,
  resolveHubStatus,
} from './hub/content.js';
import { resolveHubActions } from './hub/actions.js';
import type {
  HubAction,
  HubActionId,
  HubHelpContent,
  HubMode,
  HubRecentSummary,
  HubStatusContent,
  TuiPage,
} from './hub/types.js';
import type { SessionCommand, SessionState } from './session/types.js';

export type TuiInputMode = 'hidden' | 'text' | 'confirm';
export type { TuiMessage, TuiMessageRole } from './message-history.js';

export interface ViewModel {
  worldDir: string;
  t: Translator;

  page: Signal<TuiPage>;
  hubActions: Signal<readonly HubAction[]>;
  hubSelectedActionId: Signal<HubActionId>;
  hubStatus: Signal<HubStatusContent>;
  hubHelp: Signal<HubHelpContent>;
  recentSession: Signal<HubRecentSummary | undefined>;

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

  viewportWidth: Signal<number>;
  listHeight: Signal<number>;
  messageScrollOffset: Signal<number>;
  stickToBottom: Signal<boolean>;
  inputViewportRows: Signal<number>;
  inputResetToken: Signal<number>;

  appendMessage(role: TuiMessageRole, text: string): void;
  appendStream(chunk: string): void;
  flushStream(): void;
  refreshHeader(): void;
  refreshHub(): void;
  setHubMode(mode: HubMode): void;
  setHubBusy(label: string | null): void;
  setSessionPage(command: SessionCommand, state?: SessionState): void;
  setSessionState(state: SessionState): void;
  setRecentSession(summary: HubRecentSummary | undefined): void;

  beginInput(options: InputOptions, resolve: (value: string) => void): void;
  beginConfirm(question: string, resolve: (value: boolean) => void): void;
  beginHubSelection(resolve: (action: HubAction) => void): void;
  clearInput(): void;
  submitTextInput(): void;
  submitConfirm(answer: boolean): void;
  submitHubSelection(): void;
  moveHubSelection(delta: number): void;
  selectHubAction(id: HubActionId): void;

  setStickToBottom(value: boolean): void;
  setMessageScrollOffset(value: number): void;
  setInputViewportRows(rows: number): void;
}

export interface CreateViewModelOptions {
  worldDir: string;
  locale?: string;
}

export function createViewModel(options: CreateViewModelOptions): ViewModel {
  const locale = normalizeLocale(options.locale);
  const t = createTranslator(locale);
  const initialHubHelp = resolveHubHelp(t);
  const page = createSignal<TuiPage>({ kind: 'hub', mode: 'status' });
  const hubActions = createSignal<readonly HubAction[]>([]);
  const hubSelectedActionId = createSignal<HubActionId>('next');
  const hubStatus = createSignal<HubStatusContent>({
    worldRoot: options.worldDir,
    initialized: false,
    nextLabel: '',
    nextSummary: '',
    actions: [],
  });
  const hubHelp = createSignal<HubHelpContent>(initialHubHelp);
  const recentSession = createSignal<HubRecentSummary | undefined>(undefined);
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
  const viewportWidth = createSignal(80);
  const listHeight = createSignal(12);
  const messageScrollOffset = createSignal(0);
  const stickToBottom = createSignal(true);
  const inputViewportRows = createSignal(1);
  const inputResetToken = createSignal(0);
  let messageId = 0;
  let pendingInput: ((value: string) => void) | null = null;
  let pendingConfirm: ((value: boolean) => void) | null = null;
  let pendingHubSelection: ((action: HubAction) => void) | null = null;
  let pendingStream = '';
  let streamTimer: ReturnType<typeof setTimeout> | null = null;

  function publishPendingStream(): void {
    if (pendingStream === '') return;
    const next = pendingStream;
    pendingStream = '';
    streamBuffer.set(streamBuffer.get() + next);
    stickToBottom.set(true);
  }

  function clearStreamTimer(): void {
    if (streamTimer === null) return;
    clearTimeout(streamTimer);
    streamTimer = null;
  }

  function createHubMessages(): readonly TuiMessage[] {
    const currentPage = page.get();
    const text = currentPage.kind === 'hub' && currentPage.mode === 'help'
      ? formatHubHelp(hubHelp.get())
      : formatHubStatus(hubStatus.get(), t);
    const loading = currentPage.kind === 'hub' && currentPage.busy
      ? `\n\n${currentPage.busy.label}`
      : '';
    return [
      {
        id: currentPage.kind === 'hub' ? `hub-${currentPage.mode}` : 'hub-status',
        role: 'system',
        text: `${text}${loading}`,
        ts: Date.now(),
      },
    ];
  }

  function selectedHubAction(): HubAction | undefined {
    const actions = hubActions.get();
    return actions.find((action) => action.id === hubSelectedActionId.get()) ?? actions[0];
  }

  function normalizeHubSelection(actions: readonly HubAction[]): void {
    if (actions.length === 0) return;
    const current = hubSelectedActionId.get();
    if (actions.some((action) => action.id === current)) return;
    const recommended = actions.find((action) => action.recommended);
    hubSelectedActionId.set((recommended ?? actions[0]!).id);
  }

  const vm: ViewModel = {
    worldDir: options.worldDir,
    t,
    page,
    hubActions,
    hubSelectedActionId,
    hubStatus,
    hubHelp,
    recentSession,
    messages,
    visibleMessages: computed(() => {
      if (page.get().kind === 'hub') {
        return createHubMessages();
      }
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
    viewportWidth,
    listHeight,
    messageScrollOffset,
    stickToBottom,
    inputViewportRows,
    inputResetToken,
    appendMessage(role, text): void {
      const current = messages.get();
      const next = appendTuiMessage(current, role, text, {
        now: Date.now(),
        nextId: () => String(++messageId),
      });
      if (next !== current) {
        messages.set(next);
      }
    },
    appendStream(chunk): void {
      if (chunk === '') return;
      pendingStream += chunk;
      // Leading edge: show the first chunk immediately, then coalesce for ~50ms.
      if (streamTimer !== null) return;
      publishPendingStream();
      streamTimer = setTimeout(() => {
        streamTimer = null;
        publishPendingStream();
      }, STREAM_THROTTLE_MS);
    },
    flushStream(): void {
      clearStreamTimer();
      publishPendingStream();
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
    refreshHub(): void {
      const resolved = resolveHubActions({ worldDir: options.worldDir, t });
      hubActions.set(resolved.actions);
      normalizeHubSelection(resolved.actions);
      hubStatus.set(resolveHubStatus({
        worldDir: options.worldDir,
        t,
        recent: recentSession.get(),
        resolved,
      }));
      hubHelp.set(resolveHubHelp(t));
      vm.refreshHeader();
      stickToBottom.set(true);
    },
    setHubMode(mode): void {
      const current = page.get();
      page.set({ kind: 'hub', mode, busy: current.kind === 'hub' ? current.busy : undefined });
      stickToBottom.set(true);
    },
    setHubBusy(label): void {
      const current = page.get();
      const mode = current.kind === 'hub' ? current.mode : 'status';
      page.set(label ? { kind: 'hub', mode: 'status', busy: { kind: 'settling', label } } : { kind: 'hub', mode });
      inputMode.set('hidden');
      stickToBottom.set(true);
    },
    setSessionPage(command, state = { kind: 'starting' }): void {
      page.set({ kind: 'session', command, state });
      stickToBottom.set(true);
    },
    setSessionState(state): void {
      const current = page.get();
      if (current.kind !== 'session') return;
      page.set({ ...current, state });
    },
    setRecentSession(summary): void {
      recentSession.set(summary);
    },
    beginInput(inputOptions, resolve): void {
      assertNoPending(pendingInput, pendingConfirm);
      pendingInput = resolve;
      const current = page.get();
      if (current.kind === 'session') {
        page.set({ ...current, state: { kind: 'waiting-input' } });
      }
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
      const current = page.get();
      if (current.kind === 'session') {
        page.set({ ...current, state: { kind: 'waiting-confirm' } });
      }
      confirmQuestion.set(question);
      inputValue.set('');
      inputMode.set('confirm');
    },
    beginHubSelection(resolve): void {
      pendingHubSelection = resolve;
      vm.refreshHub();
      const current = page.get();
      page.set({ kind: 'hub', mode: current.kind === 'hub' ? current.mode : 'status' });
      inputMode.set('hidden');
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
      vm.clearInput();
      resolve(value);
    },
    submitConfirm(answer): void {
      const resolve = pendingConfirm;
      if (!resolve) return;
      pendingConfirm = null;
      vm.clearInput();
      resolve(answer);
    },
    submitHubSelection(): void {
      const resolve = pendingHubSelection;
      const action = selectedHubAction();
      if (!resolve || !action) return;
      pendingHubSelection = null;
      resolve(action);
    },
    moveHubSelection(delta): void {
      const actions = hubActions.get();
      if (actions.length === 0) return;
      const currentIndex = Math.max(0, actions.findIndex((action) => action.id === hubSelectedActionId.get()));
      const nextIndex = Math.max(0, Math.min(actions.length - 1, currentIndex + delta));
      hubSelectedActionId.set(actions[nextIndex]!.id);
    },
    selectHubAction(id): void {
      if (hubActions.get().some((action) => action.id === id)) {
        hubSelectedActionId.set(id);
      }
    },
    setStickToBottom(value): void {
      stickToBottom.set(value);
    },
    setMessageScrollOffset(value): void {
      messageScrollOffset.set(Math.max(0, Math.floor(value)));
    },
    setInputViewportRows(rows): void {
      inputViewportRows.set(Math.max(1, Math.min(6, Math.floor(rows))));
    },
  };

  vm.refreshHeader();
  vm.refreshHub();
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
