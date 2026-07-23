import { randomUUID } from 'crypto';
import { createRuntimeError } from '../errors';
import type { CoreFileSystem } from '../infrastructure/filesystem';
import type { RuntimeClock } from '../infrastructure/clock';
import { encodeJson } from './atomic-file';

interface PublishLockRecord {
  ownerToken: string;
  pid: number;
  createdAt: string;
}

/** publish.lock 的持有句柄。 */
export interface PublishLockHandle {
  readonly ownerToken: string;
  release(): Promise<void>;
}

/** 获取 archive 独占发布锁；只回收已过期且 owner 不存活的锁。 */
export async function acquirePublishLock(options: {
  filesystem: CoreFileSystem;
  lockPath: string;
  clock: RuntimeClock;
  staleAfterMs: number;
}): Promise<PublishLockHandle> {
  const ownerToken = randomUUID();
  const record: PublishLockRecord = {
    ownerToken,
    pid: process.pid,
    createdAt: options.clock.now().toISOString(),
  };

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      await options.filesystem.writeText(
        options.lockPath,
        encodeJson(record),
        { overwrite: false, flush: true },
      );
      return {
        ownerToken,
        release: () => releasePublishLock(options.filesystem, options.lockPath, ownerToken),
      };
    } catch (error) {
      if (!isAlreadyExists(error)) throw error;
      const existing = await readLock(options.filesystem, options.lockPath);
      if (!canReclaim(existing, options.clock.now(), options.staleAfterMs)) {
        throw createRuntimeError('ARCHIVE_CONFLICT', 'Archive publish lock is already held.', {
          ownerPid: existing?.pid ?? null,
        });
      }
      await options.filesystem.remove(options.lockPath);
    }
  }
  throw createRuntimeError('ARCHIVE_CONFLICT', 'Could not acquire archive publish lock.');
}

async function releasePublishLock(
  filesystem: CoreFileSystem,
  lockPath: string,
  ownerToken: string,
): Promise<void> {
  const current = await readLock(filesystem, lockPath);
  if (current?.ownerToken === ownerToken) await filesystem.remove(lockPath);
}

async function readLock(filesystem: CoreFileSystem, lockPath: string): Promise<PublishLockRecord | null> {
  try {
    const value = JSON.parse(await filesystem.readText(lockPath)) as Partial<PublishLockRecord>;
    if (
      typeof value.ownerToken === 'string' &&
      typeof value.pid === 'number' &&
      typeof value.createdAt === 'string'
    ) {
      return value as PublishLockRecord;
    }
  } catch {
    return null;
  }
  return null;
}

function canReclaim(record: PublishLockRecord | null, now: Date, staleAfterMs: number): boolean {
  if (!record) return false;
  const age = now.getTime() - Date.parse(record.createdAt);
  return Number.isFinite(age) && age > staleAfterMs && !isProcessAlive(record.pid);
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error instanceof Error && 'code' in error && (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

function isAlreadyExists(error: unknown): boolean {
  return error instanceof Error && 'code' in error && (error as NodeJS.ErrnoException).code === 'EEXIST';
}
