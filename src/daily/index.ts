import { applyDailyPlan, describeChanges } from './apply-plan';
import { assertDailyCanStart, assertInitializedWorld, readCurrentDay, readLastCommittedDay, resolveWorldRoot } from './guard';
import { readDailyPlan } from './parse-payload';
import { projectDailyPlan } from './project-plan';
import { validateDailyPlan } from './validate-plan';
import type { DailyOptions } from './types';

export interface DailyResult { worldRoot: string; description: string; applied: boolean; }

export function dailyFromProposal(dir: string, proposalPath: string, options: DailyOptions = {}): DailyResult {
  const worldRoot = resolveWorldRoot(dir);
  assertInitializedWorld(worldRoot);
  assertDailyCanStart(worldRoot);
  const day = readCurrentDay(worldRoot);
  const plan = readDailyPlan(proposalPath);
  validateDailyPlan(plan, day);
  const changes = projectDailyPlan(plan, undefined, readLastCommittedDay(worldRoot));
  const description = describeChanges(worldRoot, changes);
  if (options.dryRun) return { worldRoot, description, applied: false };
  if (!options.yes) throw new Error('Applying a daily plan requires --yes. Use --dry-run to inspect changes.');
  applyDailyPlan(worldRoot, plan, changes);
  return { worldRoot, description, applied: true };
}

export { dailyInteractive } from './dialogue-loop';
