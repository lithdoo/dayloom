import type { SessionKind, WorldPhase } from '../domain/types';
import { isRuntimeErrorCode } from '../errors';
import type {
  AbandonedDocument,
  ActiveSessionReference,
  ArchiveCommit,
  ArchiveManifest,
  ArchiveOperation,
  ArchiveOperationType,
  CanonRevisionManifest,
  CurrentPointer,
  DayHead,
  DayRevisionMeta,
  DayRevisionStatus,
  PlanDocument,
  PlayDocument,
  PlayEventDocument,
  SettlementDocument,
} from './archive';
import type { RuntimeError } from './common';
import type {
  CanonDocuments,
  InitSubmission,
  PlanningSubmission,
  PlaySubmission,
  ReviseSubmission,
  SessionSubmission,
  TranscriptEntry,
} from './submissions';

/** 持久化 schema 校验失败。 */
export class SchemaValidationError extends Error {
  constructor(readonly schema: string, readonly field: string, message: string) {
    super(`${schema}.${field}: ${message}`);
    this.name = 'SchemaValidationError';
  }
}

/** 校验 world id。 */
export function isWorldId(value: unknown): value is string {
  return isSafeStableId(value);
}

/** 校验 day id。 */
export function isDayId(value: unknown): value is string {
  return typeof value === 'string' && /^day_\d{4,}$/.test(value);
}

/** 校验 commit id。 */
export function isCommitId(value: unknown): value is string {
  return hasPrefixedToken(value, 'commit_');
}

/** 校验 canon revision id。 */
export function isCanonRevisionId(value: unknown): value is string {
  return hasPrefixedToken(value, 'canon_');
}

/** 校验 day revision id。 */
export function isDayRevisionId(value: unknown): value is string {
  return hasPrefixedToken(value, 'dayrev_');
}

/** 校验 operation id。 */
export function isOperationId(value: unknown): value is string {
  return hasPrefixedToken(value, 'op_');
}

/** 校验 event id。 */
export function isEventId(value: unknown): value is string {
  return hasPrefixedToken(value, 'event_');
}

/** 校验 UTC ISO-8601 时间。 */
export function isIsoTimestamp(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) {
    return false;
  }
  return !Number.isNaN(Date.parse(value));
}

/** 校验并返回完整 canon 内容。 */
export function validateCanonDocuments(value: unknown): CanonDocuments {
  const object = record(value, 'CanonDocuments');
  string(object.premise, 'CanonDocuments', 'premise');
  string(object.rules, 'CanonDocuments', 'rules');
  string(object.style, 'CanonDocuments', 'style');
  string(object.userRole, 'CanonDocuments', 'userRole');
  return value as CanonDocuments;
}

/** 校验并返回 init submission。 */
export function validateInitSubmission(value: unknown): InitSubmission {
  const object = record(value, 'InitSubmission');
  literal(object.kind, 'init', 'InitSubmission', 'kind');
  const world = record(object.world, 'InitSubmission.world');
  field(world.id, isWorldId, 'InitSubmission.world', 'id');
  nonEmptyString(world.title, 'InitSubmission.world', 'title');
  validateCanonDocuments(object.canon);
  return value as InitSubmission;
}

/** 校验并返回 planning submission。 */
export function validatePlanningSubmission(value: unknown): PlanningSubmission {
  const object = record(value, 'PlanningSubmission');
  literal(object.kind, 'planning', 'PlanningSubmission', 'kind');
  field(object.day, isDayId, 'PlanningSubmission', 'day');
  nonEmptyString(object.intent, 'PlanningSubmission', 'intent');
  validatePlanBeats(object.beats, 'PlanningSubmission');
  return value as PlanningSubmission;
}

/** 校验并返回 play submission。 */
export function validatePlaySubmission(value: unknown): PlaySubmission {
  const object = record(value, 'PlaySubmission');
  literal(object.kind, 'play', 'PlaySubmission', 'kind');
  field(object.day, isDayId, 'PlaySubmission', 'day');
  nonEmptyString(object.summary, 'PlaySubmission', 'summary');
  validateResolvedPlanBeats(object.beats, 'PlaySubmission');
  const events = array(object.events, 'PlaySubmission', 'events');
  events.forEach((event) => validatePlayEvent(event, 'PlaySubmission'));
  validateTranscriptEntries(object.transcript);
  return value as PlaySubmission;
}

