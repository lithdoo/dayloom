import { createTranslator, type Translator } from '../i18n';
import { InitCancelledError } from '../init/errors';
import { describeNextAction, formatNextStatus, inspectNextState, type NextAction, type NextWorldState } from './inspect';
import { runRecommendedAction } from './recommended-action';
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

  const exit = await runRecommendedAction(state, { io, t, ...options });

  return { state, action: state.action, executed: true, exit };
}

export { InitCancelledError, describeNextAction, formatNextStatus, inspectNextState };
export { inspectTuiHeader, type TuiHeaderSnapshot } from './inspect-header';
export { runRecommendedAction, type RecommendedActionOptions } from './recommended-action';
