#!/usr/bin/env node
import { InitCancelledError, runGameShell } from '@dayloom/core';
import { parseArgv, formatHelp } from './argv.js';
import { mountApp } from './app.js';
import { createTuiSessionIO } from './session-io.js';
import { createViewModel } from './view-model.js';

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
  mounted = mountApp(vm, {
    onExitRequest(): void {
      mounted?.dispose();
      process.exit(0);
    },
  });
  const io = createTuiSessionIO(vm);

  try {
    await runGameShell({
      worldDir: parsed.worldDir,
      io,
      t: vm.t,
      autoStart: parsed.autoStart,
      ...parsed.shellOptions,
    });
  } catch (err) {
    if (err instanceof InitCancelledError) {
      io.error(`${err.message}\n`);
    } else {
      io.error(`${err instanceof Error ? err.stack ?? err.message : String(err)}\n`);
      process.exitCode = 1;
    }
  } finally {
    mounted.dispose();
  }
}

main().catch((err: unknown) => {
  process.stderr.write(`${err instanceof Error ? err.stack ?? err.message : String(err)}\n`);
  process.exitCode = 1;
});
