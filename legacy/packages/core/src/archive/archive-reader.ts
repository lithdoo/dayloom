import path from 'path';
import { createRuntimeError } from '../errors';
import type { CoreFileSystem } from '../infrastructure/filesystem';
import type {
  ArchiveCommit,
  CanonRevisionManifest,
  DayRevisionMeta,
  PlanDocument,
  PlayDocument,
  PlayEventDocument,
} from '../schemas/archive';
import {
  SchemaValidationError,
  validateAbandonedDocument,
  validateArchiveCommit,
  validateArchiveManifest,
  validateCanonRevisionManifest,
  validateCurrentPointer,
  validateDayRevisionMeta,
  validatePlanDocument,
  validatePlayDocument,
  validatePlayEventDocument,
  validateSettlementDocument,
  validateTranscriptEntries,
} from '../schemas/validators';
import type { ArchiveReadResult, ReadyArchive } from './types';
import type { CanonRevisionData, DayRevisionData } from './types';
import { ArchivePaths } from './paths';

/** 从 current pointer 开始读取并校验正式 archive。 */
export async function readArchive(
  filesystem: CoreFileSystem,
  paths: ArchivePaths,
): Promise<ArchiveReadResult> {
  if (!(await filesystem.exists(paths.current()))) return { status: 'uninitialized' };

  try {
    const manifest = validateArchiveManifest(await readJson(
      filesystem,
      paths.manifest(),
      'ARCHIVE_MANIFEST_INVALID',
      'manifest.json',
    ));
    const pointer = validateCurrentPointer(await readJson(
      filesystem,
      paths.current(),
      'ARCHIVE_POINTER_INVALID',
      'current.json',
    ));
    if (!(await filesystem.exists(paths.commit(pointer.commitId)))) {
      return invalid('ARCHIVE_COMMIT_MISSING', 'Current commit does not exist.', {
        commitId: pointer.commitId,
        path: `commits/${pointer.commitId}.json`,
      });
    }
    const commit = validateArchiveCommit(await readJson(
      filesystem,
      paths.commit(pointer.commitId),
      'ARCHIVE_COMMIT_INVALID',
      `commits/${pointer.commitId}.json`,
    ));
    if (commit.id !== pointer.commitId || commit.revision !== pointer.revision) {
      return invalid('ARCHIVE_COMMIT_INVALID', 'Current pointer and commit identity do not match.', {
        commitId: pointer.commitId,
        pointerRevision: pointer.revision,
        commitRevision: commit.revision,
      });
    }

    const referenceError = await validateReferences(filesystem, paths, commit);
    if (referenceError) return referenceError;
    return { status: 'ready', manifest, pointer, commit } satisfies ReadyArchive;
  } catch (error) {
    if (isRuntimeErrorLike(error)) return { status: 'invalid', error };
    const code = error instanceof SchemaValidationError
      ? schemaCode(error.schema)
      : 'ARCHIVE_REFERENCE_INVALID';
    return invalid(code, error instanceof Error ? error.message : String(error));
  }
}

/** 读取指定 commit 并校验自身 schema，不解析其引用。 */
export async function readCommit(
  filesystem: CoreFileSystem,
  paths: ArchivePaths,
  commitId: string,
): Promise<ArchiveCommit> {
  if (!(await filesystem.exists(paths.commit(commitId)))) {
    throw createRuntimeError('ARCHIVE_COMMIT_MISSING', 'Commit does not exist.', { commitId });
  }
  try {
    const commit = validateArchiveCommit(JSON.parse(await filesystem.readText(paths.commit(commitId))));
    if (commit.id !== commitId) {
      throw createRuntimeError('ARCHIVE_COMMIT_INVALID', 'Commit file id does not match its path.', {
        commitId,
        actual: commit.id,
      });
    }
    return commit;
  } catch (error) {
    if (isRuntimeErrorLike(error)) throw error;
    throw createRuntimeError(
      'ARCHIVE_COMMIT_INVALID',
      error instanceof Error ? error.message : String(error),
      { commitId },
    );
  }
}

