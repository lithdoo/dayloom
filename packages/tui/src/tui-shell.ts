import type { RecommendedActionOptions, Translator } from '@dayloom/core';
import type { ViewModel } from './view-model.js';
import type { HubAction } from './hub/types.js';
import { runHubAction } from './hub/runner.js';

export interface RunTuiShellOptions {
  worldDir: string;
  vm: ViewModel;
  actionOpts: RecommendedActionOptions;
  t: Translator;
}

export async function runTuiShell(options: RunTuiShellOptions): Promise<void> {
  const { vm } = options;
  while (true) {
    const action = await new Promise<HubAction>((resolve) => {
      vm.beginHubSelection(resolve);
    });
    const result = await runHubAction(action, vm, {
      worldDir: options.worldDir,
      actionOpts: options.actionOpts,
      t: options.t,
    });
    if (result === 'exit') return;
  }
}