/** 校验并返回 revise submission。 */
export function validateReviseSubmission(value: unknown): ReviseSubmission {
  const object = record(value, 'ReviseSubmission');
  literal(object.kind, 'revise', 'ReviseSubmission', 'kind');
  nonEmptyString(object.summary, 'ReviseSubmission', 'summary');
  validateCanonDocuments(object.canon);
  return value as ReviseSubmission;
}

/** 按 kind 校验任意 Session submission。 */
export function validateSessionSubmission(value: unknown): SessionSubmission {
  const object = record(value, 'SessionSubmission');
  switch (object.kind) {
    case 'init':
      return validateInitSubmission(value);
    case 'planning':
      return validatePlanningSubmission(value);
    case 'play':
      return validatePlaySubmission(value);
    case 'revise':
      return validateReviseSubmission(value);
    default:
      return fail('SessionSubmission', 'kind', 'must be init, planning, play, or revise');
  }
}

/** 校验并返回 manifest。 */
export function validateArchiveManifest(value: unknown): ArchiveManifest {
  const object = record(value, 'ArchiveManifest');
  literal(object.schemaVersion, 1, 'ArchiveManifest', 'schemaVersion');
  field(object.worldId, isWorldId, 'ArchiveManifest', 'worldId');
  nonEmptyString(object.title, 'ArchiveManifest', 'title');
  field(object.createdAt, isIsoTimestamp, 'ArchiveManifest', 'createdAt');
  return value as ArchiveManifest;
}

/** 校验并返回 current pointer。 */
export function validateCurrentPointer(value: unknown): CurrentPointer {
  const object = record(value, 'CurrentPointer');
  literal(object.schemaVersion, 1, 'CurrentPointer', 'schemaVersion');
  positiveInteger(object.revision, 'CurrentPointer', 'revision');
  field(object.commitId, isCommitId, 'CurrentPointer', 'commitId');
  field(object.updatedAt, isIsoTimestamp, 'CurrentPointer', 'updatedAt');
  return value as CurrentPointer;
}

/** 校验并返回 archive commit，包括 phase/session/day 引用不变量。 */
export function validateArchiveCommit(value: unknown): ArchiveCommit {
  const object = record(value, 'ArchiveCommit');
  literal(object.schemaVersion, 1, 'ArchiveCommit', 'schemaVersion');
  field(object.id, isCommitId, 'ArchiveCommit', 'id');
  positiveInteger(object.revision, 'ArchiveCommit', 'revision');
  nullableField(object.parentCommitId, isCommitId, 'ArchiveCommit', 'parentCommitId');
  field(object.operationId, isOperationId, 'ArchiveCommit', 'operationId');
  field(object.createdAt, isIsoTimestamp, 'ArchiveCommit', 'createdAt');

  const world = record(object.world, 'ArchiveCommit.world');
  const phase = field(world.phase, isPersistedPhase, 'ArchiveCommit.world', 'phase');
  const day = nullableField(world.day, isDayId, 'ArchiveCommit.world', 'day');
  nullableField(world.lastSettledDay, isDayId, 'ArchiveCommit.world', 'lastSettledDay');

  nullableField(object.canonRevision, isCanonRevisionId, 'ArchiveCommit', 'canonRevision');
  const dayHeads = record(object.dayHeads, 'ArchiveCommit.dayHeads');
  for (const [dayId, head] of Object.entries(dayHeads)) {
    field(dayId, isDayId, 'ArchiveCommit.dayHeads', dayId);
    validateDayHead(head, `dayHeads.${dayId}`);
  }
  const activeSession = object.activeSession === null
    ? null
    : validateActiveSessionReference(object.activeSession);

  const sessionKind = sessionKindForPersistedPhase(phase);
  if (sessionKind === null && activeSession !== null) {
    fail('ArchiveCommit', 'activeSession', `must be null in stable phase ${phase}`);
  }
  if (sessionKind !== null && activeSession?.kind !== sessionKind) {
    fail('ArchiveCommit', 'activeSession', `must contain a ${sessionKind} session in phase ${phase}`);
  }
  if (
    day !== null &&
    !(day in dayHeads) &&
    (phase === 'planned' || phase === 'playing' || phase === 'awaiting-settle')
  ) {
    fail('ArchiveCommit', 'world.day', 'must reference an entry in dayHeads');
  }
  return value as ArchiveCommit;
}

