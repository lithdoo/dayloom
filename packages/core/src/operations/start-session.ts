import type { ArchiveRepository, ArchiveTransaction } from '../archive';
import type { RuntimeError } from '../schemas/common';
import type { RuntimeSessionBoundary, SessionStartCommand } from '../runtime/types';
import type { SessionKind, WorldSnapshot } from '../types';
import { createMemorySessionWorkspace } from '../sessions/session-workspace';
import { worldSnapshotFromPublish } from '../runtime/snapshot';
import { buildCommitDraft } from './builders/commit';
import { requireOperationBase } from './context';

export async function prepareSessionStart(input: {
  archive: ArchiveRepository;
  operationId: string;
  command: SessionStartCommand;
  kind: SessionKind;
  previous: WorldSnapshot;
  target: WorldSnapshot;
}): Promise<RuntimeSessionBoundary> {
  if (input.command === 'init') {
    return {
      workspace: createMemorySessionWorkspace(),
      publish: async () => ({ ...input.target }),
      abort: async () => {},
    };
  }
  const current = await requireOperationBase(input.archive, input.previous);
  const transaction = await input.archive.beginOperation('start-session', input.operationId);
  try {
    await transaction.stageCommit(buildCommitDraft({
      current: current.commit,
      target: input.target,
      activeSession: { kind: input.kind, baseCommitId: current.commit.id },
    }));
    return transactionBoundary(transaction, input.previous);
  } catch (error) {
    await transaction.abort();
    throw error;
  }
}

function transactionBoundary(
  transaction: ArchiveTransaction,
  previous: WorldSnapshot,
): RuntimeSessionBoundary {
  return {
    workspace: transaction.workspace,
    publish: async () => worldSnapshotFromPublish(previous, await transaction.publish()),
    abort: (error: RuntimeError) => transaction.abort(error),
  };
}