/** 读取并校验一个完整 canon revision。 */
export async function readCanonRevisionData(
  filesystem: CoreFileSystem,
  paths: ArchivePaths,
  revision: string,
): Promise<CanonRevisionData> {
  const root = paths.canonRevision(revision);
  try {
    const manifest = validateCanonRevisionManifest(JSON.parse(
      await requireText(filesystem, path.join(root, 'manifest.json')),
    ));
    if (manifest.id !== revision || !sameFileSet(manifest.files, CANON_FILES)) {
      throw new Error('Canon revision manifest does not match its path or required files.');
    }
    return {
      manifest,
      documents: {
        premise: await requireText(filesystem, path.join(root, 'premise.md')),
        rules: await requireText(filesystem, path.join(root, 'rules.md')),
        style: await requireText(filesystem, path.join(root, 'style.md')),
        userRole: await requireText(filesystem, path.join(root, 'user-role.md')),
      },
    };
  } catch (error) {
    throw createRuntimeError('ARCHIVE_REFERENCE_INVALID', errorMessage(error), { revision });
  }
}

/** 读取并校验一个完整 day revision。 */
export async function readDayRevisionData(
  filesystem: CoreFileSystem,
  paths: ArchivePaths,
  day: string,
  revision: string,
): Promise<DayRevisionData> {
  const root = paths.dayRevision(day, revision);
  try {
    const meta = validateDayRevisionMeta(JSON.parse(await requireText(filesystem, path.join(root, 'meta.json'))));
    if (meta.day !== day || meta.revision !== revision || !safeFileList(meta.files) || !validDayFileCombination(meta)) {
      throw new Error('Day revision meta does not match its path or status.');
    }
    const plan = validatePlanDocument(JSON.parse(await requireText(filesystem, path.join(root, 'plan.json'))));
    assertSameDay(plan.day, day, 'plan.json');
    const play = meta.files.includes('play.json')
      ? validatePlayDocument(JSON.parse(await requireText(filesystem, path.join(root, 'play.json'))))
      : null;
    if (play) assertSameDay(play.day, day, 'play.json');
    const transcript = meta.files.includes('transcript.jsonl')
      ? validateTranscriptEntries((await requireText(filesystem, path.join(root, 'transcript.jsonl')))
        .split('\n').filter(Boolean).map((line) => JSON.parse(line)))
      : [];
    const events: PlayEventDocument[] = [];
    for (const file of meta.files.filter((name) => name.startsWith('events/'))) {
      const event = validatePlayEventDocument(JSON.parse(await requireText(filesystem, path.join(root, file))));
      if (file !== `events/${event.id}.json`) throw new Error('Event id does not match its path.');
      events.push(event);
    }
    const settlement = meta.files.includes('settlement.json')
      ? validateSettlementDocument(JSON.parse(await requireText(filesystem, path.join(root, 'settlement.json'))))
      : null;
    const abandoned = meta.files.includes('abandoned.json')
      ? validateAbandonedDocument(JSON.parse(await requireText(filesystem, path.join(root, 'abandoned.json'))))
      : null;
    if (settlement) assertSameDay(settlement.day, day, 'settlement.json');
    if (abandoned) assertSameDay(abandoned.day, day, 'abandoned.json');
    return { meta, plan, play, events, transcript, settlement, abandoned };
  } catch (error) {
    throw createRuntimeError('ARCHIVE_REFERENCE_INVALID', errorMessage(error), { day, revision });
  }
}

