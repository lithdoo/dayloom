import { computed, createSignal, type ReadableSignal, type Signal } from 'bindtty';
import { hubMessageFor } from './hub/content.js';
import { phaseLabel, sessionKindLabel, sessionStatusLabel } from './theme.js';
import type { TuiRuntimeDriver } from './runtime-driver/index.js';
import type { TuiDriverState, TuiHubAction, TuiInputMode, TuiPage, TuiPresentationItem } from './types.js';

export interface ViewModel {
  worldRoot: string;
  driver: TuiRuntimeDriver;
  state: Signal<TuiDriverState>;
  page: ReadableSignal<TuiPage>;
  hubActions: ReadableSignal<readonly TuiHubAction[]>;
  selectedHubActionId: ReadableSignal<string | null>;
  visibleMessages: ReadableSignal<readonly TuiPresentationItem[]>;
  headerPrimary: ReadableSignal<string>;
  headerSecondary: ReadableSignal<string>;
  loadingLabel: ReadableSignal<string | null>;
  /** 当前 Session 是否接受普通自然语言输入。 */
  inputEnabled: ReadableSignal<boolean>;
  /** Textarea 是否可用于输入，包括高优先级 cancel 指令。 */
  inputControlEnabled: ReadableSignal<boolean>;
  inputMode: Signal<TuiInputMode>;
  inputValue: Signal<string>;
  inputInstruction: Signal<string>;
  inputPrompt: Signal<string>;
  inputHint: ReadableSignal<string>;
  inputResetToken: Signal<number>;
  viewportWidth: Signal<number>;
  listHeight: Signal<number>;
  messageScrollOffset: Signal<number>;
  stickToBottom: Signal<boolean>;
  inputViewportRows: Signal<number>;
  submitHubSelection(actionId?: string): Promise<void>;
  moveHubSelection(delta: number): void;
  selectHubAction(id: string): void;
  submitTextInput(): void;
  navigateInputHistory(delta: -1 | 1): void;
  setMessageScrollOffset(value: number): void;
  setStickToBottom(value: boolean): void;
  setInputViewportRows(rows: number): void;
  dispose(): Promise<void>;
}

export interface CreateViewModelOptions {
  onExitRequest?(): void | Promise<void>;
}