/** 校验并返回 canon revision manifest。 */
export function validateCanonRevisionManifest(value: unknown): CanonRevisionManifest {
  const object = record(value, 'CanonRevisionManifest');
  field(object.id, isCanonRevisionId, 'CanonRevisionManifest', 'id');
  nullableField(object.parentRevision, isCanonRevisionId, 'CanonRevisionManifest', 'parentRevision');
  field(object.operationId, isOperationId, 'CanonRevisionManifest', 'operationId');
  field(object.createdAt, isIsoTimestamp, 'CanonRevisionManifest', 'createdAt');
  stringArray(object.files, 'CanonRevisionManifest', 'files');
  return value as CanonRevisionManifest;
}

/** 校验并返回 day revision meta。 */
export function validateDayRevisionMeta(value: unknown): DayRevisionMeta {
  const object = record(value, 'DayRevisionMeta');
  field(object.day, isDayId, 'DayRevisionMeta', 'day');
  field(object.revision, isDayRevisionId, 'DayRevisionMeta', 'revision');
  nullableField(object.parentRevision, isDayRevisionId, 'DayRevisionMeta', 'parentRevision');
  field(object.operationId, isOperationId, 'DayRevisionMeta', 'operationId');
  field(object.status, isDayRevisionStatus, 'DayRevisionMeta', 'status');
  field(object.createdAt, isIsoTimestamp, 'DayRevisionMeta', 'createdAt');
  stringArray(object.files, 'DayRevisionMeta', 'files');
  return value as DayRevisionMeta;
}

/** 校验并返回 plan document。 */
export function validatePlanDocument(value: unknown): PlanDocument {
  const object = record(value, 'PlanDocument');
  field(object.day, isDayId, 'PlanDocument', 'day');
  nonEmptyString(object.intent, 'PlanDocument', 'intent');
  const beats = array(object.beats, 'PlanDocument', 'beats');
  const seen = new Set<string>();
  for (const [index, item] of beats.entries()) {
    const beat = record(item, `PlanDocument.beats[${index}]`);
    const id = nonEmptyString(beat.id, 'PlanDocument', `beats[${index}].id`);
    if (seen.has(id)) fail('PlanDocument', `beats[${index}].id`, 'must be unique');
    seen.add(id);
    nonEmptyString(beat.intent, 'PlanDocument', `beats[${index}].intent`);
    field(beat.status, isBeatStatus, 'PlanDocument', `beats[${index}].status`);
    nullableField(beat.eventId, isEventId, 'PlanDocument', `beats[${index}].eventId`);
  }
  return value as PlanDocument;
}

function validatePlanBeats(value: unknown, schema: string): void {
  const beats = array(value, schema, 'beats');
  const seen = new Set<string>();
  for (const [index, item] of beats.entries()) {
    const beat = record(item, `${schema}.beats[${index}]`);
    const id = nonEmptyString(beat.id, schema, `beats[${index}].id`);
    if (seen.has(id)) fail(schema, `beats[${index}].id`, 'must be unique');
    seen.add(id);
    nonEmptyString(beat.intent, schema, `beats[${index}].intent`);
  }
}

function validateResolvedPlanBeats(value: unknown, schema: string): void {
  validatePlanBeats(value, schema);
  for (const [index, item] of (value as unknown[]).entries()) {
    const beat = item as Record<string, unknown>;
    field(beat.status, isBeatStatus, schema, `beats[${index}].status`);
    nullableField(beat.eventId, isEventId, schema, `beats[${index}].eventId`);
  }
}

function validatePlayEvent(value: unknown, schema: string): void {
  const event = record(value, `${schema}.events`);
  field(event.id, isEventId, schema, 'events.id');
  nullableNonEmptyString(event.beatId, schema, 'events.beatId');
  nonEmptyString(event.userInput, schema, 'events.userInput');
  nonEmptyString(event.assistantOutput, schema, 'events.assistantOutput');
}

/** 校验并返回 play document。 */
export function validatePlayDocument(value: unknown): PlayDocument {
  const object = record(value, 'PlayDocument');
  field(object.day, isDayId, 'PlayDocument', 'day');
  nonEmptyString(object.summary, 'PlayDocument', 'summary');
  idArray(object.eventIds, isEventId, 'PlayDocument', 'eventIds');
  return value as PlayDocument;
}

/** 校验并返回单个 play event。 */
export function validatePlayEventDocument(value: unknown): PlayEventDocument {
  const object = record(value, 'PlayEventDocument');
  field(object.id, isEventId, 'PlayEventDocument', 'id');
  nullableNonEmptyString(object.beatId, 'PlayEventDocument', 'beatId');
  nonEmptyString(object.userInput, 'PlayEventDocument', 'userInput');
  nonEmptyString(object.assistantOutput, 'PlayEventDocument', 'assistantOutput');
  literal(object.status, 'completed', 'PlayEventDocument', 'status');
  return value as PlayEventDocument;
}

