import type {
  ArchiveCommitV2,
  ArchiveManifestV2,
  ArchiveMediaTypeV1,
  ArchiveOperationV2,
  CurrentPointerV2,
  PublishedWorldPhase,
  RootTreeV1,
  StagingManifestV1,
} from '@dayloom/archive-protocol';
import type { CoreFileSystem } from '../infrastructure/filesystem';
import type { RuntimeClock } from '../infrastructure/clock';
import type { IdGenerator } from '../infrastructure/ids';
import type { CoreLogger } from '../infrastructure/logger';

export type CoreSessionKindV1 = 'init' | 'planning' | 'play' | 'revise';
export type CoreSessionStatusV1 = 'active' | 'submitting' | 'completed' | 'cancelled' | 'interrupted';
export interface CoreSessionRecordV1 {
  schemaVersion: 1;
  sessionId: string;
  kind: CoreSessionKindV1;
  archiveOperationId: string;
  status: CoreSessionStatusV1;
  createdAt: string;
  updatedAt: string;
}

export type ArchiveV2ReadResult =
  | { status: 'uninitialized'; manifest: Readonly<ArchiveManifestV2> | null }
  | { status: 'ready'; manifest: Readonly<ArchiveManifestV2>; pointer: Readonly<CurrentPointerV2>; commit: Readonly<ArchiveCommitV2>; tree: Readonly<RootTreeV1> }
  | { status: 'invalid'; error: Error };

export interface BeginWorldOperationV2 { type: string; operationId?: string }
export interface PrepareWorldOperationV2 {
  phase: PublishedWorldPhase;
  day: string | null;
  lastSettledDay: string | null;
}
export interface ArchiveV2RepositoryOptions {
  worldRoot: string;
  filesystem?: CoreFileSystem;
  clock?: RuntimeClock;
  ids?: IdGenerator;
  logger?: CoreLogger;
  lockStaleAfterMs?: number;
}
export interface ArchiveV2Inspection {
  current: ArchiveV2ReadResult;
  operations: ReadonlyArray<{ id: string; operation: Readonly<ArchiveOperationV2> | null; error: Error | null }>;
  publishedCommits: string[];
  preparedCommits: string[];
  reachableTrees: string[];
  reachableBlobs: string[];
  orphanCommits: string[];
  orphanTrees: string[];
  orphanBlobs: string[];
}
export interface ArchiveV2GarbageCollectionResult { candidates: string[]; deleted: string[] }

export interface ArchiveV2Repository {
  readCurrent(): Promise<ArchiveV2ReadResult>;
  readPublishedDocument(path: string): Promise<Uint8Array | null>;
  listPublishedDocuments(): Promise<Readonly<RootTreeV1>['entries']>;
  beginWorldOperation(input: BeginWorldOperationV2): Promise<Readonly<ArchiveOperationV2>>;
  stageManifest(id: string, manifest: { worldId: string; title: string }): Promise<void>;
  readOperation(id: string): Promise<Readonly<ArchiveOperationV2>>;
  putDocument(id: string, path: string, bytes: Uint8Array, mediaType: ArchiveMediaTypeV1): Promise<Readonly<StagingManifestV1>>;
  deleteDocument(id: string, path: string): Promise<Readonly<StagingManifestV1>>;
  readEffectiveDocument(id: string, path: string): Promise<Uint8Array | null>;
  listEffectiveDocuments(id: string): Promise<Readonly<RootTreeV1>['entries']>;
  inspectStaging(id: string): Promise<Readonly<StagingManifestV1>>;
  prepare(id: string, control: PrepareWorldOperationV2): Promise<Readonly<ArchiveOperationV2>>;
  publish(id: string): Promise<ArchiveV2ReadResult>;
  abort(id: string, message?: string): Promise<Readonly<ArchiveOperationV2>>;
  createSession(input: { sessionId?: string; kind: CoreSessionKindV1; operationType?: string }): Promise<Readonly<CoreSessionRecordV1>>;
  readActiveSession(): Promise<Readonly<CoreSessionRecordV1> | null>;
  updateSessionStatus(id: string, status: CoreSessionStatusV1): Promise<Readonly<CoreSessionRecordV1>>;
  inspect(): Promise<ArchiveV2Inspection>;
  collectGarbage(options?: { delete?: boolean }): Promise<ArchiveV2GarbageCollectionResult>;
}
