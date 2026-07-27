import { computed, createApp, type BindTTYApp } from 'bindtty';
import { createNodeTerminal, type TerminalKeyEvent } from '@bindtty/terminal';
import type { ViewModel } from './view-model.js';
import { CHROME_ROWS, HUB_SELECT_ID, TEXTAREA_ID } from './components/constants.js';
import { Footer, Header, HubSelect, LoadingBar, MessageList, TextInputArea } from './components/index.js';

export interface MountedTuiApp {
  dispose(): void;
}

export interface MountAppOptions {
  onExitRequest?(): void;
}

export function isCtrlC(event: TerminalKeyEvent): boolean {
  return event.kind === 'key' && event.modifiers.ctrl && event.key === 'c';
}

export function mountApp(vm: ViewModel, options: MountAppOptions = {}): MountedTuiApp {
  const terminal = createNodeTerminal({
    stdout: process.stdout,
    stdin: process.stdin,
    useAltScreen: true,
    hideCursor: true,
    rawMode: true,
    exitOnCtrlC: false,
    keyboardProtocol: 'auto',
  });

  function syncLayout(): void {
    vm.viewportWidth.set(terminal.viewport.width);
    vm.listHeight.set(Math.max(3, terminal.viewport.height - CHROME_ROWS - vm.inputViewportRows.get()));
  }

  syncLayout();
  const originalSetInputViewportRows = vm.setInputViewportRows.bind(vm);
  vm.setInputViewportRows = (rows: number) => {
    originalSetInputViewportRows(rows);
    syncLayout();
  };

  const unsubscribeResize = terminal.onResize(syncLayout);
  const unsubscribeExitKey = terminal.onKey((event) => {
    if (isCtrlC(event)) options.onExitRequest?.();
  });

  const showHubSelect = computed(() => {
    const page = vm.page.get();
    return page.kind === 'hub' && !page.busy;
  });
  const showSessionInput = computed(() => vm.page.get().kind === 'session');

  const app = createApp(
    <screen gap={0} alignItems="stretch">
      <Header vm={vm} />
      <MessageList vm={vm} />
      <LoadingBar vm={vm} />
      <show when={showHubSelect}>
        <HubSelect vm={vm} />
      </show>
      <show when={showSessionInput}>
        <TextInputArea vm={vm} />
      </show>
      <Footer vm={vm} />
    </screen>,
    { terminal },
  );

  app.start();
  const unsubscribeInputFocus = mountAutofocus(vm, app);

  return {
    dispose(): void {
      unsubscribeInputFocus();
      unsubscribeResize();
      unsubscribeExitKey();
      app.dispose();
    },
  };
}

export function mountAutofocus(
  vm: ViewModel,
  app: Pick<BindTTYApp, 'focus'>,
  schedule: (callback: () => void) => void = queueMicrotask,
): () => void {
  let disposed = false;
  let ticket = 0;

  function scheduleFocus(): void {
    const currentTicket = ++ticket;
    schedule(() => {
      if (disposed || currentTicket !== ticket) return;
      const page = vm.page.get();
      if (page.kind === 'session') {
        app.focus(TEXTAREA_ID);
      } else if (!page.busy) {
        app.focus(HUB_SELECT_ID);
      }
    });
  }

  const unsubscribePage = vm.page.subscribe(scheduleFocus);
  const unsubscribeInput = vm.inputMode.subscribe(scheduleFocus);
  scheduleFocus();

  return () => {
    disposed = true;
    ticket += 1;
    unsubscribePage();
    unsubscribeInput();
  };
}
