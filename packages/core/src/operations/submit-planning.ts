import type { ArchiveRepository } from '../archive';
import type { PlanningSubmission } from '../schemas/submissions';
import { validatePlanningSubmission } from '../schemas/validators';
import type { WorldSnapshot } from '../types';
import { worldSnapshotFromPublish } from '../runtime/snapshot';
import { buildCommitDraft } from './builders/commit';
import { plannedDayDraft } from './builders/day-revision';
import { requireOperationBase } from './context';

export async function submitPlanning(input: {
  archive: ArchiveRepository;
  operationId: string;
  previous: WorldSnapshot;
  target: WorldSnapshot;
  submission: PlanningSubmission;
}): Promise<WorldSnapshot> {
  const submission = validatePlanningSubmission(input.submission);
  const current = await requireOperationBase(input.archive, input.previous);
  const transaction = await input.archive.beginOperation('submit-session', input.operationId);
  try {
    const parent = current.commit.dayHeads[submission.day]?.revision ?? null;
    const revision = await transaction.stageDay(plannedDayDraft(submission, parent));
    const dayHeads = {
      ...current.commit.dayHeads,
      [submission.day]: { revision, status: 'planned' as const },
    };
    await transaction.stageCommit(buildCommitDraft({ current: current.commit, target: input.target, dayHeads }));
    return worldSnapshotFromPublish(input.previous, await transaction.publish());
  } catch (error) {
    await transaction.abort();
    throw error;
  }
}
