import { runDailyInteractive } from '../daily';
import { createTranslator, type Translator } from '../i18n';
import { runInitInteractive, initWorldQuick } from '../init';
import { runPlayInteractive } from '../play';
import { runSettleInteractive } from '../settle';
import type { SessionExit, SessionIO } from '../session-io';
import type { NextWorldState } from './inspect';

export interface RecommendedActionOptions {
  io: SessionIO;
  t?: Translator;
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
}

export async function runRecommendedAction(
  state: NextWorldState,
  options: RecommendedActionOptions,
): Promise<SessionExit> {
  const t = options.t ?? createTranslator('en');
  const { io } = options;

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
        return { kind: 'completed', result: { worldRoot } };
      }
      const initExit = await runInitInteractive(state.worldRoot, initOptions);
      if (initExit.kind === 'completed' && initExit.result) {
        io.write(`${t('next.initialized', { worldRoot: initExit.result.worldRoot })}\n`);
      }
      return initExit;
    }
    case 'daily':
      return runDailyInteractive(state.worldRoot, { ...commonAiOptions(options), io });
    case 'play':
      return runPlayInteractive(state.worldRoot, {
        keepSession: options.keepSession,
        maxToolRounds: options.maxToolRounds,
        maxEventRounds: options.maxEventRounds,
        mcpBaseUrl: options.mcpBaseUrl,
        mcpToken: options.mcpToken,
        io,
      });
    case 'settle': {
      const settleExit = await runSettleInteractive(state.worldRoot, { ...commonAiOptions(options), t, io });
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
      return settleExit;
    }
  }
}

function commonAiOptions(options: RecommendedActionOptions) {
  return {
    dryRun: options.dryRun,
    yes: options.yes,
    keepSession: options.keepSession,
    maxToolRounds: options.maxToolRounds,
    mcpBaseUrl: options.mcpBaseUrl,
    mcpToken: options.mcpToken,
  };
}
