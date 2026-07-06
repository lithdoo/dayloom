import { runDailyInteractive } from '../daily';
import { createTranslator, type Translator } from '../i18n';
import { runInitInteractive, initWorldQuick } from '../init';
import { InitCancelledError } from '../init/errors';
import { runPlayInteractive } from '../play';
import { runSettleInteractive } from '../settle';
import { describeNextAction, formatNextStatus, inspectNextState, type NextAction, type NextWorldState } from './inspect';
import type { SessionExit, SessionIO } from '../session-io';

export interface NextOptions {
  io?: SessionIO;
  statusOnly?: boolean;
  confirm?: boolean;
  quick?: boolean;
  id?: string;
  title?: string;
  maxRounds?: number;
  dryRun?: boolean;
  yes?: boolean;
  keepSession?: boolean;
  maxToolRounds?: number;
  maxEventRounds?: number;
  mcpBaseUrl?: string;
  mcpToken?: string;
  t?: Translator;
}

export interface NextResult {
  state: NextWorldState;
  action: NextAction;
  executed: boolean;
  exit?: SessionExit;
}

export async function runNext(dir: string, options: NextOptions = {}): Promise<NextResult> {
  const t = options.t ?? createTranslator('en');
  const state = inspectNextState(dir);
  const io = options.io;

  if (!options.statusOnly && !io) {
    throw new Error('runNext requires io when executing an action');
  }

  if (io) {
    io.write(`${formatNextStatus(state, t)}\n`);
  }

  if (options.statusOnly) return { state, action: state.action, executed: false };

  if (!io) throw new Error('runNext requires io when executing an action');

  io.write(`${describeNextAction(state, t)}\n`);
  if (options.confirm && !(await io.confirm(t('next.proceed', { action: state.action })))) {
    io.write(`${t('next.cancelled')}\n`);
    return { state, action: state.action, executed: false };
  }

  let exit: SessionExit | undefined;

  switch (state.action) {
    case 'init': {
      const initOptions = {
        id: options.id,
        title: options.title,
        maxRounds: options.maxRounds,
        keepSessionOnError: options.keepSession,
        io,
      };
      if (options.quick) {
        const worldRoot = initWorldQuick(state.worldRoot, initOptions);
        io.write(`${t('next.initialized', { worldRoot })}\n`);
        exit = { kind: 'completed', result: { worldRoot } };
      } else {
        const initExit = await runInitInteractive(state.worldRoot, initOptions);
        exit = initExit;
        if (initExit.kind === 'completed' && initExit.result) {
          io.write(`${t('next.initialized', { worldRoot: initExit.result.worldRoot })}\n`);
        }
      }
      break;
    }
    case 'daily':
      exit = await runDailyInteractive(state.worldRoot, { ...commonAiOptions(options), io });
      break;
    case 'play':
      exit = await runPlayInteractive(state.worldRoot, {
        keepSession: options.keepSession,
        maxToolRounds: options.maxToolRounds,
        maxEventRounds: options.maxEventRounds,
        mcpBaseUrl: options.mcpBaseUrl,
        mcpToken: options.mcpToken,
        io,
      });
      break;
    case 'settle': {
      const settleExit = await runSettleInteractive(state.worldRoot, { ...commonAiOptions(options), t, io });
      exit = settleExit;
      if (settleExit.kind === 'completed' && settleExit.result) {
        const result = settleExit.result;
        io.write(`${result.description}\n`);
        if (result.applied) io.write(`${t('cli.settle.settled', { day: result.day, nextDay: result.nextDay })}\n`);
        else if (result.proposalPath) {
          io.write(`${t('cli.settle.generatedProposal', { proposalPath: result.proposalPath })}\n${t('cli.settle.reviewProposal')}\n`);
        } else {
          io.write(`${t('cli.common.dryRunOnly')}\n`);
        }
      }
      break;
    }
  }

  return { state, action: state.action, executed: true, exit };
}

export { InitCancelledError, describeNextAction, formatNextStatus, inspectNextState };

function commonAiOptions(options: NextOptions) {
  return {
    dryRun: options.dryRun,
    yes: options.yes,
    keepSession: options.keepSession,
    maxToolRounds: options.maxToolRounds,
    mcpBaseUrl: options.mcpBaseUrl,
    mcpToken: options.mcpToken,
  };
}
