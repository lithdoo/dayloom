import fs from 'fs';
import path from 'path';
import type { SettlementProposal, WorldFileChange } from './types';

export function applySettlement(worldRoot: string, proposal: SettlementProposal, changes: WorldFileChange[], nextDay: string): void {
  const workRoot = path.join(worldRoot, '.loom', 'settle-transaction', proposal.day);
  const stagingRoot = path.join(workRoot, 'staged');
  const backupRoot = path.join(workRoot, 'before');
  const createdFiles: string[] = [];
  const committedFiles: string[] = [];
  fs.rmSync(workRoot, { recursive: true, force: true });

  try {
    for (const change of changes) {
      const target = path.join(worldRoot, change.relativePath);
      const staged = path.join(stagingRoot, change.relativePath);
      fs.mkdirSync(path.dirname(staged), { recursive: true });
      fs.writeFileSync(staged, change.content, 'utf8');
      if (fs.existsSync(target)) {
        const backup = path.join(backupRoot, change.relativePath);
        fs.mkdirSync(path.dirname(backup), { recursive: true });
        fs.copyFileSync(target, backup);
      } else createdFiles.push(change.relativePath);
    }

    const ordered = [...changes.filter(change => change.relativePath !== 'current.yaml'), ...changes.filter(change => change.relativePath === 'current.yaml')];
    for (const change of ordered) {
      commitFile(stagingRoot, worldRoot, change.relativePath);
      committedFiles.push(change.relativePath);
    }
  } catch (error) {
    rollback(worldRoot, backupRoot, committedFiles, new Set(createdFiles));
    throw error;
  } finally {
    fs.rmSync(workRoot, { recursive: true, force: true });
  }
}

function commitFile(stagingRoot: string, worldRoot: string, relativePath: string): void {
  const staged = path.join(stagingRoot, relativePath);
  const target = path.join(worldRoot, relativePath);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.renameSync(staged, target);
}

function rollback(worldRoot: string, backupRoot: string, committedFiles: string[], createdFiles: Set<string>): void {
  for (const relativePath of committedFiles.reverse()) {
    const target = path.join(worldRoot, relativePath);
    if (createdFiles.has(relativePath)) fs.rmSync(target, { force: true });
    else fs.copyFileSync(path.join(backupRoot, relativePath), target);
  }
}
