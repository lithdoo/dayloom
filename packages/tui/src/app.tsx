import { computed, createApp, type AppError, type BindTTYApp } from 'bindtty';
import {
  createNodeTerminal,
  type DiagnosticLogger,
  type TerminalKeyEvent,
  type TerminalViewport,
} from '@bindtty/terminal';
import type { ViewModel } from './view-model.js';
import { CHROME_ROWS, HUB_SELECT_ID, TEXTAREA_ID } from './components/constants.js';
import { Footer, Header, HubSelect, LoadingBar, MessageList, TextInputArea } from './components/index.js';

export interface MountedTuiApp {
  dispose(): void;
}

export interface MountAppOptions {
  onExitRequest?(): void;
  onError?(error: AppError): void;
  diagnostic?: DiagnosticLogger;
}

export function isCtrlC(event: TerminalKeyEvent): boolean {
  return event.kind === 'key' && event.modifiers.ctrl && event.key === 'c';
}

export function mountApp(vm: ViewModel, options: MountAppOptions = {}): MountedTuiApp {
  const diagnostic = options.diagnostic;
  const terminal = createNodeTerminal({
    stdout: process.stdout,
    stdin: process.stdin,
    useAltScreen: true,
    hideCursor: true,
    rawMode: true,
    exitOnCtrlC: false,
    keyboardProtocol: 'auto',
  });

  function syncLayout(viewport: TerminalViewport = terminal.viewport): void {
    vm.viewportWidth.set(viewport.width);
    const inputRows = vm.inputViewportRows.get();
    const listHeight = Math.max(3, viewport.height - CHROME_ROWS - inputRows);
    vm.listHeight.set(listHeight);
    if (diagnostic?.enabled) {
      diagnostic.log('layout-viewport-sync', {
        width: viewport.width,
        height: viewport.height,
        chromeRows: CHROME_ROWS,
        inputRows,
        listHeight,
        page: vm.page.get().kind,
      });
    }
  }

  const originalSetInputViewportRows = vm.setInputViewportRows.bind(vm);
  vm.setInputViewportRows = (rows: number) => {
    originalSetInputViewportRows(rows);
    syncLayout();
  };

  const unsubscribeExitKey = terminal.onKey((event) => {
    if (isCtrlC(event)) {
      diagnostic?.log('exit-key');
      options.onExitRequest?.();
    }
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
    {
      terminal,
      onViewportChange: syncLayout,
      onError(error) {
        diagnostic?.error('bindtty-error', error.error, {
          phase: error.phase,
          width: error.viewport.width,
          height: error.viewport.height,
          intentKind: error.intent.kind,
          intentReasons: error.intent.reasons,
          revision: error.revision,
          schedulerState: error.schedulerState,
          recoverable: error.recoverable,
        });
        options.onError?.(error);
      },
    },
  );

  diagnostic?.log('mount-start', {
    width: terminal.viewport.width,
    height: terminal.viewport.height,
  });
  app.start();
  const unsubscribeInputFocus = mountAutofocus(vm, app);

  return {
    dispose(): void {
      diagnostic?.log('mount-dispose', {
        width: terminal.viewport.width,
        height: terminal.viewport.height,
      });
      unsubscribeInputFocus();
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
