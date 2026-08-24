import { createRuntimeError } from '../errors';
import type { ArchiveRepository } from '../archive';
import type { PlaySubmission } from '../schemas/submissions';
import { validatePlaySubmission } from '../schemas/validators';
import type { WorldSnapshot } from '../types';
import { worldSnapshotFromPublish } from '../runtime/snapshot';
import { buildCommitDraft } from './builders/commit';
import { playedDayDraft } from './builders/day-revision';
import { requireOperationBase } from './context';

export async function submitPlay(input: {
  archive: ArchiveRepository;
  operationId: string;
  previous: WorldSnapshot;
  target: WorldSnapshot;
  submission: PlaySubmission;
}): Promise<WorldSnapshot> {
  const submission = validatePlaySubmission(input.submission);
  const current = await requireOperationBase(input.archive, input.previous);
  const head = current.commit.dayHeads[submission.day];
  if (!head || head.status !== 'planned') {
    throw createRuntimeError('SUBMISSION_INVALID', 'Play submission requires a planned day head.');
  }
  const previousDay = await input.archive.readDayRevision(submission.day, head.revision);
  const transaction = await input.archive.beginOperation('submit-session', input.operationId);
  try {
    const revision = await transaction.stageDay(playedDayDraft(submission, previousDay));
    const dayHeads = {
      ...current.commit.dayHeads,
      [submission.day]: { revision, status: 'awaiting-settle' as const },
    };
    await transaction.stageCommit(buildCommitDraft({ current: current.commit, target: input.target, dayHeads }));
    return worldSnapshotFromPublish(input.previous, await transaction.publish());
  } catch (error) {
    await transaction.abort();
    throw error;
  }
}
