import type { ArchiveRepository } from '../archive';
import type { InitSubmission } from '../schemas/submissions';
import { validateInitSubmission } from '../schemas/validators';
import type { WorldSnapshot } from '../types';
import { worldSnapshotFromPublish } from '../runtime/snapshot';
import { requireUninitialized } from './context';
import { canonRevisionDraft } from './builders/canon-revision';

export async function initializeWorld(input: {
  archive: ArchiveRepository;
  operationId: string;
  previous: WorldSnapshot;
  target: WorldSnapshot;
  submission: InitSubmission;
}): Promise<WorldSnapshot> {
  const submission = validateInitSubmission(input.submission);
  await requireUninitialized(input.archive);
  const transaction = await input.archive.beginOperation('init', input.operationId);
  try {
    await transaction.stageManifest({ worldId: submission.world.id, title: submission.world.title });
    const canonRevision = await transaction.stageCanon(canonRevisionDraft(submission.canon, null));
    await transaction.stageCommit({
      world: { phase: 'idle', day: input.target.day, lastSettledDay: null },
      canonRevision,
      dayHeads: {},
      activeSession: null,
    });
    return {
      ...worldSnapshotFromPublish(input.previous, await transaction.publish()),
      worldId: submission.world.id,
    };
  } catch (error) {
    await transaction.abort();
    throw error;
  }
}
