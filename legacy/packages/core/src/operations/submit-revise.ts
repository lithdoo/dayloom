import type { ArchiveRepository } from '../archive';
import type { ReviseSubmission } from '../schemas/submissions';
import { validateReviseSubmission } from '../schemas/validators';
import type { WorldSnapshot } from '../types';
import { worldSnapshotFromPublish } from '../runtime/snapshot';
import { buildCommitDraft } from './builders/commit';
import { canonRevisionDraft } from './builders/canon-revision';
import { requireOperationBase } from './context';

export async function submitRevise(input: {
  archive: ArchiveRepository;
  operationId: string;
  previous: WorldSnapshot;
  target: WorldSnapshot;
  submission: ReviseSubmission;
}): Promise<WorldSnapshot> {
  const submission = validateReviseSubmission(input.submission);
  const current = await requireOperationBase(input.archive, input.previous);
  const transaction = await input.archive.beginOperation('submit-session', input.operationId);
  try {
    const canonRevision = await transaction.stageCanon(canonRevisionDraft(
      submission.canon,
      current.commit.canonRevision,
    ));
    await transaction.stageCommit(buildCommitDraft({ current: current.commit, target: input.target, canonRevision }));
    return worldSnapshotFromPublish(input.previous, await transaction.publish());
  } catch (error) {
    await transaction.abort();
    throw error;
  }
}
