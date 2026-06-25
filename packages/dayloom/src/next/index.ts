import { dailyInteractive } from '../daily';
import { initWorldInteractive, initWorldQuick } from '../init';
import { InitCancelledError } from '../init/errors';
import { playInteractive } from '../play';
import { askYesNo } from '../revise/read-user-input';
import { settleWithAi } from '../settle';
import { describeNextAction, formatNextStatus, inspectNextState, type NextAction, type NextWorldState } from './inspect';

export interface NextOptions {
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
}

export interface NextResult {
  state: NextWorldState;
  action: NextAction;
  executed: boolean;
}

export async function runNext(dir: string, options: NextOptions = {}): Promise<NextResult> {
  const state = inspectNextState(dir);
  process.stdout.write(`${formatNextStatus(state)}\n`);

  if (options.statusOnly) return { state, action: state.action, executed: false };

  process.stdout.write(`${describeNextAction(state)}\n`);
  if (options.confirm && !(await askYesNo(`Proceed with ${state.action}? (Y/N): `))) {
    process.stdout.write('Cancelled.\n');
    return { state, action: state.action, executed: false };
  }

  switch (state.action) {
    case 'init': {
      const initOptions = {
        id: options.id,
        title: options.title,
        maxRounds: options.maxRounds,
        keepSessionOnError: options.keepSession,
      };
      const worldRoot = options.quick
        ? initWorldQuick(state.worldRoot, initOptions)
        : await initWorldInteractive(state.worldRoot, initOptions);
      process.stdout.write(`Initialized World save: ${worldRoot}\n`);
      break;
    }
    case 'daily':
      await dailyInteractive(state.worldRoot, commonAiOptions(options));
      break;
    case 'play':
      await playInteractive(state.worldRoot, {
        keepSession: options.keepSession,
        maxToolRounds: options.maxToolRounds,
        maxEventRounds: options.maxEventRounds,
        mcpBaseUrl: options.mcpBaseUrl,
        mcpToken: options.mcpToken,
      });
      break;
    case 'settle': {
      const result = await settleWithAi(state.worldRoot, commonAiOptions(options));
      process.stdout.write(`${result.description}\n`);
      if (result.applied) process.stdout.write(`Settled ${result.day}; advanced to ${result.nextDay}.\n`);
      else if (result.proposalPath) {
        process.stdout.write(`Generated settlement proposal: ${result.proposalPath}\nReview it, then rerun dayloom settle with --proposal and --yes.\n`);
      } else {
        process.stdout.write('Dry run only. No files changed.\n');
      }
      break;
    }
  }

  return { state, action: state.action, executed: true };
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
