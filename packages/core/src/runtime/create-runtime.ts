import { createArchiveRepository } from '../archive';
import { coreStateMachine } from '../domain/state-machine';
import { systemClock } from '../infrastructure/clock';
import { createSystemIdGenerator } from '../infrastructure/ids';
import { noopCoreLogger } from '../infrastructure/logger';
import type { DayloomRuntime } from '../types';
import { SessionManager } from '../sessions/session-manager';
import { createArchiveRuntimeOperations } from '../operations/runtime-operations';
import { RuntimeController } from './runtime';
import { invalidWorldSnapshot, worldSnapshotFromArchive } from './snapshot';
import type { DayloomRuntimeOptions } from './types';

/** 异步读取、校验并恢复 archive 后创建 Runtime 内核。 */
export async function createDayloomRuntime(options: DayloomRuntimeOptions): Promise<DayloomRuntime> {
  const clock = options.clock ?? systemClock;
  const ids = options.idGenerator ?? createSystemIdGenerator();
  const logger = options.logger ?? noopCoreLogger;
  const archive = options.archiveRepository ?? createArchiveRepository({
    worldRoot: options.worldRoot,
    clock,
    ids,
    logger,
  });
  const sessionManager = new SessionManager({ sessionFactory: options.sessionFactory, logger });
  const operations = options.operations ?? createArchiveRuntimeOperations({ archive, clock });
  let read = await archive.readCurrent();
  if (read.status === 'ready' && read.commit.activeSession !== null) {
    try {
      await archive.recoverInterruptedSession();
      read = await archive.readCurrent();
    } catch (error) {
      logger.error('Runtime archive Session recovery failed.', error);
      const runtimeError = {
        code: 'ARCHIVE_SESSION_RECOVERY_FAILED' as const,
        message: error instanceof Error ? error.message : String(error),
      };
      return new RuntimeController({
        world: invalidWorldSnapshot(options.worldRoot, runtimeError),
        stateMachine: options.stateMachine ?? coreStateMachine,
        sessionManager,
        operations,
        ids,
        logger,
      });
    }
  }
  return new RuntimeController({
    world: worldSnapshotFromArchive(options.worldRoot, read),
    stateMachine: options.stateMachine ?? coreStateMachine,
    sessionManager,
    operations,
    ids,
    logger,
  });
}
