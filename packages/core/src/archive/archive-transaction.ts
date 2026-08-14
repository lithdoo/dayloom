import path from 'path';
import { createRuntimeError, toRuntimeError } from '../errors';
import type { CoreFileSystem } from '../infrastructure/filesystem';
import type { IdGenerator } from '../infrastructure/ids';
import type { CoreLogger } from '../infrastructure/logger';
import type { RuntimeClock } from '../infrastructure/clock';
import type {
  ArchiveCommit,
  ArchiveOperation,
  ArchiveOperationType,
  CanonRevisionManifest,
  CurrentPointer,
  DayRevisionMeta,
} from '../schemas/archive';
import type { RuntimeError } from '../schemas/common';
import type { SessionWorkspace } from '../sessions/types';
import {
  validateArchiveCommit,
  validateArchiveManifest,
  validateArchiveOperation,
  validateCanonRevisionManifest,
  validateCurrentPointer,
  validateDayRevisionMeta,
  validatePlanDocument,
  validatePlayDocument,
  validatePlayEventDocument,
  validateSettlementDocument,
  validateAbandonedDocument,
  validateTranscriptEntries,
} from '../schemas/validators';
import { encodeJson, writeAtomicText, writeJson } from './atomic-file';
import { readArchive, readCommit } from './archive-reader';
import { ArchivePaths } from './paths';
import { acquirePublishLock } from './publish-lock';
import { ArchiveSessionWorkspace } from './session-workspace';
import type {
  ArchivePublishResult,
  ArchiveTransaction,
  CanonDraft,
  CommitDraft,
  DayDraft,
  ManifestDraft,
} from './types';

export interface FileArchiveTransactionOptions {
  filesystem: CoreFileSystem;
  paths: ArchivePaths;
  clock: RuntimeClock;
  ids: IdGenerator;
  logger: CoreLogger;
  lockStaleAfterMs: number;
  operation: ArchiveOperation;
  base: CurrentPointer | null;
}

/** 文件系统隔离 archive transaction。 */
export class FileArchiveTransaction implements ArchiveTransaction {
  readonly operationId: string;
  readonly base: CurrentPointer | null;
  readonly workspace: SessionWorkspace;
  private readonly filesystem: CoreFileSystem;
  private readonly paths: ArchivePaths;
  private readonly clock: RuntimeClock;
  private readonly ids: IdGenerator;
  private readonly logger: CoreLogger;
  private readonly lockStaleAfterMs: number;
  private operation: ArchiveOperation;
  private manifest: ReturnType<typeof validateArchiveManifest> | null = null;
  private readonly canonRevisions = new Map<string, string>();
  private readonly dayRevisions = new Map<string, { day: string; source: string }>();
  private commit: ArchiveCommit | null = null;
  private commitSource: string | null = null;
  private closed = false;

  constructor(options: FileArchiveTransactionOptions) {
    this.filesystem = options.filesystem;
    this.paths = options.paths;
    this.clock = options.clock;
    this.ids = options.ids;
    this.logger = options.logger;
    this.lockStaleAfterMs = options.lockStaleAfterMs;
    this.operation = options.operation;
    this.operationId = options.operation.id;
    this.base = options.base ? { ...options.base } : null;
    this.workspace = new ArchiveSessionWorkspace(
      this.filesystem,
      path.join(this.paths.workspace(this.operationId), 'session'),
    );
  }

  async stageManifest(value: ManifestDraft): Promise<void> {
    this.assertOpen();
    if (this.base !== null) {
      throw createRuntimeError('OPERATION_FAILED', 'Manifest can only be staged during initialization.');
    }
    const manifest = validateArchiveManifest({
      schemaVersion: 1,
      worldId: value.worldId,
      title: value.title,
      createdAt: this.now(),
    });
    const target = path.join(this.workspaceRoot(), 'manifest.json');
    await writeJson(this.filesystem, target, manifest, true);
    this.manifest = manifest;
  }