/** 校验 transcript，且要求 sequence 从 1 严格递增。 */
export function validateTranscriptEntries(value: unknown): TranscriptEntry[] {
  const entries = array(value, 'TranscriptEntry[]', 'value');
  for (const [index, item] of entries.entries()) {
    const entry = record(item, `TranscriptEntry[${index}]`);
    literal(entry.sequence, index + 1, 'TranscriptEntry', `${index}.sequence`);
    field(entry.role, isTranscriptRole, 'TranscriptEntry', `${index}.role`);
    string(entry.text, 'TranscriptEntry', `${index}.text`);
    nullableNonEmptyString(entry.messageId, 'TranscriptEntry', `${index}.messageId`);
  }
  return value as TranscriptEntry[];
}

/** 校验并返回 settlement document。 */
export function validateSettlementDocument(value: unknown): SettlementDocument {
  const object = record(value, 'SettlementDocument');
  field(object.day, isDayId, 'SettlementDocument', 'day');
  nonEmptyString(object.summary, 'SettlementDocument', 'summary');
  field(object.settledAt, isIsoTimestamp, 'SettlementDocument', 'settledAt');
  return value as SettlementDocument;
}

/** 校验并返回 abandoned document。 */
export function validateAbandonedDocument(value: unknown): AbandonedDocument {
  const object = record(value, 'AbandonedDocument');
  field(object.day, isDayId, 'AbandonedDocument', 'day');
  field(object.abandonedAt, isIsoTimestamp, 'AbandonedDocument', 'abandonedAt');
  field(object.previousRevision, isDayRevisionId, 'AbandonedDocument', 'previousRevision');
  return value as AbandonedDocument;
}

/** 校验并返回 operation 元数据。 */
export function validateArchiveOperation(value: unknown): ArchiveOperation {
  const object = record(value, 'ArchiveOperation');
  literal(object.schemaVersion, 1, 'ArchiveOperation', 'schemaVersion');
  field(object.id, isOperationId, 'ArchiveOperation', 'id');
  field(object.type, isOperationType, 'ArchiveOperation', 'type');
  field(object.status, isOperationStatus, 'ArchiveOperation', 'status');
  nullableField(object.sessionOutcome, isSessionOutcome, 'ArchiveOperation', 'sessionOutcome');
  nonNegativeInteger(object.baseRevision, 'ArchiveOperation', 'baseRevision');
  nullableField(object.baseCommitId, isCommitId, 'ArchiveOperation', 'baseCommitId');
  nullableField(object.targetCommitId, isCommitId, 'ArchiveOperation', 'targetCommitId');
  field(object.createdAt, isIsoTimestamp, 'ArchiveOperation', 'createdAt');
  field(object.updatedAt, isIsoTimestamp, 'ArchiveOperation', 'updatedAt');
  if (object.error !== null) validateRuntimeError(object.error);
  return value as ArchiveOperation;
}

function validateDayHead(value: unknown, fieldName: string): DayHead {
  const object = record(value, `ArchiveCommit.${fieldName}`);
  field(object.revision, isDayRevisionId, 'ArchiveCommit', `${fieldName}.revision`);
  field(object.status, isDayRevisionStatus, 'ArchiveCommit', `${fieldName}.status`);
  return value as DayHead;
}

function validateActiveSessionReference(value: unknown): ActiveSessionReference {
  const object = record(value, 'ActiveSessionReference');
  field(object.operationId, isOperationId, 'ActiveSessionReference', 'operationId');
  field(object.kind, isSessionKind, 'ActiveSessionReference', 'kind');
  field(object.baseCommitId, isCommitId, 'ActiveSessionReference', 'baseCommitId');
  return value as ActiveSessionReference;
}

function validateRuntimeError(value: unknown): RuntimeError {
  const object = record(value, 'RuntimeError');
  field(object.code, isRuntimeErrorCode, 'RuntimeError', 'code');
  nonEmptyString(object.message, 'RuntimeError', 'message');
  if (object.details !== undefined && !isJsonValue(object.details)) {
    fail('RuntimeError', 'details', 'must be JSON serializable');
  }
  return value as RuntimeError;
}

function record(value: unknown, schema: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    fail(schema, 'value', 'must be an object');
  }
  return value as Record<string, unknown>;
}

function array(value: unknown, schema: string, fieldName: string): unknown[] {
  if (!Array.isArray(value)) fail(schema, fieldName, 'must be an array');
  return value;
}

