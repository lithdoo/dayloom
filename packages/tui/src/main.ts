#!/usr/bin/env node
import path from 'node:path';
import { parseArgv, usage } from './argv.js';
import { mountApp } from './app.js';
import { createRuntimeDriver } from './runtime-driver/index.js';
import { createViewModel } from './view-model.js';

async function main(): Promise<void> {
  try {
    const parsed = parseArgv(process.argv);
    if (parsed.help) {
      process.stdout.write(`${usage()}\n`);
      return;
    }
    const worldRoot = path.resolve(parsed.worldRoot);
    const driver = await createRuntimeDriver({ worldRoot });
    let mounted: ReturnType<typeof mountApp> | null = null;
    let shutdownPromise: Promise<void> | null = null;
    const shutdown = (): Promise<void> => {
      if (shutdownPromise) return shutdownPromise;
      mounted?.dispose();
      mounted = null;
      shutdownPromise = vm.dispose();
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
    });
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}

void main();
