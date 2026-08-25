import { hostname } from 'node:os';
import { mkdir, open, readFile, rename, rm } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

export interface WorldRuntimeLockV1 { readonly instanceId: string; release(): Promise<void> }

export async function acquireWorldRuntimeLockV1(runtimeRoot: string): Promise<WorldRuntimeLockV1> {
  await mkdir(runtimeRoot, { recursive: true });
  const target = path.join(runtimeRoot, 'world.lock'), instanceId = `core_${randomUUID().replaceAll('-', '')}`;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const handle = await open(target, 'wx');
      try { await handle.writeFile(`${JSON.stringify({ schemaVersion: 1, instanceId, pid: process.pid, hostname: hostname(), createdAt: new Date().toISOString() }, null, 2)}\n`); await handle.sync(); }
      finally { await handle.close(); }
      return Object.freeze({ instanceId, async release() { try { const value = JSON.parse(await readFile(target, 'utf8')); if (value.instanceId === instanceId) await rm(target, { force: true }); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; } } });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST' || attempt > 0) throw error;
      const owner = JSON.parse(await readFile(target, 'utf8')) as { instanceId: string; pid: number; hostname: string };
      if (owner.hostname !== hostname() || alive(owner.pid)) throw Object.assign(new Error('Dayloom World already has an active Core writer.'), { code: 'WORLD_BUSY' });
      const stale = path.join(runtimeRoot, 'transient', 'stale-locks', `${Date.now()}-${owner.instanceId}.json`); await mkdir(path.dirname(stale), { recursive: true }); await rename(target, stale);
    }
  }
  throw Object.assign(new Error('Could not acquire the Dayloom World writer lock.'), { code: 'WORLD_BUSY' });
}

function alive(pid: number): boolean { if (!Number.isSafeInteger(pid) || pid <= 0) return false; try { process.kill(pid, 0); return true; } catch (error) { return (error as NodeJS.ErrnoException).code === 'EPERM'; } }
