import { createRuntimeError } from '../errors';
import type { ArchiveRepository, ReadyArchive } from '../archive';
import type { WorldSnapshot } from '../types';

/** 读取并确认 operation 仍基于 Runtime 当前公开的 archive 边界。 */
export async function requireOperationBase(
  archive: ArchiveRepository,
  previous: WorldSnapshot,
): Promise<ReadyArchive> {
  const current = await archive.readCurrent();
  if (current.status !== 'ready') {
    throw current.status === 'invalid'
      ? current.error
      : createRuntimeError('ARCHIVE_CONFLICT', 'Archive is not initialized.');
  }
  if (
    current.pointer.revision !== previous.revision ||
    current.pointer.commitId !== previous.commitId
  ) {
    throw createRuntimeError('ARCHIVE_CONFLICT', 'Runtime snapshot no longer matches archive current.', {
      expectedRevision: previous.revision,
      actualRevision: current.pointer.revision,
    });
  }
  return current;
}

export async function requireUninitialized(archive: ArchiveRepository): Promise<void> {
  const current = await archive.readCurrent();
  if (current.status === 'invalid') throw current.error;
  if (current.status !== 'uninitialized') {
    throw createRuntimeError('ARCHIVE_CONFLICT', 'Archive is already initialized.');
  }
}

export function nextDay(day: string): string {
  const match = /^day_(\d+)$/.exec(day);
  if (!match) throw createRuntimeError('SUBMISSION_INVALID', 'Current day id cannot be advanced.');
  return `day_${String(Number(match[1]) + 1).padStart(match[1].length, '0')}`;
}