async function validateReferences(
  filesystem: CoreFileSystem,
  paths: ArchivePaths,
  commit: ArchiveCommit,
): Promise<ArchiveReadResult | null> {
  if (commit.parentCommitId) {
    let parent: ArchiveCommit;
    try {
      parent = await readCommit(filesystem, paths, commit.parentCommitId);
    } catch (error) {
      return invalid(referenceCode(error), 'Parent commit is missing or invalid.', {
        commitId: commit.id,
        parentCommitId: commit.parentCommitId,
      });
    }
    if (parent.revision + 1 !== commit.revision) {
      return invalid('ARCHIVE_REFERENCE_INVALID', 'Parent commit revision is not contiguous.', {
        commitId: commit.id,
        parentCommitId: parent.id,
      });
    }
  }
  if (commit.activeSession) {
    let base: ArchiveCommit;
    try {
      base = await readCommit(filesystem, paths, commit.activeSession.baseCommitId);
    } catch (error) {
      return invalid(referenceCode(error), 'Active Session base commit is missing or invalid.', {
        commitId: commit.id,
        baseCommitId: commit.activeSession.baseCommitId,
      });
    }
    const expectedPhase = commit.activeSession.kind === 'play' ? 'planned' : 'idle';
    if (base.world.phase !== expectedPhase || base.activeSession !== null) {
      return invalid('ARCHIVE_REFERENCE_INVALID', 'Active Session base is not a matching stable commit.', {
        commitId: commit.id,
        baseCommitId: base.id,
        expectedPhase,
      });
    }
  }

  if (commit.canonRevision) {
    const root = paths.canonRevision(commit.canonRevision);
    const manifestPath = path.join(root, 'manifest.json');
    if (!(await filesystem.exists(manifestPath))) {
      return invalid('ARCHIVE_REFERENCE_MISSING', 'Canon revision manifest is missing.', {
        revision: commit.canonRevision,
        path: `canon/${commit.canonRevision}/manifest.json`,
      });
    }
    let manifest: CanonRevisionManifest;
    try {
      manifest = validateCanonRevisionManifest(JSON.parse(await filesystem.readText(manifestPath)));
    } catch (error) {
      return invalid('ARCHIVE_REFERENCE_INVALID', errorMessage(error), { revision: commit.canonRevision });
    }
    if (
      manifest.id !== commit.canonRevision ||
      !sameFileSet(manifest.files, CANON_FILES) ||
      !safeFileList(manifest.files)
    ) {
      return invalid('ARCHIVE_REFERENCE_INVALID', 'Canon revision identity or file list is invalid.', {
        revision: commit.canonRevision,
      });
    }
    for (const file of manifest.files) {
      if (!(await filesystem.exists(path.join(root, file)))) {
        return invalid('ARCHIVE_REFERENCE_MISSING', 'Canon revision file is missing.', {
          revision: commit.canonRevision,
          file,
          path: `canon/${commit.canonRevision}/${file}`,
        });
      }
    }
    if (manifest.parentRevision && !(await filesystem.exists(paths.canonRevision(manifest.parentRevision)))) {
      return invalid('ARCHIVE_REFERENCE_MISSING', 'Canon parent revision is missing.', {
        revision: commit.canonRevision,
        parentRevision: manifest.parentRevision,
        path: `canon/${manifest.parentRevision}`,
      });
    }
  }

  for (const [day, head] of Object.entries(commit.dayHeads)) {
    const root = paths.dayRevision(day, head.revision);
    const metaPath = path.join(root, 'meta.json');
    if (!(await filesystem.exists(metaPath))) {
      return invalid('ARCHIVE_REFERENCE_MISSING', 'Day revision meta is missing.', { day, revision: head.revision });
    }
    let meta: DayRevisionMeta;
    try {
      meta = validateDayRevisionMeta(JSON.parse(await filesystem.readText(metaPath)));
    } catch (error) {
      return invalid('ARCHIVE_REFERENCE_INVALID', errorMessage(error), { day, revision: head.revision });
    }
    if (meta.day !== day || meta.revision !== head.revision || meta.status !== head.status || !safeFileList(meta.files)) {
      return invalid('ARCHIVE_REFERENCE_INVALID', 'Day head and revision meta do not match.', {
        day,
        revision: head.revision,
      });
    }
    if (new Set(meta.files).size !== meta.files.length) {
      return invalid('ARCHIVE_REFERENCE_INVALID', 'Day revision file list contains duplicates.', {
        day,
        revision: head.revision,
      });
    }
    if (meta.parentRevision && !(await filesystem.exists(paths.dayRevision(day, meta.parentRevision)))) {
      return invalid('ARCHIVE_REFERENCE_MISSING', 'Day parent revision is missing.', {
        day,
        revision: head.revision,
        parentRevision: meta.parentRevision,
      });
    }
    const error = await validateDayFiles(filesystem, root, meta);
    if (error) return error;
  }
  return null;
}

