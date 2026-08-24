import type { SessionKind, WorldPhase } from '../domain/types';
import type {
  CanonRevisionId,
  CommitId,
  DayId,
  DayRevisionId,
  EventId,
  IsoTimestamp,
  OperationId,
  RuntimeError,
  WorldId,
} from './common';
import type { ResolvedPlanBeat, TranscriptEntry } from './submissions';

/** 当前存档格式版本。 */
export type ArchiveSchemaVersion = 1;

/** world 的稳定身份文件。 */
export interface ArchiveManifest {
  schemaVersion: ArchiveSchemaVersion;
  worldId: WorldId;
  title: string;
  createdAt: IsoTimestamp;
}

/** 唯一可变的正式 archive 入口指针。 */
export interface CurrentPointer {
  schemaVersion: ArchiveSchemaVersion;
  revision: number;
  commitId: CommitId;
  updatedAt: IsoTimestamp;
}

/** commit 内保存的 world 业务状态。 */
export interface CommitWorldState {
  phase: WorldPhase;
  day: DayId | null;
  lastSettledDay: DayId | null;
}

/** 某个 day 当前有效 revision。 */
export interface DayHead {
  revision: DayRevisionId;
  status: DayRevisionStatus;
}

/** 会话 phase 对应的恢复引用。 */
export interface ActiveSessionReference {
  operationId: OperationId;
  kind: SessionKind;
  baseCommitId: CommitId;
}

/** 不可变的完整业务引用快照。 */
export interface ArchiveCommit {
  schemaVersion: ArchiveSchemaVersion;
  id: CommitId;
  revision: number;
  parentCommitId: CommitId | null;
  operationId: OperationId;
  createdAt: IsoTimestamp;
  world: CommitWorldState;
  canonRevision: CanonRevisionId | null;
  dayHeads: Record<DayId, DayHead>;
  activeSession: ActiveSessionReference | null;
}

/** 不可变 canon revision 的索引。 */
export interface CanonRevisionManifest {
  id: CanonRevisionId;
  parentRevision: CanonRevisionId | null;
  operationId: OperationId;
  createdAt: IsoTimestamp;
  files: string[];
}

/** day revision 的业务状态。 */
export type DayRevisionStatus = 'planned' | 'awaiting-settle' | 'settled' | 'abandoned';

/** 不可变 day revision 的索引。 */
export interface DayRevisionMeta {
  day: DayId;
  revision: DayRevisionId;
  parentRevision: DayRevisionId | null;
  operationId: OperationId;
  status: DayRevisionStatus;
  createdAt: IsoTimestamp;
  files: string[];
}

/** day revision 中的计划文件。 */
export interface PlanDocument {
  day: DayId;
  intent: string;
  beats: ResolvedPlanBeat[];
}

/** day revision 中的 play 汇总文件。 */
export interface PlayDocument {
  day: DayId;
  summary: string;
  eventIds: EventId[];
}

/** day revision 中的单个完成事件。 */
export interface PlayEventDocument {
  id: EventId;
  beatId: string | null;
  userInput: string;
  assistantOutput: string;
  status: 'completed';
}

/** day revision 中的结算文件。 */
export interface SettlementDocument {
  day: DayId;
  summary: string;
  settledAt: IsoTimestamp;
}

/** day revision 中的放弃记录。 */
export interface AbandonedDocument {
  day: DayId;
  abandonedAt: IsoTimestamp;
  previousRevision: DayRevisionId;
}

/** archive operation 的业务类型。 */
export type ArchiveOperationType =
  | 'init'
  | 'start-session'
  | 'submit-session'
  | 'cancel-session'
  | 'settle-day'
  | 'abandon-day'
  | 'recover-session';

/** 隔离 workspace 中 operation 的诊断元数据。 */
export interface ArchiveOperation {
  schemaVersion: ArchiveSchemaVersion;
  id: OperationId;
  type: ArchiveOperationType;
  status: 'preparing' | 'prepared' | 'published' | 'failed';
  sessionOutcome: 'active' | 'submitted' | 'cancelled' | 'interrupted' | null;
  baseRevision: number;
  baseCommitId: CommitId | null;
  targetCommitId: CommitId | null;
  createdAt: IsoTimestamp;
  updatedAt: IsoTimestamp;
  error: RuntimeError | null;
}

export type { TranscriptEntry };
