import type { ArchiveCommit } from '../../schemas/archive';
import type { CommitDraft } from '../../archive';
import type { WorldSnapshot } from '../../types';

/** 从当前 commit 复制业务引用，并替换本次 operation 明确改变的字段。 */
export function buildCommitDraft(input: {
  current: ArchiveCommit;
  target: WorldSnapshot;
  canonRevision?: string | null;
  dayHeads?: ArchiveCommit['dayHeads'];
  activeSession?: CommitDraft['activeSession'];
}): CommitDraft {
  return {
    world: {
      phase: input.target.phase,
      day: input.target.day,
      lastSettledDay: input.target.lastSettledDay,
    },
    canonRevision: input.canonRevision === undefined
      ? input.current.canonRevision
      : input.canonRevision,
    dayHeads: input.dayHeads ?? input.current.dayHeads,
    activeSession: input.activeSession ?? null,
  };
}
