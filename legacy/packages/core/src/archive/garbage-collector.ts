import path from 'path';
import type { CoreFileSystem } from '../infrastructure/filesystem';
import type { RuntimeClock } from '../infrastructure/clock';
import { inspectArchive } from './archive-inspection';
import { ArchivePaths } from './paths';
import type { GarbageCollectionOptions, GarbageCollectionResult } from './types';

/** 根据引用图报告 orphan；仅显式 delete=true 时删除。 */
export async function collectArchiveGarbage(
  filesystem: CoreFileSystem,
  paths: ArchivePaths,
  clock: RuntimeClock,
  options: GarbageCollectionOptions = {},
): Promise<GarbageCollectionResult> {
  const inspection = await inspectArchive(filesystem, paths);
  const retentionMs = options.operationRetentionMs ?? 7 * 24 * 60 * 60 * 1_000;
  const candidates = [
    ...inspection.orphanCommits.map((id) => archiveRelative(paths.root, paths.commit(id))),
    ...inspection.orphanCanonRevisions.map((id) => archiveRelative(paths.root, paths.canonRevision(id))),
  ];
  for (const day of await filesystem.listDirectory(paths.days())) {
    for (const revision of inspection.orphanDayRevisions) {
      const target = paths.dayRevision(day, revision);
      if (await filesystem.exists(target)) candidates.push(archiveRelative(paths.root, target));
    }
  }
  for (const entry of inspection.operations) {
    const operation = entry.operation;
    if (!operation || (operation.status !== 'published' && operation.status !== 'failed')) continue;
    const age = clock.now().getTime() - Date.parse(operation.updatedAt);
    const workspace = paths.workspace(operation.id);
    if (Number.isFinite(age) && age >= retentionMs && await filesystem.exists(workspace)) {
      candidates.push(archiveRelative(paths.root, workspace));
    }
  }
  for (const entry of await filesystem.listDirectory(paths.root)) {
    if (/^current\.json\.tmp-op_[A-Za-z0-9_-]+$/.test(entry)) candidates.push(entry);
  }

  const uniqueCandidates = [...new Set(candidates)].sort();

  const deleted: string[] = [];
  if (options.delete) {
    for (const candidate of uniqueCandidates) {
      await filesystem.remove(path.join(paths.root, candidate), { recursive: true });
      deleted.push(candidate);
    }
  }
  return { candidates: uniqueCandidates, deleted };
}

function archiveRelative(root: string, target: string): string {
  return path.relative(root, target).split(path.sep).join('/');
}
