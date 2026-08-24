import type { ArchiveReadResult } from '../archive';
import type { ArchivePublishResult } from '../archive';
import type { WorldSnapshot } from '../types';
import type { RuntimeError } from '../schemas/common';

/** 将 ArchiveRepository 读取结果转换为 Runtime world 快照。 */
export function worldSnapshotFromArchive(worldRoot: string, archive: ArchiveReadResult): WorldSnapshot {
  if (archive.status === 'uninitialized') {
    return {
      phase: 'uninitialized',
      worldRoot,
      worldId: null,
      revision: 0,
      commitId: null,
      day: null,
      lastSettledDay: null,
      initialized: false,
      invalid: null,
      invalidReason: null,
    };
  }
  if (archive.status === 'invalid') return invalidWorldSnapshot(worldRoot, archive.error);
  return {
    phase: archive.commit.world.phase,
    worldRoot,
    worldId: archive.manifest.worldId,
    revision: archive.pointer.revision,
    commitId: archive.pointer.commitId,
    day: archive.commit.world.day,
    lastSettledDay: archive.commit.world.lastSettledDay,
    initialized: true,
    invalid: null,
    invalidReason: null,
  };
}

/** 将成功发布结果投影到已有 world 身份。 */
export function worldSnapshotFromPublish(
  previous: WorldSnapshot,
  result: ArchivePublishResult,
): WorldSnapshot {
  return {
    ...previous,
    phase: result.commit.world.phase,
    revision: result.pointer.revision,
    commitId: result.pointer.commitId,
    day: result.commit.world.day,
    lastSettledDay: result.commit.world.lastSettledDay,
    initialized: true,
    invalid: null,
    invalidReason: null,
  };
}

export function invalidWorldSnapshot(
  worldRoot: string,
  error: RuntimeError,
): WorldSnapshot {
  return {
    phase: 'invalid',
    worldRoot,
    worldId: null,
    revision: 0,
    commitId: null,
    day: null,
    lastSettledDay: null,
    initialized: false,
    invalid: error,
    invalidReason: error.message,
  };
}
