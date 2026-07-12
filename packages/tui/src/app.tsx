import { createApp } from 'bindtty';
import { createNodeTerminal, RawStdinInput, type TerminalKeyEvent } from '@bindtty/terminal';
import type { ViewModel } from './view-model.js';
import { CHROME_ROWS } from './components/constants.js';
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

  return {
    dispose(): void {
      unsubscribeResize();
      unsubscribeExitKey();
      app.dispose();
    },
  };
}
