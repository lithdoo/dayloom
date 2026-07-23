import type { CoreFileSystem } from '../infrastructure/filesystem';
import { createRuntimeError } from '../errors';
import { validateArchiveOperation } from '../schemas/validators';
import { readArchive, readCommit } from './archive-reader';
import { ArchivePaths } from './paths';
import type { ArchiveInspection, ArchiveOperationInspection } from './types';

/** 构建 current 历史链引用图，并报告不修改存档的 orphan。 */
export async function inspectArchive(
  filesystem: CoreFileSystem,
  paths: ArchivePaths,
): Promise<ArchiveInspection> {
  const current = await readArchive(filesystem, paths);
  const reachableCommits = new Set<string>();
  const reachableCanon = new Set<string>();
  const reachableDays = new Set<string>();
  if (current.status === 'ready') {
    let commit = current.commit;
    while (!reachableCommits.has(commit.id)) {
      reachableCommits.add(commit.id);
      if (commit.canonRevision) reachableCanon.add(commit.canonRevision);
      for (const head of Object.values(commit.dayHeads)) reachableDays.add(head.revision);
      if (!commit.parentCommitId) break;
      try {
        commit = await readCommit(filesystem, paths, commit.parentCommitId);
      } catch {
        break;
      }
    }
  }

  const allCommits = (await filesystem.listDirectory(paths.commits()))
    .filter((name) => /^commit_[A-Za-z0-9_-]+\.json$/.test(name))
    .map((name) => name.slice(0, -5));
  const allCanon = (await filesystem.listDirectory(paths.canon()))
    .filter((name) => /^canon_[A-Za-z0-9_-]+$/.test(name));
  const allDays: string[] = [];
  for (const day of await filesystem.listDirectory(paths.days())) {
    if (!/^day_\d{4,}$/.test(day)) continue;
    for (const revision of await filesystem.listDirectory(`${paths.day(day)}/revisions`)) {
      if (/^dayrev_[A-Za-z0-9_-]+$/.test(revision)) allDays.push(revision);
    }
  }

  return {
    current,
    operations: await inspectOperations(filesystem, paths),
    reachableCommits: [...reachableCommits],
    reachableCanonRevisions: [...reachableCanon],
    reachableDayRevisions: [...reachableDays],
    orphanCommits: allCommits.filter((id) => !reachableCommits.has(id)),
    orphanCanonRevisions: allCanon.filter((id) => !reachableCanon.has(id)),
    orphanDayRevisions: allDays.filter((id) => !reachableDays.has(id)),
  };
}

async function inspectOperations(
  filesystem: CoreFileSystem,
  paths: ArchivePaths,
): Promise<ArchiveOperationInspection[]> {
  const result: ArchiveOperationInspection[] = [];
  for (const id of await filesystem.listDirectory(paths.operations())) {
    try {
      if (!/^op_[A-Za-z0-9_-]+$/.test(id)) throw new Error('Invalid operation directory name.');
      const operation = validateArchiveOperation(JSON.parse(await filesystem.readText(paths.operationMeta(id))));
      result.push({ id, operation, error: null });
    } catch (error) {
      result.push({
        id,
        operation: null,
        error: createRuntimeError('ARCHIVE_REFERENCE_INVALID', error instanceof Error ? error.message : String(error), {
          operationId: id,
        }),
      });
    }
  }
  return result;
}
