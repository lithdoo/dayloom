#!/usr/bin/env node
import { InitCancelledError, type RecommendedActionOptions } from '@dayloom/core-old';
import { parseArgv, formatHelp } from './argv.js';
import { mountApp } from './app.js';
import { createTuiSessionIO } from './session-io.js';
import { createViewModel } from './view-model.js';
import { runTuiShell } from './tui-shell.js';

async function main(): Promise<void> {
  const parsed = parseArgv(process.argv);
  if (parsed.help) {
    process.stdout.write(`${formatHelp()}\n`);
    return;
  }

  const vm = createViewModel({
    worldDir: parsed.worldDir,
    locale: parsed.locale,
  });
  let mounted: ReturnType<typeof mountApp> | null = null;
  const io = createTuiSessionIO(vm);

  mounted = mountApp(vm, {
    onExitRequest(): void {
      mounted?.dispose();
      mounted = null;
      process.exit(0);
    },
  });

  const onSigInt = (): void => {
    mounted?.dispose();
    mounted = null;
    process.exit(0);
  };
  process.on('SIGINT', onSigInt);

  try {
    await runTuiShell({
      worldDir: parsed.worldDir,
      vm,
      t: vm.t,
      actionOpts: {
        io,
        t: vm.t,
        ...parsed.shellOptions,
      } satisfies RecommendedActionOptions,
    });
  } catch (err) {
    // Keep failures inside the TUI message list — never write to stderr while
    // the alt-screen session may still be active.
    if (err instanceof InitCancelledError) {
      io.error(`${err.message}\n`);
    } else {
      io.error(`${err instanceof Error ? err.stack ?? err.message : String(err)}\n`);
      process.exitCode = 1;
    }
  } finally {
    process.off('SIGINT', onSigInt);
    mounted?.dispose();
    mounted = null;
  }
}

main().catch((err: unknown) => {
  // Bootstrap-only path (argv / mount failures before or without a live TUI).
  process.stderr.write(`${err instanceof Error ? err.stack ?? err.message : String(err)}\n`);
  process.exitCode = 1;
});
