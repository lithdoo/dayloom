import type { ArchiveRepository } from '../archive';
import type { ArchiveV2Repository } from '../archive-v2';
import type { StateMachine } from '../domain/state-machine';
import type { RuntimeCommand, SessionKind, WorldSnapshot } from '../types';
import type { RuntimeClock } from '../infrastructure/clock';
import type { IdGenerator } from '../infrastructure/ids';
import type { CoreLogger } from '../infrastructure/logger';
import type { RuntimeError } from '../schemas/common';
import type { SessionSubmission } from '../schemas/submissions';
import type { SessionFactory, SessionManager } from '../sessions/session-manager';
import type { SessionWorkspace } from '../sessions/types';

export interface RuntimeSessionBoundary {
  /** Session 在正式发布前使用的隔离 workspace。 */
  readonly workspace: SessionWorkspace;
  /** 发布 Session phase 边界并返回 archive 对应的权威快照。 */
  publish(): Promise<WorldSnapshot>;
  /** 丢弃尚未发布的 operation/workspace。 */
  abort(error: RuntimeError): Promise<void>;
}

export interface RuntimeOperationRequest {
  operationId: string;
  previous: WorldSnapshot;
  target: WorldSnapshot;
}

/** Runtime 与 Stage 6 业务 Archive Operations 之间的端口。 */
export interface RuntimeOperations {
  prepareSessionStart(
    request: RuntimeOperationRequest & { command: 'init' | 'daily' | 'play' | 'revise'; kind: SessionKind },
  ): Promise<RuntimeSessionBoundary>;
  submitSession(
    request: RuntimeOperationRequest & { command: 'submit'; submission: SessionSubmission },
  ): Promise<WorldSnapshot>;
  cancelSession(
    request: RuntimeOperationRequest & { command: 'cancel' },
  ): Promise<WorldSnapshot>;
  executeStableCommand(
    request: RuntimeOperationRequest & { command: 'settle' | 'abandon-day' },
  ): Promise<WorldSnapshot>;
}

/** Dayloom Runtime 的创建参数。 */
export interface DayloomRuntimeOptions {
  worldRoot: string;
  sessionFactory: SessionFactory;
  operations?: RuntimeOperations;
  archiveRepository?: ArchiveRepository;
  /** Archive Protocol V2 repository. Providing the legacy repository keeps the compatibility runtime. */
  archiveV2Repository?: ArchiveV2Repository;
  stateMachine?: StateMachine;
  clock?: RuntimeClock;
  idGenerator?: IdGenerator;
  logger?: CoreLogger;
}

export interface RuntimeDependencies {
  stateMachine: StateMachine;
  sessionManager: SessionManager;
  archive: ArchiveRepository;
  operations: RuntimeOperations;
  clock: RuntimeClock;
  ids: IdGenerator;
  logger: CoreLogger;
}

export type SessionStartCommand = Extract<RuntimeCommand, 'init' | 'daily' | 'play' | 'revise'>;