  async stageCanon(value: CanonDraft): Promise<string> {
    this.assertOpen();
    if (value.parentRevision && !(await this.referenceExists(
      this.paths.canonRevision(value.parentRevision),
      this.canonRevisions.has(value.parentRevision),
    ))) {
      throw createRuntimeError('ARCHIVE_REFERENCE_MISSING', 'Canon parent revision is not staged or published.');
    }
    const id = this.ids.nextCanonRevisionId();
    const root = path.join(this.workspaceRoot(), 'canon', id);
    const files = ['premise.md', 'rules.md', 'style.md', 'user-role.md'];
    const manifest: CanonRevisionManifest = validateCanonRevisionManifest({
      id,
      parentRevision: value.parentRevision,
      operationId: this.operationId,
      createdAt: this.now(),
      files,
    });
    await this.filesystem.makeDirectory(root);
    await writeJson(this.filesystem, path.join(root, 'manifest.json'), manifest);
    await this.filesystem.writeText(path.join(root, 'premise.md'), value.documents.premise);
    await this.filesystem.writeText(path.join(root, 'rules.md'), value.documents.rules);
    await this.filesystem.writeText(path.join(root, 'style.md'), value.documents.style);
    await this.filesystem.writeText(path.join(root, 'user-role.md'), value.documents.userRole);
    this.canonRevisions.set(id, root);
    return id;
  }

  async stageDay(value: DayDraft): Promise<string> {
    this.assertOpen();
    validatePlanDocument(value.plan);
    if (value.plan.day !== value.day) {
      throw createRuntimeError('SUBMISSION_INVALID', 'Day draft and plan day do not match.');
    }
    if (value.play) validatePlayDocument(value.play);
    for (const event of value.events ?? []) validatePlayEventDocument(event);
    if (value.transcript) validateTranscriptEntries(value.transcript);
    if (value.settlement) validateSettlementDocument(value.settlement);
    if (value.abandoned) validateAbandonedDocument(value.abandoned);
    validateDayDraftRequirements(value);
    validateDayDraftRelationships(value);
    if (value.parentRevision && !(await this.referenceExists(
      this.paths.dayRevision(value.day, value.parentRevision),
      this.dayRevisions.has(value.parentRevision),
    ))) {
      throw createRuntimeError('ARCHIVE_REFERENCE_MISSING', 'Day parent revision is not staged or published.');
    }

    const revision = this.ids.nextDayRevisionId();
    const root = path.join(this.workspaceRoot(), 'days', value.day, 'revisions', revision);
    const files = ['plan.json'];
    if (value.play) files.push('play.json');
    if (value.transcript) files.push('transcript.jsonl');
    if (value.settlement) files.push('settlement.json');
    if (value.abandoned) files.push('abandoned.json');
    for (const event of value.events ?? []) files.push(`events/${event.id}.json`);
    const meta: DayRevisionMeta = validateDayRevisionMeta({
      day: value.day,
      revision,
      parentRevision: value.parentRevision,
      operationId: this.operationId,
      status: value.status,
      createdAt: this.now(),
      files,
    });

    await this.filesystem.makeDirectory(root);
    await writeJson(this.filesystem, path.join(root, 'meta.json'), meta);
    await writeJson(this.filesystem, path.join(root, 'plan.json'), value.plan);
    if (value.play) await writeJson(this.filesystem, path.join(root, 'play.json'), value.play);
    if (value.transcript) {
      const transcript = value.transcript.map((entry) => JSON.stringify(entry)).join('\n');
      await this.filesystem.writeText(
        path.join(root, 'transcript.jsonl'),
        transcript.length > 0 ? `${transcript}\n` : '',
      );
    }
    if (value.settlement) await writeJson(this.filesystem, path.join(root, 'settlement.json'), value.settlement);
    if (value.abandoned) await writeJson(this.filesystem, path.join(root, 'abandoned.json'), value.abandoned);
    for (const event of value.events ?? []) {
      await writeJson(this.filesystem, path.join(root, 'events', `${event.id}.json`), event);
    }
    this.dayRevisions.set(revision, { day: value.day, source: root });
    return revision;
  }

