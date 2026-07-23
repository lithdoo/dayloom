import { createRuntimeError } from '../errors';
import type { ArchiveRepository } from '../archive';
import type { WorldSnapshot } from '../types';
import { worldSnapshotFromPublish } from '../runtime/snapshot';
import { buildCommitDraft } from './builders/commit';
import { requireOperationBase } from './context';

export async function cancelSession(input: {
  archive: ArchiveRepository;
  operationId: string;
  previous: WorldSnapshot;
  target: WorldSnapshot;
}): Promise<WorldSnapshot> {
  if (input.previous.phase === 'initializing') return { ...input.target };
  const current = await requireOperationBase(input.archive, input.previous);
  if (!current.commit.activeSession) {
    throw createRuntimeError('ARCHIVE_REFERENCE_INVALID', 'Current commit has no active Session reference.');
  }
  const base = await input.archive.readCommit(current.commit.activeSession.baseCommitId);
  const transaction = await input.archive.beginOperation('cancel-session', input.operationId);
  try {
    await transaction.stageCommit(buildCommitDraft({
      current: base,
      target: { ...input.target, day: base.world.day, lastSettledDay: base.world.lastSettledDay },
      canonRevision: base.canonRevision,
      dayHeads: base.dayHeads,
    }));
    return worldSnapshotFromPublish(input.previous, await transaction.publish());
  } catch (error) {
    await transaction.abort();
    throw error;
  }
}
