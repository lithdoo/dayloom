import { createRuntimeError } from '../errors';
import type { ArchiveRepository } from '../archive';
import type { RuntimeClock } from '../infrastructure/clock';
import type { WorldSnapshot } from '../types';
import { worldSnapshotFromPublish } from '../runtime/snapshot';
import { buildCommitDraft } from './builders/commit';
import { copyDayRevision } from './builders/day-revision';
import { requireOperationBase } from './context';

export async function abandonDay(input: {
  archive: ArchiveRepository;
  clock: RuntimeClock;
  operationId: string;
  previous: WorldSnapshot;
  target: WorldSnapshot;
}): Promise<WorldSnapshot> {
  const current = await requireOperationBase(input.archive, input.previous);
  const day = current.commit.world.day;
  const head = day ? current.commit.dayHeads[day] : null;
  if (!day || !head || (head.status !== 'planned' && head.status !== 'awaiting-settle')) {
    throw createRuntimeError('SUBMISSION_INVALID', 'abandon-day requires a planned or awaiting-settle day head.');
  }
  const previousDay = await input.archive.readDayRevision(day, head.revision);
  const transaction = await input.archive.beginOperation('abandon-day', input.operationId);
  try {
    const revision = await transaction.stageDay({
      day,
      parentRevision: head.revision,
      status: 'abandoned',
      ...copyDayRevision(previousDay),
      abandoned: { day, abandonedAt: input.clock.now().toISOString(), previousRevision: head.revision },
    });
    const dayHeads = { ...current.commit.dayHeads, [day]: { revision, status: 'abandoned' as const } };
    await transaction.stageCommit(buildCommitDraft({ current: current.commit, target: input.target, dayHeads }));
    return worldSnapshotFromPublish(input.previous, await transaction.publish());
  } catch (error) {
    await transaction.abort();
    throw error;
  }
}
