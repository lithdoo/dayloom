import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import type { FileHashSnapshot, WorldFileChange } from './types';

export function snapshotChanges(worldRoot: string, changes: WorldFileChange[]): FileHashSnapshot[] {
  return changes.map(change => snapshotFile(worldRoot, change.relativePath));
}

export function assertSnapshotsUnchanged(worldRoot: string, snapshots: FileHashSnapshot[]): void {
  for (const expected of snapshots) {
    const current = snapshotFile(worldRoot, expected.relativePath);
    if (current.exists !== expected.exists || current.sha256 !== expected.sha256) {
      throw new Error(`Refusing to apply revision: file changed during review: ${expected.relativePath}`);
    }
  }
}

function snapshotFile(worldRoot: string, relativePath: string): FileHashSnapshot {
  const filePath = path.join(worldRoot, relativePath);
  if (!fs.existsSync(filePath)) return { relativePath, exists: false };
  return { relativePath, exists: true, sha256: crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex') };
}
