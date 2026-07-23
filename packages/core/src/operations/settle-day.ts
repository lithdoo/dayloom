import { createRuntimeError } from '../errors';
import type { ArchiveRepository } from '../archive';
import type { RuntimeClock } from '../infrastructure/clock';
import type { WorldSnapshot } from '../types';
import { worldSnapshotFromPublish } from '../runtime/snapshot';
import { buildCommitDraft } from './builders/commit';
import { copyDayRevision } from './builders/day-revision';
import { nextDay, requireOperationBase } from './context';

export async function settleDay(input: {
  archive: ArchiveRepository;
  clock: RuntimeClock;
  operationId: string;
  previous: WorldSnapshot;
  target: WorldSnapshot;
}): Promise<WorldSnapshot> {
  const current = await requireOperationBase(input.archive, input.previous);
  const day = current.commit.world.day;
  const head = day ? current.commit.dayHeads[day] : null;
  if (!day || !head || head.status !== 'awaiting-settle') {
    throw createRuntimeError('SUBMISSION_INVALID', 'settle requires an awaiting-settle day head.');
  }
  const previousDay = await input.archive.readDayRevision(day, head.revision);
  if (!previousDay.play) throw createRuntimeError('ARCHIVE_REFERENCE_INVALID', 'Day has no play result.');
  const transaction = await input.archive.beginOperation('settle-day', input.operationId);
  try {
    const revision = await transaction.stageDay({
      day,
      parentRevision: head.revision,
      status: 'settled',
      ...copyDayRevision(previousDay),
      settlement: { day, summary: previousDay.play.summary, settledAt: input.clock.now().toISOString() },
    });
    const dayHeads = { ...current.commit.dayHeads, [day]: { revision, status: 'settled' as const } };
    const target = { ...input.target, day: nextDay(day), lastSettledDay: day };
    await transaction.stageCommit(buildCommitDraft({ current: current.commit, target, dayHeads }));
    return worldSnapshotFromPublish(input.previous, await transaction.publish());
  } catch (error) {
    await transaction.abort();
    throw error;
  }
}
