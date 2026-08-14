import { createRuntimeError } from '../errors';
import { systemClock } from '../infrastructure/clock';
import { createSystemIdGenerator } from '../infrastructure/ids';
import { noopCoreLogger } from '../infrastructure/logger';
import { createNodeCoreFileSystem } from '../infrastructure/node-filesystem';
import type { ArchiveOperation, ArchiveOperationType } from '../schemas/archive';
import { validateArchiveOperation } from '../schemas/validators';
import { writeJson } from './atomic-file';
import { inspectArchive } from './archive-inspection';
import {
  readArchive,
  readCanonRevisionData,
  readCommit,
  readDayRevisionData,
} from './archive-reader';
import { FileArchiveTransaction } from './archive-transaction';
import { collectArchiveGarbage } from './garbage-collector';
import { ArchivePaths } from './paths';
import { acquirePublishLock } from './publish-lock';
import { recoverSession } from './recovery';
import type {
  ArchiveInspection,
  ArchivePublishResult,
  ArchiveReadResult,
  ArchiveRepository,
  ArchiveRepositoryOptions,
  ArchiveTransaction,
  GarbageCollectionOptions,
  GarbageCollectionResult,
  CanonRevisionData,
  DayRevisionData,
} from './types';

/** 新格式文件 archive Repository。 */
export class FileArchiveRepository implements ArchiveRepository {
  private readonly filesystem;
  private readonly clock;
  private readonly ids;
  private readonly logger;
  private readonly paths: ArchivePaths;
  private readonly lockStaleAfterMs: number;

  constructor(options: ArchiveRepositoryOptions) {
    this.filesystem = options.filesystem ?? createNodeCoreFileSystem();
    this.clock = options.clock ?? systemClock;
    this.ids = options.ids ?? createSystemIdGenerator();
    this.logger = options.logger ?? noopCoreLogger;
    this.paths = new ArchivePaths(options.worldRoot);
    this.lockStaleAfterMs = options.lockStaleAfterMs ?? 30_000;
  }

  async readCurrent(): Promise<ArchiveReadResult> {
    const current = await readArchive(this.filesystem, this.paths);
    if (current.status === 'ready') await this.reconcilePublishedOperation(current);
    return current;
  }

  async readCommit(commitId: string) {
    return readCommit(this.filesystem, this.paths, commitId);
  }

  async readCanonRevision(revision: string): Promise<CanonRevisionData> {
    return readCanonRevisionData(this.filesystem, this.paths, revision);
  }

  async readDayRevision(day: string, revision: string): Promise<DayRevisionData> {
    return readDayRevisionData(this.filesystem, this.paths, day, revision);
  }

  async beginOperation(type: ArchiveOperationType, operationId?: string): Promise<ArchiveTransaction> {
    const current = await this.readCurrent();
    if (current.status === 'invalid') throw current.error;
    const id = operationId ?? this.ids.nextOperationId();
    if (await this.filesystem.exists(this.paths.operationMeta(id))) {
      throw createRuntimeError('ARCHIVE_CONFLICT', 'Archive operation id already exists.', { operationId: id });
    }
    const timestamp = this.clock.now().toISOString();
    const operation: ArchiveOperation = validateArchiveOperation({
      schemaVersion: 1,
      id,
      type,
      status: 'preparing',
      sessionOutcome: null,
      baseRevision: current.status === 'ready' ? current.pointer.revision : 0,
      baseCommitId: current.status === 'ready' ? current.pointer.commitId : null,
      targetCommitId: null,
      createdAt: timestamp,
      updatedAt: timestamp,
      error: null,
    });
    await this.filesystem.makeDirectory(this.paths.workspace(id));
    await writeJson(this.filesystem, this.paths.operationMeta(id), operation, true);
    return new FileArchiveTransaction({
      filesystem: this.filesystem,
      paths: this.paths,
      clock: this.clock,
      ids: this.ids,
      logger: this.logger,
      lockStaleAfterMs: this.lockStaleAfterMs,
      operation,
      base: current.status === 'ready' ? current.pointer : null,
    });
  }

  async inspect(): Promise<ArchiveInspection> {
    return inspectArchive(this.filesystem, this.paths);
  }

  async recoverInterruptedSession(): Promise<ArchivePublishResult> {
    const current = await this.readCurrent();
    if (current.status !== 'ready') {
      throw createRuntimeError('ARCHIVE_SESSION_RECOVERY_FAILED', 'Archive has no recoverable current commit.');
    }
    const transaction = await this.beginOperation('recover-session');
    try {
      return await recoverSession({
        filesystem: this.filesystem,
        paths: this.paths,
        logger: this.logger,
        currentCommit: current.commit,
        transaction,
      });
    } catch (error) {
      await transaction.abort(createRuntimeError(
        'ARCHIVE_SESSION_RECOVERY_FAILED',
        error instanceof Error ? error.message : String(error),
      ));
      throw error;
    }
  }

  async collectGarbage(options?: GarbageCollectionOptions): Promise<GarbageCollectionResult> {
    await this.readCurrent();
    if (!options?.delete) {
      return collectArchiveGarbage(this.filesystem, this.paths, this.clock, options);
    }
    const lock = await acquirePublishLock({
      filesystem: this.filesystem,
      lockPath: this.paths.publishLock(),
      clock: this.clock,
      staleAfterMs: this.lockStaleAfterMs,
    });
    try {
      return await collectArchiveGarbage(this.filesystem, this.paths, this.clock, options);
    } finally {
      try {
        await lock.release();
      } catch (error) {
        this.logger.error('Archive GC lock release failed.', error);
      }
    }
  }

  private async reconcilePublishedOperation(
    current: Extract<ArchiveReadResult, { status: 'ready' }>,
  ): Promise<void> {
    const target = this.paths.operationMeta(current.commit.operationId);
    if (!(await this.filesystem.exists(target))) return;
    try {
      const operation = validateArchiveOperation(JSON.parse(await this.filesystem.readText(target)));
      if (operation.targetCommitId !== current.commit.id || operation.status === 'published') return;
      await writeJson(this.filesystem, target, {
        ...operation,
        status: 'published',
        sessionOutcome: publishedSessionOutcome(operation.type),
        updatedAt: current.pointer.updatedAt,
        error: null,
      }, true);
    } catch (error) {
      this.logger.error('Could not reconcile published archive operation.', error, {
        operationId: current.commit.operationId,
        commitId: current.commit.id,
      });
    }
  }
}

/** 创建文件 archive Repository。 */
export function createArchiveRepository(options: ArchiveRepositoryOptions): ArchiveRepository {
  return new FileArchiveRepository(options);
}

function publishedSessionOutcome(type: ArchiveOperationType): ArchiveOperation['sessionOutcome'] {
  if (type === 'start-session') return 'active';
  if (type === 'submit-session') return 'submitted';
  if (type === 'cancel-session') return 'cancelled';
  if (type === 'recover-session') return 'interrupted';
  return null;
}