  async stageCommit(value: CommitDraft): Promise<string> {
    this.assertOpen();
    if (value.activeSession) {
      if (!this.base || value.activeSession.baseCommitId !== this.base.commitId) {
        throw createRuntimeError('SUBMISSION_INVALID', 'Active Session must use the transaction base commit.');
      }
      const expectedPhase = value.activeSession.kind === 'play' ? 'planned' : 'idle';
      const current = await readCommit(this.filesystem, this.paths, value.activeSession.baseCommitId);
      if (current.world.phase !== expectedPhase || current.activeSession !== null) {
        throw createRuntimeError('SUBMISSION_INVALID', 'Active Session base is not a matching stable commit.');
      }
    }
    const id = this.ids.nextCommitId();
    const commit = validateArchiveCommit({
      schemaVersion: 1,
      id,
      revision: (this.base?.revision ?? 0) + 1,
      parentCommitId: this.base?.commitId ?? null,
      operationId: this.operationId,
      createdAt: this.now(),
      world: value.world,
      canonRevision: value.canonRevision,
      dayHeads: value.dayHeads,
      activeSession: value.activeSession
        ? { ...value.activeSession, operationId: this.operationId }
        : null,
    });
    const target = path.join(this.workspaceRoot(), 'commits', `${id}.json`);
    await writeJson(this.filesystem, target, commit, true);
    this.commit = commit;
    this.commitSource = target;
    this.operation = {
      ...this.operation,
      targetCommitId: id,
      updatedAt: this.now(),
    };
    await this.writeOperation();
    return id;
  }

  async publish(): Promise<ArchivePublishResult> {
    this.assertOpen();
    if (!this.commit || !this.commitSource) {
      throw createRuntimeError('OPERATION_FAILED', 'Transaction has no staged commit.');
    }
    let lock;
    try {
      lock = await acquirePublishLock({
        filesystem: this.filesystem,
        lockPath: this.paths.publishLock(),
        clock: this.clock,
        staleAfterMs: this.lockStaleAfterMs,
      });
    } catch (error) {
      const runtimeError = toRuntimeError(error, 'OPERATION_FAILED');
      this.closed = true;
      await this.markFailed(runtimeError);
      throw runtimeError;
    }
    let published = false;
    try {
      await this.assertBaseStillCurrent();
      await this.validateStagedReferences();
      this.operation = {
        ...this.operation,
        status: 'prepared',
        updatedAt: this.now(),
      };
      await this.writeOperation();
      await this.promoteImmutableObjects();

      const pointer = validateCurrentPointer({
        schemaVersion: 1,
        revision: this.commit.revision,
        commitId: this.commit.id,
        updatedAt: this.now(),
      });
      const temporary = `${this.paths.current()}.tmp-${this.operationId}`;
      await writeAtomicText(this.filesystem, this.paths.current(), temporary, encodeJson(pointer));
      published = true;
      this.closed = true;

      this.operation = {
        ...this.operation,
        status: 'published',
        sessionOutcome: publishedSessionOutcome(this.operation.type),
        updatedAt: this.now(),
        error: null,
      };
      try {
        await this.writeOperation();
      } catch (error) {
        this.logger.error('Operation status update failed after archive publication.', error, {
          operationId: this.operationId,
          commitId: this.commit.id,
        });
      }
      await this.appendOperationLog(pointer);
      return { pointer, commit: this.commit, operation: this.operation };
    } catch (error) {
      const runtimeError = toRuntimeError(error, 'OPERATION_FAILED');
      if (!published) {
        this.closed = true;
        await this.markFailed(runtimeError);
      }
      throw runtimeError;
    } finally {
      try {
        await lock.release();
      } catch (error) {
        this.logger.error('Archive publish lock release failed.', error, {
          operationId: this.operationId,
          published,
        });
      }
    }
  }

