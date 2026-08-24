import {
  InitCancelledError,
  handleShellCommand,
  runShellNext,
  type RecommendedActionOptions,
  type Translator,
} from '@dayloom/core-old';
import type { ViewModel } from '../view-model.js';
import type { HubAction, HubRecentSummary } from './types.js';

export interface RunHubActionContext {
  worldDir: string;
  actionOpts: RecommendedActionOptions;
  t: Translator;
}

export type HubActionResult = 'continue' | 'exit';

export async function runHubAction(
  action: HubAction,
  vm: ViewModel,
  ctx: RunHubActionContext,
): Promise<HubActionResult> {
  switch (action.target.kind) {
    case 'hub-mode':
      vm.setHubMode(action.target.mode);
      return 'continue';
    case 'app-exit':
      return 'exit';
    case 'next-session':
      await runNextSessionAction(action, vm, ctx);
      return 'continue';
    case 'revise-session':
      await runReviseAction(vm, ctx);
      return 'continue';
    case 'settle-loading':
      await runSettleAction(action, vm, ctx);
      return 'continue';
  }
}

async function runNextSessionAction(
  action: HubAction,
  vm: ViewModel,
  ctx: RunHubActionContext,
): Promise<void> {
  if (action.target.kind !== 'next-session') return;
  vm.setSessionPage(action.target.expectedCommand, { kind: 'starting' });
  try {
    await runShellNext(ctx);
    vm.setRecentSession(createRecentSummary('completed'));
  } catch (err) {
    vm.setRecentSession(createRecentSummary('failed', err));
    handleSessionError(err, vm);
  } finally {
    vm.clearInput();
    vm.setHubMode('status');
    vm.refreshHub();
  }
}

async function runReviseAction(vm: ViewModel, ctx: RunHubActionContext): Promise<void> {
  vm.setSessionPage('revise', { kind: 'starting' });
  try {
    await handleShellCommand({ kind: 'shell-command', command: 'revise', raw: '/revise' }, ctx);
    vm.setRecentSession(createRecentSummary('completed'));
  } catch (err) {
    vm.setRecentSession(createRecentSummary('failed', err));
    handleSessionError(err, vm);
  } finally {
    vm.clearInput();
    vm.setHubMode('status');
    vm.refreshHub();
  }
}

async function runSettleAction(
  action: HubAction,
  vm: ViewModel,
  ctx: RunHubActionContext,
): Promise<void> {
  if (action.target.kind !== 'settle-loading') return;
  vm.setHubBusy(action.target.busy.label);
  try {
    await runShellNext({
      ...ctx,
      actionOpts: {
        ...ctx.actionOpts,
        yes: true,
      },
    });
    vm.setRecentSession(createRecentSummary('completed'));
  } catch (err) {
    vm.setRecentSession(createRecentSummary('failed', err));
    handleSessionError(err, vm);
  } finally {
    vm.clearInput();
    vm.setHubBusy(null);
    vm.setHubMode('status');
    vm.refreshHub();
  }
}

function handleSessionError(err: unknown, vm: ViewModel): void {
  if (err instanceof InitCancelledError) {
    vm.appendMessage('error', `${err.message}\n`);
    return;
  }
  vm.appendMessage('error', `${err instanceof Error ? err.message : String(err)}\n`);
}

function createRecentSummary(
  kind: HubRecentSummary['kind'],
  err?: unknown,
): HubRecentSummary {
  if (kind === 'failed') {
    return {
      kind,
      label: '最近会话失败',
      detail: err instanceof Error ? err.message : err === undefined ? undefined : String(err),
    };
  }
  return {
    kind,
    label: '最近会话已结束',
  };
}