async function validateDayFiles(
  filesystem: CoreFileSystem,
  root: string,
  meta: DayRevisionMeta,
): Promise<ArchiveReadResult | null> {
  if (!validDayFileCombination(meta)) {
    return invalid('ARCHIVE_REFERENCE_INVALID', 'Day revision files do not match its status.', {
      day: meta.day,
      revision: meta.revision,
      status: meta.status,
    });
  }
  const required = ['plan.json'];
  if (meta.status === 'awaiting-settle' || meta.status === 'settled') {
    required.push('play.json', 'transcript.jsonl');
  }
  if (meta.status === 'settled') required.push('settlement.json');
  if (meta.status === 'abandoned') required.push('abandoned.json');
  for (const file of required) {
    if (!meta.files.includes(file) || !(await filesystem.exists(path.join(root, file)))) {
      return invalid('ARCHIVE_REFERENCE_MISSING', 'Required day revision file is missing.', {
        day: meta.day,
        revision: meta.revision,
        file,
      });
    }
  }
  for (const file of meta.files) {
    if (!(await filesystem.exists(path.join(root, file)))) {
      return invalid('ARCHIVE_REFERENCE_MISSING', 'Listed day revision file is missing.', {
        day: meta.day,
        revision: meta.revision,
        file,
      });
    }
  }

  try {
    const plan = validatePlanDocument(JSON.parse(await filesystem.readText(path.join(root, 'plan.json'))));
    assertSameDay(plan.day, meta.day, 'plan.json');
    let play: PlayDocument | null = null;
    if (meta.files.includes('play.json')) {
      play = validatePlayDocument(JSON.parse(await filesystem.readText(path.join(root, 'play.json'))));
      assertSameDay(play.day, meta.day, 'play.json');
    }
    if (meta.files.includes('transcript.jsonl')) {
      const lines = (await filesystem.readText(path.join(root, 'transcript.jsonl')))
        .split('\n').filter((line) => line.length > 0).map((line) => JSON.parse(line));
      validateTranscriptEntries(lines);
    }
    if (meta.files.includes('settlement.json')) {
      const settlement = validateSettlementDocument(JSON.parse(await filesystem.readText(path.join(root, 'settlement.json'))));
      assertSameDay(settlement.day, meta.day, 'settlement.json');
    }
    if (meta.files.includes('abandoned.json')) {
      const abandoned = validateAbandonedDocument(JSON.parse(await filesystem.readText(path.join(root, 'abandoned.json'))));
      assertSameDay(abandoned.day, meta.day, 'abandoned.json');
      if (abandoned.previousRevision !== meta.parentRevision) {
        throw new Error('abandoned.json previousRevision must match meta parentRevision.');
      }
    }
    const events = new Map<string, PlayEventDocument>();
    for (const file of meta.files.filter((name) => name.startsWith('events/'))) {
      if (!/^events\/event_[A-Za-z0-9_-]+\.json$/.test(file)) {
        throw new Error(`Unsafe event path: ${file}`);
      }
      const event = validatePlayEventDocument(JSON.parse(await filesystem.readText(path.join(root, file))));
      if (file !== `events/${event.id}.json`) throw new Error(`Event id does not match path: ${file}`);
      if (events.has(event.id)) throw new Error(`Duplicate event id: ${event.id}`);
      events.set(event.id, event);
    }
    if (play) {
      if (!sameOrderedValues(play.eventIds, [...events.keys()])) {
        throw new Error('play.json eventIds must match listed event documents in order.');
      }
      for (const beat of plan.beats) {
        if (beat.status === 'completed' && (!beat.eventId || !events.has(beat.eventId))) {
          throw new Error(`Completed beat ${beat.id} must reference a listed event.`);
        }
        if (beat.eventId && events.get(beat.eventId)?.beatId !== beat.id) {
          throw new Error(`Beat ${beat.id} and event ${beat.eventId} do not reference each other.`);
        }
      }
    }
  } catch (error) {
    return invalid('ARCHIVE_REFERENCE_INVALID', errorMessage(error), {
      day: meta.day,
      revision: meta.revision,
    });
  }
  return null;
}

