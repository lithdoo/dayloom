import { createRuntimeError } from '../errors';
import type { CoreFileSystem } from '../infrastructure/filesystem';
import type { CoreLogger } from '../infrastructure/logger';
import { validateArchiveOperation } from '../schemas/validators';
import { writeJson } from './atomic-file';
import { readCommit } from './archive-reader';
import { ArchivePaths } from './paths';
import type { ArchivePublishResult, ArchiveTransaction } from './types';

/** 发布从中断 Session 回到 base commit 业务状态的新 commit。 */
export async function recoverSession(options: {
  filesystem: CoreFileSystem;
  paths: ArchivePaths;
  logger: CoreLogger;
  currentCommit: Awaited<ReturnType<typeof readCommit>>;
  transaction: ArchiveTransaction;
}): Promise<ArchivePublishResult> {
  const active = options.currentCommit.activeSession;
  if (!active) {
    throw createRuntimeError('ARCHIVE_SESSION_RECOVERY_FAILED', 'Current commit has no interrupted Session.');
  }
  const base = await readCommit(options.filesystem, options.paths, active.baseCommitId);
  const expected = expectedBasePhase(options.currentCommit.world.phase);
  if (!expected || base.world.phase !== expected || base.activeSession !== null) {
    throw createRuntimeError('ARCHIVE_SESSION_RECOVERY_FAILED', 'Session base commit is not a matching stable boundary.', {
      baseCommitId: base.id,
      basePhase: base.world.phase,
    });
  }
  await options.transaction.stageCommit({
    world: base.world,
    canonRevision: base.canonRevision,
    dayHeads: base.dayHeads,
    activeSession: null,
  });
  const result = await options.transaction.publish();
  try {
    const operationPath = options.paths.operationMeta(active.operationId);
    const operation = validateArchiveOperation(JSON.parse(await options.filesystem.readText(operationPath)));
    await writeJson(options.filesystem, operationPath, {
      ...operation,
      sessionOutcome: 'interrupted',
      updatedAt: result.pointer.updatedAt,
    }, true);
  } catch (error) {
    options.logger.error('Could not mark interrupted Session operation.', error, {
      operationId: active.operationId,
    });
  }
  return result;
}

function expectedBasePhase(phase: string): 'idle' | 'planned' | null {
  if (phase === 'planning' || phase === 'revising') return 'idle';
  if (phase === 'playing') return 'planned';
  return null;
}