function string(value: unknown, schema: string, fieldName: string): string {
  if (typeof value !== 'string') fail(schema, fieldName, 'must be a string');
  return value;
}

function nonEmptyString(value: unknown, schema: string, fieldName: string): string {
  const result = string(value, schema, fieldName);
  if (result.length === 0) fail(schema, fieldName, 'must not be empty');
  return result;
}

function nullableNonEmptyString(value: unknown, schema: string, fieldName: string): string | null {
  return value === null ? null : nonEmptyString(value, schema, fieldName);
}

function field<T>(
  value: unknown,
  predicate: (candidate: unknown) => candidate is T,
  schema: string,
  fieldName: string,
): T {
  if (!predicate(value)) fail(schema, fieldName, 'has an invalid value');
  return value;
}

function nullableField<T>(
  value: unknown,
  predicate: (candidate: unknown) => candidate is T,
  schema: string,
  fieldName: string,
): T | null {
  return value === null ? null : field(value, predicate, schema, fieldName);
}

function literal<T extends string | number>(
  value: unknown,
  expected: T,
  schema: string,
  fieldName: string,
): T {
  if (value !== expected) fail(schema, fieldName, `must equal ${String(expected)}`);
  return expected;
}

function positiveInteger(value: unknown, schema: string, fieldName: string): number {
  if (!Number.isInteger(value) || (value as number) < 1) fail(schema, fieldName, 'must be a positive integer');
  return value as number;
}

function nonNegativeInteger(value: unknown, schema: string, fieldName: string): number {
  if (!Number.isInteger(value) || (value as number) < 0) fail(schema, fieldName, 'must be a non-negative integer');
  return value as number;
}

function stringArray(value: unknown, schema: string, fieldName: string): string[] {
  const values = array(value, schema, fieldName);
  values.forEach((item, index) => nonEmptyString(item, schema, `${fieldName}[${index}]`));
  return values as string[];
}

function idArray<T extends string>(
  value: unknown,
  predicate: (candidate: unknown) => candidate is T,
  schema: string,
  fieldName: string,
): T[] {
  const values = array(value, schema, fieldName);
  values.forEach((item, index) => field(item, predicate, schema, `${fieldName}[${index}]`));
  return values as T[];
}

function isSafeStableId(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(value) && value !== '.' && value !== '..';
}

function hasPrefixedToken(value: unknown, prefix: string): value is string {
  return typeof value === 'string' && value.startsWith(prefix) && isSafeStableId(value.slice(prefix.length));
}

function isPersistedPhase(value: unknown): value is WorldPhase {
  return value === 'idle' || value === 'planning' || value === 'planned' || value === 'playing' ||
    value === 'awaiting-settle' || value === 'revising';
}

function isSessionKind(value: unknown): value is SessionKind {
  return value === 'init' || value === 'planning' || value === 'play' || value === 'revise';
}

function sessionKindForPersistedPhase(phase: WorldPhase): SessionKind | null {
  if (phase === 'planning') return 'planning';
  if (phase === 'playing') return 'play';
  if (phase === 'revising') return 'revise';
  return null;
}

function isDayRevisionStatus(value: unknown): value is DayRevisionStatus {
  return value === 'planned' || value === 'awaiting-settle' || value === 'settled' || value === 'abandoned';
}

function isBeatStatus(value: unknown): value is 'pending' | 'completed' | 'skipped' {
  return value === 'pending' || value === 'completed' || value === 'skipped';
}

function isTranscriptRole(value: unknown): value is TranscriptEntry['role'] {
  return value === 'user' || value === 'assistant' || value === 'system';
}

function isOperationType(value: unknown): value is ArchiveOperationType {
  return value === 'init' || value === 'start-session' || value === 'submit-session' ||
    value === 'cancel-session' || value === 'settle-day' || value === 'abandon-day' ||
    value === 'recover-session';
}

function isOperationStatus(value: unknown): value is ArchiveOperation['status'] {
  return value === 'preparing' || value === 'prepared' || value === 'published' || value === 'failed';
}

function isSessionOutcome(value: unknown): value is NonNullable<ArchiveOperation['sessionOutcome']> {
  return value === 'active' || value === 'submitted' || value === 'cancelled' || value === 'interrupted';
}

function isJsonValue(value: unknown): boolean {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(isJsonValue);
  if (typeof value !== 'object') return false;
  return Object.values(value as Record<string, unknown>).every(isJsonValue);
}

function fail(schema: string, fieldName: string, message: string): never {
  throw new SchemaValidationError(schema, fieldName, message);
}
