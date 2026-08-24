import { createRuntimeError } from '../errors';
import type { SessionWorldContext, SessionWorldReadModel } from '../sessions/world-read-model';
import type { WorldSnapshot } from '../types';
import type { ArchiveRepository } from './types';

/** 用 ArchiveRepository 实现 Session 所需的只读 World 数据端口。 */
export function createArchiveSessionWorldReadModel(
  archive: ArchiveRepository,
): SessionWorldReadModel {
  return {
    async read(snapshot: Readonly<WorldSnapshot>): Promise<SessionWorldContext> {
      if (!snapshot.initialized || snapshot.commitId === null) {
        return { canon: null, day: null };
      }
      const commit = await archive.readCommit(snapshot.commitId);
      if (commit.revision !== snapshot.revision) {
        throw createRuntimeError('ARCHIVE_CONFLICT', 'Session snapshot no longer matches its commit.', {
          snapshotRevision: snapshot.revision,
          commitRevision: commit.revision,
        });
      }
      const canon = commit.canonRevision === null
        ? null
        : (await archive.readCanonRevision(commit.canonRevision)).documents;
      const head = snapshot.day === null ? null : commit.dayHeads[snapshot.day];
      const day = snapshot.day !== null && head
        ? await archive.readDayRevision(snapshot.day, head.revision)
        : null;
      return { canon, day };
    },
  };
}