  async abort(error = createRuntimeError('OPERATION_FAILED', 'Archive transaction aborted.')): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    await this.markFailed(error);
  }

  private async assertBaseStillCurrent(): Promise<void> {
    const current = await readArchive(this.filesystem, this.paths);
    if (current.status === 'invalid') throw current.error;
    if (this.base === null) {
      if (current.status !== 'uninitialized') {
        throw createRuntimeError('ARCHIVE_CONFLICT', 'Archive was initialized by another operation.');
      }
      return;
    }
    if (
      current.status !== 'ready' ||
      current.pointer.revision !== this.base.revision ||
      current.pointer.commitId !== this.base.commitId
    ) {
      throw createRuntimeError('ARCHIVE_CONFLICT', 'Archive current pointer changed during operation.', {
        baseRevision: this.base.revision,
        currentRevision: current.status === 'ready' ? current.pointer.revision : null,
      });
    }
  }

  private async validateStagedReferences(): Promise<void> {
    if (!this.commit) return;
    if (this.base === null && !this.manifest) {
      throw createRuntimeError('OPERATION_FAILED', 'Initialization requires a staged manifest.');
    }
    if (this.commit.canonRevision && !this.canonRevisions.has(this.commit.canonRevision)) {
      if (!(await this.filesystem.exists(this.paths.canonRevision(this.commit.canonRevision)))) {
        throw createRuntimeError('ARCHIVE_REFERENCE_MISSING', 'Commit canon revision is not staged or published.');
      }
    }
    for (const [day, head] of Object.entries(this.commit.dayHeads)) {
      const staged = this.dayRevisions.get(head.revision);
      if (staged && staged.day !== day) {
        throw createRuntimeError('ARCHIVE_REFERENCE_INVALID', 'Staged day revision belongs to another day.');
      }
      if (!staged && !(await this.filesystem.exists(this.paths.dayRevision(day, head.revision)))) {
        throw createRuntimeError('ARCHIVE_REFERENCE_MISSING', 'Commit day revision is not staged or published.', {
          day,
          revision: head.revision,
        });
      }
    }
  }

  private async referenceExists(target: string, staged: boolean): Promise<boolean> {
    return staged || await this.filesystem.exists(target);
  }

  private async promoteImmutableObjects(): Promise<void> {
    if (!this.commit || !this.commitSource) return;
    if (this.manifest) {
      await writeJson(this.filesystem, this.paths.manifest(), this.manifest, true);
    }
    for (const [id, source] of this.canonRevisions) {
      const target = this.paths.canonRevision(id);
      if (await this.filesystem.exists(target)) throw createRuntimeError('ARCHIVE_CONFLICT', 'Canon revision id already exists.');
      await this.filesystem.rename(source, target);
    }
    for (const [revision, staged] of this.dayRevisions) {
      const target = this.paths.dayRevision(staged.day, revision);
      if (await this.filesystem.exists(target)) throw createRuntimeError('ARCHIVE_CONFLICT', 'Day revision id already exists.');
      await this.filesystem.rename(staged.source, target);
    }
    const commitTarget = this.paths.commit(this.commit.id);
    if (await this.filesystem.exists(commitTarget)) throw createRuntimeError('ARCHIVE_CONFLICT', 'Commit id already exists.');
    await this.filesystem.rename(this.commitSource, commitTarget);
    await this.filesystem.syncDirectory(this.paths.root);
  }

  private async markFailed(error: RuntimeError): Promise<void> {
    this.operation = {
      ...this.operation,
      status: 'failed',
      updatedAt: this.now(),
      error,
    };
    try {
      await this.writeOperation();
    } catch (writeError) {
      this.logger.error('Could not mark archive operation failed.', writeError, {
        operationId: this.operationId,
      });
    }
  }

  private async writeOperation(): Promise<void> {
    validateArchiveOperation(this.operation);
    await writeJson(this.filesystem, this.paths.operationMeta(this.operationId), this.operation, true);
  }

  private async appendOperationLog(pointer: CurrentPointer): Promise<void> {
    try {
      const target = this.paths.operationLog();
      const previous = await this.filesystem.exists(target)
        ? await this.filesystem.readText(target)
        : '';
      const entry = JSON.stringify({
        operationId: this.operationId,
        type: this.operation.type,
        status: 'published',
        baseRevision: this.operation.baseRevision,
        targetRevision: pointer.revision,
        targetCommitId: pointer.commitId,
        timestamp: pointer.updatedAt,
      });
      await this.filesystem.writeText(target, `${previous}${entry}\n`, { overwrite: true });
    } catch (error) {
      this.logger.error('Archive operation log append failed.', error, {
        operationId: this.operationId,
      });
    }
  }

  private workspaceRoot(): string {
    return this.paths.workspace(this.operationId);
  }

  private now(): string {
    return this.clock.now().toISOString();
  }

  private assertOpen(): void {
    if (this.closed) throw createRuntimeError('OPERATION_FAILED', 'Archive transaction is already closed.');
  }
}

