import { createApp } from 'bindtty';
import { createNodeTerminal, RawStdinInput } from '@bindtty/terminal';
import type { ViewModel } from './view-model.js';
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
  const unsubscribeExitKey = terminal.onKey((event) => {
    if (event.ctrl && event.name === 'c') {
      options.onExitRequest?.();
    }
  });

  const app = createApp(
    <screen>
      <vstack>
        <Header vm={vm} />
        <MessageList vm={vm} />
        <LoadingBar vm={vm} />
        <TextInputArea vm={vm} />
        <Footer vm={vm} />
      </vstack>
    </screen>,
    { terminal },
  );

  app.start();

  return {
    dispose(): void {
      unsubscribeExitKey();
      app.dispose();
    },
  };
}
