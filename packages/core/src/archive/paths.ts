import path from 'path';
import {
  isCanonRevisionId,
  isCommitId,
  isDayId,
  isDayRevisionId,
  isOperationId,
} from '../schemas/validators';

/** 只通过已校验 id 构造 archive 路径。 */
export class ArchivePaths {
  constructor(readonly root: string) {}

  manifest(): string { return path.join(this.root, 'manifest.json'); }
  current(): string { return path.join(this.root, 'current.json'); }
  commits(): string { return path.join(this.root, 'commits'); }
  canon(): string { return path.join(this.root, 'canon'); }
  days(): string { return path.join(this.root, 'days'); }
  operations(): string { return path.join(this.root, 'operations'); }
  locks(): string { return path.join(this.root, '.locks'); }
  logs(): string { return path.join(this.root, 'logs'); }
  publishLock(): string { return path.join(this.locks(), 'publish.lock'); }
  operationLog(): string { return path.join(this.logs(), 'operations.jsonl'); }

  commit(id: string): string {
    requireId(id, isCommitId, 'commit');
    return path.join(this.commits(), `${id}.json`);
  }

  canonRevision(id: string): string {
    requireId(id, isCanonRevisionId, 'canon revision');
    return path.join(this.canon(), id);
  }

  day(day: string): string {
    requireId(day, isDayId, 'day');
    return path.join(this.days(), day);
  }

  dayRevision(day: string, revision: string): string {
    requireId(revision, isDayRevisionId, 'day revision');
    return path.join(this.day(day), 'revisions', revision);
  }

  operation(id: string): string {
    requireId(id, isOperationId, 'operation');
    return path.join(this.operations(), id);
  }

  operationMeta(id: string): string { return path.join(this.operation(id), 'operation.json'); }
  workspace(id: string): string { return path.join(this.operation(id), 'workspace'); }
}

function requireId<T extends string>(
  value: string,
  predicate: (candidate: unknown) => candidate is T,
  label: string,
): void {
  if (!predicate(value)) throw new Error(`Invalid ${label} id: ${value}`);
}
