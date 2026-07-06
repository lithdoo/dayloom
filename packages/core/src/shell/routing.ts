import type { Translator } from '../i18n';
import { InitCancelledError } from '../init/errors';
import { inspectNextState } from '../next/inspect';
import { runRecommendedAction, type RecommendedActionOptions } from '../next/recommended-action';
import { runReviseInteractive } from '../revise';
import { parseShellLevelCommand, type SessionExit, type ShellCommand } from '../session-io';

export interface ShellRoutingContext {
  worldDir: string;
  actionOpts: RecommendedActionOptions;
  t: Translator;
}

export async function runShellNext(ctx: ShellRoutingContext): Promise<void> {
  try {
    const state = inspectNextState(ctx.worldDir);
    const exit = await runRecommendedAction(state, ctx.actionOpts);
    if (exit.kind === 'shell-command') {
      await handleShellCommand(exit, ctx);
    }
  } catch (err) {
    if (err instanceof InitCancelledError) {
      ctx.actionOpts.io.error(`${err.message}\n`);
      return;
    }
    const message = err instanceof Error ? err.message : String(err);
    ctx.actionOpts.io.error(`${message}\n`);
  }
}

export async function handleShellCommand(
  exit: Extract<SessionExit, { kind: 'shell-command' }>,
  ctx: ShellRoutingContext,
): Promise<void> {
  switch (exit.command) {
    case 'revise':
      try {
        await runReviseInteractive(ctx.worldDir, {
          io: ctx.actionOpts.io,
          dryRun: ctx.actionOpts.dryRun,
          yes: ctx.actionOpts.yes,
          keepSession: ctx.actionOpts.keepSession,
          maxToolRounds: ctx.actionOpts.maxToolRounds,
          mcpBaseUrl: ctx.actionOpts.mcpBaseUrl,
          mcpToken: ctx.actionOpts.mcpToken,
        });
      } catch (err) {
        if (err instanceof InitCancelledError) {
          ctx.actionOpts.io.error(`${err.message}\n`);
          return;
        }
        const message = err instanceof Error ? err.message : String(err);
        ctx.actionOpts.io.error(`${message}\n`);
      }
      return;
    case 'next':
      await runShellNext(ctx);
      return;
    case 'quit':
      return;
  }
}

export function isShellWaitToken(token: string): boolean {
  return token === '/status' || token === '/help';
}

export function parseShellWaitInput(input: string): ShellCommand | 'status' | 'help' | undefined {
  const token = input.trim().split(/\s+/, 1)[0].toLowerCase();
  if (token === '/status') return 'status';
  if (token === '/help') return 'help';
  return parseShellLevelCommand(input);
}
