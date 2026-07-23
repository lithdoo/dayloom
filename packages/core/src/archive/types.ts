import type { CoreFileSystem } from '../infrastructure/filesystem';
import type { IdGenerator } from '../infrastructure/ids';
import type { CoreLogger } from '../infrastructure/logger';
import type { RuntimeClock } from '../infrastructure/clock';
import type {
  AbandonedDocument,
  ArchiveCommit,
  ArchiveManifest,
  ArchiveOperation,
  ArchiveOperationType,
  CurrentPointer,
  DayHead,
  DayRevisionMeta,
  PlanDocument,
  PlayDocument,
  PlayEventDocument,
  SettlementDocument,
} from '../schemas/archive';
import type { CommitId, JsonValue, RuntimeError } from '../schemas/common';
import type { CanonDocuments, TranscriptEntry } from '../schemas/submissions';
import type { SessionKind, WorldPhase } from '../domain/types';
import type { SessionWorkspace } from '../sessions/types';

/** 初始化 transaction 要发布的 world 身份。 */
export interface ManifestDraft {
  worldId: string;
  title: string;
}

/** 新 canon revision 的完整内容。 */
export interface CanonDraft {
  parentRevision: string | null;
  documents: CanonDocuments;
}

/** 新 day revision 的完整业务内容。 */
export interface DayDraft {
  day: string;
  parentRevision: string | null;
  status: DayRevisionMeta['status'];
  plan: PlanDocument;
  play?: PlayDocument;
  events?: PlayEventDocument[];
  transcript?: TranscriptEntry[];
  settlement?: SettlementDocument;
  abandoned?: AbandonedDocument;
}

/** commit 中 active Session 的 transaction 相对描述。 */
export interface CommitActiveSessionDraft {
  kind: SessionKind;
  baseCommitId: CommitId;
}

/** transaction 要发布的完整 commit 业务引用。 */
export interface CommitDraft {
  world: {
    phase: WorldPhase;
    day: string | null;
    lastSettledDay: string | null;
  };
  canonRevision: string | null;
  dayHeads: Record<string, DayHead>;
  activeSession: CommitActiveSessionDraft | null;
}

/** 成功读取的正式存档。 */
export interface ReadyArchive {
  status: 'ready';
  manifest: ArchiveManifest;
  pointer: CurrentPointer;
  commit: ArchiveCommit;
}

/** current 不存在时的稳定结果。 */
export interface UninitializedArchive {
  status: 'uninitialized';
}

/** current 或其引用不可信时的结构化结果。 */
export interface InvalidArchive {
  status: 'invalid';
  error: RuntimeError;
}

export type ArchiveReadResult = ReadyArchive | UninitializedArchive | InvalidArchive;

/** 完整不可变 canon revision 读取结果。 */
export interface CanonRevisionData {
  manifest: import('../schemas/archive').CanonRevisionManifest;
  documents: CanonDocuments;
}

/** 完整不可变 day revision 读取结果。 */
export interface DayRevisionData {
  meta: DayRevisionMeta;
  plan: PlanDocument;
  play: PlayDocument | null;
  events: PlayEventDocument[];
  transcript: TranscriptEntry[];
  settlement: SettlementDocument | null;
  abandoned: AbandonedDocument | null;
}

/** transaction 成功发布的事实结果。 */
export interface ArchivePublishResult {
  pointer: CurrentPointer;
  commit: ArchiveCommit;
  operation: ArchiveOperation;
}

/** 单个 operation 的只读诊断。 */
export interface ArchiveOperationInspection {
  id: string;
  operation: ArchiveOperation | null;
  error: RuntimeError | null;
}

/** 当前 archive 的引用图与 orphan 诊断。 */
export interface ArchiveInspection {
  current: ArchiveReadResult;
  operations: ArchiveOperationInspection[];
  reachableCommits: string[];
  reachableCanonRevisions: string[];
  reachableDayRevisions: string[];
  orphanCommits: string[];
  orphanCanonRevisions: string[];
  orphanDayRevisions: string[];
}

export interface GarbageCollectionOptions {
  /** true 才执行删除；默认只报告。 */
  delete?: boolean;
  /** 终态 operation workspace 的保留时间；默认七天。 */
  operationRetentionMs?: number;
}

export interface GarbageCollectionResult {
  deleted: string[];
  candidates: string[];
}

/** ArchiveRepository 的依赖。 */
export interface ArchiveRepositoryOptions {
  worldRoot: string;
  filesystem?: CoreFileSystem;
  clock?: RuntimeClock;
  ids?: IdGenerator;
  logger?: CoreLogger;
  lockStaleAfterMs?: number;
}

/** 隔离的 archive transaction。 */
export interface ArchiveTransaction {
  readonly operationId: string;
  readonly base: CurrentPointer | null;
  readonly workspace: SessionWorkspace;
  stageManifest(value: ManifestDraft): Promise<void>;
  stageCanon(value: CanonDraft): Promise<string>;
  stageDay(value: DayDraft): Promise<string>;
  stageCommit(value: CommitDraft): Promise<string>;
  publish(): Promise<ArchivePublishResult>;
  abort(error?: RuntimeError): Promise<void>;
}

/** 新存档格式的唯一正式读写入口。 */
export interface ArchiveRepository {
  readCurrent(): Promise<ArchiveReadResult>;
  readCommit(commitId: string): Promise<ArchiveCommit>;
  readCanonRevision(revision: string): Promise<CanonRevisionData>;
  readDayRevision(day: string, revision: string): Promise<DayRevisionData>;
  beginOperation(type: ArchiveOperationType, operationId?: string): Promise<ArchiveTransaction>;
  inspect(): Promise<ArchiveInspection>;
  recoverInterruptedSession(): Promise<ArchivePublishResult>;
  collectGarbage(options?: GarbageCollectionOptions): Promise<GarbageCollectionResult>;
}

/** JSON 文件的安全结构化诊断字段。 */
export type ArchiveErrorDetails = Record<string, JsonValue>;
