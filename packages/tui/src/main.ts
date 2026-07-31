#!/usr/bin/env node
import path from 'node:path';
import { createDiagnosticLogger } from '@bindtty/terminal';
import { parseArgv, usage } from './argv.js';
import { mountApp } from './app.js';
import { createRuntimeDriver } from './runtime-driver/index.js';
import { createViewModel } from './view-model.js';

async function main(): Promise<void> {
  const diagnostic = createDiagnosticLogger('dayloom-tui', {
    path: process.env.DAYLOOM_DIAGNOSTIC_LOG_FILE ?? false,
    runId:
      process.env.DAYLOOM_DIAGNOSTIC_RUN_ID ??
      process.env.BINDTTY_DIAGNOSTIC_RUN_ID,
  });
  if (diagnostic.enabled) {
    process.on('uncaughtExceptionMonitor', (error, origin) => {
      diagnostic.error('process-uncaught-exception', error, { origin });
      diagnostic.flush();
    });
    process.on('unhandledRejection', (reason) => {
      diagnostic.error('process-unhandled-rejection', reason);
      diagnostic.flush();
    });
  }
  try {
    const parsed = parseArgv(process.argv);
    if (parsed.help) {
      process.stdout.write(`${usage()}\n`);
      return;
    }
    const worldRoot = path.resolve(parsed.worldRoot);
    diagnostic.log('process-start', {
      worldRoot,
      platform: process.platform,
      nodeVersion: process.version,
      terminalProgram: process.env.TERM_PROGRAM,
      windowsTerminal: process.env.WT_SESSION !== undefined,
      stdinIsTTY: process.stdin.isTTY === true,
      stdoutIsTTY: process.stdout.isTTY === true,
    });
    const driver = await createRuntimeDriver({ worldRoot, diagnostic });
    let mounted: ReturnType<typeof mountApp> | null = null;
    let shutdownPromise: Promise<void> | null = null;
    const shutdown = (): Promise<void> => {
      if (shutdownPromise) return shutdownPromise;
      mounted?.dispose();
      mounted = null;
      shutdownPromise = vm.dispose().finally(() => {
        diagnostic.log('process-stop');
        diagnostic.dispose();
      });
      return shutdownPromise;
    };
    const exitAfterShutdown = (): void => {
      void shutdown().then(
        () => process.exit(0),
        (error) => {
          process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
          process.exit(1);
        },
      );
    };
    const vm = createViewModel(driver, {
      onExitRequest: exitAfterShutdown,
    });
    mounted = mountApp(vm, {
      onExitRequest: exitAfterShutdown,
      diagnostic,
    });
  } catch (error) {
    diagnostic.error('process-fatal', error);
    diagnostic.flush();
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}

void main();