function validDayFileCombination(meta: DayRevisionMeta): boolean {
  const has = (file: string) => meta.files.includes(file);
  const hasEvents = meta.files.some((file) => file.startsWith('events/'));
  if (meta.status === 'planned') return sameFileSet(meta.files, ['plan.json']);
  if (meta.status === 'awaiting-settle') {
    return has('plan.json') && has('play.json') && has('transcript.jsonl') &&
      !has('settlement.json') && !has('abandoned.json');
  }
  if (meta.status === 'settled') {
    return has('plan.json') && has('play.json') && has('transcript.jsonl') &&
      has('settlement.json') && !has('abandoned.json');
  }
  const hasPlayBundle = has('play.json') && has('transcript.jsonl');
  return has('plan.json') && has('abandoned.json') && !has('settlement.json') &&
    (hasPlayBundle || (!has('play.json') && !has('transcript.jsonl') && !hasEvents));
}

const CANON_FILES = ['premise.md', 'rules.md', 'style.md', 'user-role.md'];

function sameFileSet(actual: string[], expected: string[]): boolean {
  return actual.length === expected.length && expected.every((file) => actual.includes(file));
}

function sameOrderedValues(actual: string[], expected: string[]): boolean {
  return actual.length === expected.length && actual.every((value, index) => value === expected[index]);
}

function assertSameDay(actual: string, expected: string, file: string): void {
  if (actual !== expected) throw new Error(`${file} day does not match revision day.`);
}

async function readJson(
  filesystem: CoreFileSystem,
  target: string,
  code: 'ARCHIVE_MANIFEST_INVALID' | 'ARCHIVE_POINTER_INVALID' | 'ARCHIVE_COMMIT_INVALID',
  relativePath: string,
): Promise<unknown> {
  try {
    return JSON.parse(await filesystem.readText(target));
  } catch (error) {
    throw createRuntimeError(code, errorMessage(error), { path: relativePath });
  }
}

function safeFileList(files: string[]): boolean {
  return files.every((file) => {
    const segments = file.split('/');
    return file.length > 0 &&
      !file.includes('\\') &&
      !path.isAbsolute(file) &&
      segments.every((segment) => segment.length > 0 && segment !== '.' && segment !== '..');
  });
}

function invalid(
  code: Parameters<typeof createRuntimeError>[0],
  message: string,
  details?: Parameters<typeof createRuntimeError>[2],
): ArchiveReadResult {
  return { status: 'invalid', error: createRuntimeError(code, message, details) };
}

function schemaCode(schema: string): 'ARCHIVE_MANIFEST_INVALID' | 'ARCHIVE_POINTER_INVALID' | 'ARCHIVE_COMMIT_INVALID' | 'ARCHIVE_REFERENCE_INVALID' {
  if (schema.startsWith('ArchiveManifest')) return 'ARCHIVE_MANIFEST_INVALID';
  if (schema.startsWith('CurrentPointer')) return 'ARCHIVE_POINTER_INVALID';
  if (schema.startsWith('ArchiveCommit')) return 'ARCHIVE_COMMIT_INVALID';
  return 'ARCHIVE_REFERENCE_INVALID';
}

function isRuntimeErrorLike(error: unknown): error is ReturnType<typeof createRuntimeError> {
  return typeof error === 'object' && error !== null && 'code' in error && 'message' in error;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function requireText(filesystem: CoreFileSystem, target: string): Promise<string> {
  if (!(await filesystem.exists(target))) throw new Error(`Referenced file is missing: ${path.basename(target)}`);
  return filesystem.readText(target);
}

function referenceCode(error: unknown): 'ARCHIVE_REFERENCE_MISSING' | 'ARCHIVE_REFERENCE_INVALID' {
  return isRuntimeErrorLike(error) && error.code === 'ARCHIVE_COMMIT_MISSING'
    ? 'ARCHIVE_REFERENCE_MISSING'
    : 'ARCHIVE_REFERENCE_INVALID';
}