export function createViewModel(
  driver: TuiRuntimeDriver,
  options: CreateViewModelOptions = {},
): ViewModel {
  const state = createSignal(driver.getState());
  const inputMode = createSignal<TuiInputMode>('hidden');
  const inputValue = createSignal('');
  const inputInstruction = createSignal('输入消息，或输入 /submit 提交、/exit 取消。');
  const inputPrompt = createSignal('> ');
  const inputResetToken = createSignal(0);
  const viewportWidth = createSignal(80);
  const listHeight = createSignal(12);
  const messageScrollOffset = createSignal(0);
  const stickToBottom = createSignal(true);
  const inputViewportRows = createSignal(1);
  let disposed = false;
  let previousPageKey = pageKey(state.get().page);
  const inputHistory: string[] = [];
  let inputHistoryIndex = 0;
  let inputHistoryDraft = '';

  const unsubscribe = driver.subscribe((nextState) => {
    const nextPageKey = pageKey(nextState.page);
    state.set(nextState);
    inputMode.set(nextState.page.kind === 'session' ? 'text' : 'hidden');
    if (nextPageKey !== previousPageKey) {
      previousPageKey = nextPageKey;
      messageScrollOffset.set(0);
      stickToBottom.set(true);
    }
  });

  const loadingLabel = computed(() => {
    const current = state.get();
    if (current.page.kind === 'hub') return current.page.busy?.label ?? null;
    if (current.page.kind !== 'session') return null;
    if (current.session?.status === 'running') return 'AI 正在回复...';
    if (current.session?.status === 'cancelling') return '正在取消会话...';
    if (current.session?.status === 'submitting') return '正在提交会话...';
    return null;
  });
  const inputEnabled = computed(() => {
    const current = state.get();
    return current.page.kind === 'session' && current.sessionControls.input;
  });
  const inputControlEnabled = computed(() => {
    const current = state.get();
    if (current.page.kind !== 'session') return false;
    const controls = current.sessionControls;
    return controls.input || controls.submit || controls.cancel || controls.dismiss;
  });
  const inputHint = computed(() => {
    const current = state.get();
    if (current.page.kind !== 'session') return '';
    const status = current.session?.status;
    if (!status) return '';
    if (status === 'failed') return '/exit 或 /cancel 返回 Hub';
    if (status === 'submitting' || status === 'cancelling') return sessionStatusLabel(status);
    if (!inputEnabled.get()) return `${sessionStatusLabel(status)} · /exit 中断`;
    return '/submit 提交 · /exit 取消';
  });

  const vm: ViewModel = {
    worldRoot: driver.getState().world.worldRoot,
    driver,
    state,
    page: computed(() => state.get().page),
    hubActions: computed(() => state.get().hubActions),
    selectedHubActionId: computed(() => state.get().selectedHubActionId),
    visibleMessages: computed(() => {
      const current = state.get();
      if (current.page.kind === 'hub') {
        const text = hubMessageFor(current);
        return [{
          id: `hub:${current.page.mode}:${current.world.status}:${current.world.status === 'published' ? current.world.revision : '-'}`,
          role: 'system',
          text,
          status: 'complete',
        }];
      }
      return current.presentationItems;
    }),
    headerPrimary: computed(() => {
      return `World: ${state.get().world.worldRoot}`;
    }),
    headerSecondary: computed(() => {
      const current = state.get();
      const world = current.world;
      const phase = world.status === 'published' ? world.phase : world.status;
      const parts = [world.status === 'published' ? world.day : null, `${phaseLabel(phase)} (${phase})`];
      if (current.page.kind === 'session') {
        parts.push(
          sessionKindLabel(current.page.sessionKind),
          current.session ? sessionStatusLabel(current.session.status) : null,
        );
      }
      const loading = loadingLabel.get();
      if (loading) parts.push(loading);
      return parts.filter(Boolean).join(' · ');
    }),
    loadingLabel,
    inputEnabled,
    inputControlEnabled,
    inputMode,
    inputValue,
    inputInstruction,
    inputPrompt,
    inputHint,
    inputResetToken,
    viewportWidth,
    listHeight,
    messageScrollOffset,
    stickToBottom,
    inputViewportRows,
    async submitHubSelection(requestedActionId): Promise<void> {
      const actionId = requestedActionId ?? state.get().selectedHubActionId;
      if (!actionId) return;
      const result = await driver.runHubAction(actionId);
      if (result === 'exit') {
        await options.onExitRequest?.();
      }
    },
    moveHubSelection(delta): void {
      const actions = state.get().hubActions;
      if (actions.length === 0) return;
      const currentId = state.get().selectedHubActionId;
      const currentIndex = Math.max(0, actions.findIndex((action) => action.id === currentId));
      const nextIndex = Math.max(0, Math.min(actions.length - 1, currentIndex + delta));
      driver.selectHubAction(actions[nextIndex]!.id);
    },
    selectHubAction(id): void {
      driver.selectHubAction(id);
    },
    submitTextInput(): void {
      const text = inputValue.get();
      if (text.trim() !== '' && inputHistory.at(-1) !== text) {
        inputHistory.push(text);
        if (inputHistory.length > 100) inputHistory.shift();
      }
      inputHistoryIndex = inputHistory.length;
      inputHistoryDraft = '';
      inputValue.set('');
      inputResetToken.set(inputResetToken.get() + 1);
      void driver.submitSessionText(text);
    },
    navigateInputHistory(delta): void {
      if (inputHistory.length === 0) return;
      if (inputHistoryIndex === inputHistory.length && delta === -1) {
        inputHistoryDraft = inputValue.get();
      }
      inputHistoryIndex = Math.max(
        0,
        Math.min(inputHistory.length, inputHistoryIndex + delta),
      );
      inputValue.set(
        inputHistoryIndex === inputHistory.length
          ? inputHistoryDraft
          : inputHistory[inputHistoryIndex] ?? '',
      );
      inputResetToken.set(inputResetToken.get() + 1);
    },
    setMessageScrollOffset(value): void {
      messageScrollOffset.set(Math.max(0, Math.floor(value)));
      stickToBottom.set(false);
    },
    setStickToBottom(value): void {
      stickToBottom.set(value);
    },
    setInputViewportRows(rows): void {
      inputViewportRows.set(Math.max(1, Math.min(6, Math.floor(rows))));
    },
    async dispose(): Promise<void> {
      if (disposed) return;
      disposed = true;
      unsubscribe();
      await driver.dispose();
    },
  };

  return vm;
}

function pageKey(page: TuiPage): string {
  return page.kind === 'hub' ? `hub:${page.mode}` : `session:${page.sessionId}`;
}