function validateDayDraftRequirements(value: DayDraft): void {
  if ((value.status === 'awaiting-settle' || value.status === 'settled') && (!value.play || !value.transcript)) {
    throw createRuntimeError('SUBMISSION_INVALID', `${value.status} day revision requires play and transcript.`);
  }
  if (value.status === 'settled' && !value.settlement) {
    throw createRuntimeError('SUBMISSION_INVALID', 'Settled day revision requires settlement.');
  }
  if (value.status === 'abandoned' && !value.abandoned) {
    throw createRuntimeError('SUBMISSION_INVALID', 'Abandoned day revision requires abandoned record.');
  }
  if (value.status === 'planned' && (value.play || value.events || value.transcript || value.settlement || value.abandoned)) {
    throw createRuntimeError('SUBMISSION_INVALID', 'Planned day revision cannot contain play results.');
  }
  if (value.status !== 'settled' && value.settlement) {
    throw createRuntimeError('SUBMISSION_INVALID', 'Only settled day revision can contain settlement.');
  }
  if (value.status !== 'abandoned' && value.abandoned) {
    throw createRuntimeError('SUBMISSION_INVALID', 'Only abandoned day revision can contain abandonment record.');
  }
  if (Boolean(value.play) !== Boolean(value.transcript)) {
    throw createRuntimeError('SUBMISSION_INVALID', 'Play and transcript must be staged together.');
  }
  if ((value.events?.length ?? 0) > 0 && !value.play) {
    throw createRuntimeError('SUBMISSION_INVALID', 'Events require a play document.');
  }
}

function validateDayDraftRelationships(value: DayDraft): void {
  const documents = [value.play, value.settlement, value.abandoned].filter((item) => item !== undefined);
  if (documents.some((document) => document.day !== value.day)) {
    throw createRuntimeError('SUBMISSION_INVALID', 'Day draft documents must reference the same day.');
  }
  if (value.abandoned && value.abandoned.previousRevision !== value.parentRevision) {
    throw createRuntimeError('SUBMISSION_INVALID', 'Abandonment previousRevision must match parentRevision.');
  }
  const events = value.events ?? [];
  const eventIds = events.map((event) => event.id);
  if (new Set(eventIds).size !== eventIds.length) {
    throw createRuntimeError('SUBMISSION_INVALID', 'Day draft event ids must be unique.');
  }
  if (value.play && !sameOrderedValues(value.play.eventIds, eventIds)) {
    throw createRuntimeError('SUBMISSION_INVALID', 'Play eventIds must match staged events in order.');
  }
  const eventsById = new Map(events.map((event) => [event.id, event]));
  for (const beat of value.plan.beats) {
    if (beat.status === 'completed' && (!beat.eventId || !eventsById.has(beat.eventId))) {
      throw createRuntimeError('SUBMISSION_INVALID', `Completed beat ${beat.id} must reference a staged event.`);
    }
    if (beat.eventId && eventsById.get(beat.eventId)?.beatId !== beat.id) {
      throw createRuntimeError('SUBMISSION_INVALID', `Beat ${beat.id} and its event must reference each other.`);
    }
  }
}

function sameOrderedValues(actual: string[], expected: string[]): boolean {
  return actual.length === expected.length && actual.every((value, index) => value === expected[index]);
}

function publishedSessionOutcome(type: ArchiveOperationType): ArchiveOperation['sessionOutcome'] {
  if (type === 'start-session') return 'active';
  if (type === 'submit-session') return 'submitted';
  if (type === 'cancel-session') return 'cancelled';
  if (type === 'recover-session') return 'interrupted';
  return null;
}
