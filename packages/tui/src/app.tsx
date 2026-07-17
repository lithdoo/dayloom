import { createApp, type BindTTYApp } from 'bindtty';
import { createNodeTerminal, RawStdinInput, type TerminalKeyEvent } from '@bindtty/terminal';
import type { TuiInputMode, ViewModel } from './view-model.js';
import { CHROME_ROWS, CONFIRM_ID, TEXTAREA_ID } from './components/constants.js';
import { Header } from './components/header.js';
import { MessageList } from './components/message-list.js';
import { LoadingBar } from './components/loading-bar.js';
import { TextInputArea } from './components/text-input.js';
import { Footer } from './components/footer.js';

export interface MountedTuiApp {
  dispose(): void;
}

export interface MountAppOptions {
  onExitRequest?(): void;
}

export function isCtrlC(event: TerminalKeyEvent): boolean {
  return Boolean(
    event.ctrl &&
      (event.name === 'c' || event.input === '\x03' || event.input === 'c'),
  );
}

type FocusableInputMode = 'text' | 'confirm';

function focusTargetForInputMode(mode: TuiInputMode): string | null {
  if (mode === 'text') return TEXTAREA_ID;
  if (mode === 'confirm') return CONFIRM_ID;
  return null;
}

export function mountInputAutofocus(
  vm: ViewModel,
  app: Pick<BindTTYApp, 'focus'>,
  schedule: (callback: () => void) => void = queueMicrotask,
): () => void {
  let disposed = false;
  let pendingTicket = 0;

  function scheduleFocus(mode: FocusableInputMode): void {
    const ticket = ++pendingTicket;
    schedule(() => {
      if (disposed || ticket !== pendingTicket || vm.inputMode.get() !== mode) return;
      app.focus(focusTargetForInputMode(mode) ?? '');
    });
  }

  const unsubscribe = vm.inputMode.subscribe((mode, previousMode) => {
    if (mode === previousMode) return;
    if (mode === 'text' || mode === 'confirm') {
      scheduleFocus(mode);
    }
  });

  const initialMode = vm.inputMode.get();
  if (initialMode === 'text' || initialMode === 'confirm') {
    scheduleFocus(initialMode);
  }

  return () => {
    disposed = true;
    pendingTicket += 1;
    unsubscribe();
  };
}

export function mountApp(vm: ViewModel, options: MountAppOptions = {}): MountedTuiApp {
  const terminal = createNodeTerminal({
    stdout: process.stdout,
    stdin: process.stdin,
    useAltScreen: true,
    hideCursor: true,
    rawMode: true,
    exitOnCtrlC: false,
    enhancedKeyboard: true,
    stdinInputAdapter: new RawStdinInput(),
  });

  function syncLayout(): void {
    vm.viewportWidth.set(terminal.viewport.width);
    vm.listHeight.set(
      Math.max(3, terminal.viewport.height - CHROME_ROWS - vm.inputViewportRows.get()),
    );
  }

  syncLayout();

  const originalSetInputViewportRows = vm.setInputViewportRows.bind(vm);
  vm.setInputViewportRows = (rows: number) => {
    originalSetInputViewportRows(rows);
    syncLayout();
  };

  const unsubscribeResize = terminal.onResize(syncLayout);
  const unsubscribeExitKey = terminal.onKey((event) => {
    if (isCtrlC(event)) {
      options.onExitRequest?.();
    }
  });

  const app = createApp(
    <screen gap={0} alignItems="stretch">
      <Header vm={vm} />
      <MessageList vm={vm} />
      <LoadingBar vm={vm} />
      <TextInputArea vm={vm} />
      <Footer vm={vm} />
    </screen>,
    { terminal },
  );

  app.start();
  const unsubscribeInputAutofocus = mountInputAutofocus(vm, app);

  return {
    dispose(): void {
      unsubscribeInputAutofocus();
      unsubscribeResize();
      unsubscribeExitKey();
      app.dispose();
    },
  };
}
