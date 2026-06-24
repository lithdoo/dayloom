import fs from 'fs';
import path from 'path';
import type { ReviseDraft, RevisePayload, WorldFileChange } from './types';

export interface RevisionArtifacts {
  diff?: string;
  draft?: ReviseDraft;
  transcript?: string;
}

export function describeChanges(worldRoot: string, changes: WorldFileChange[]): string {
  return changes.map(change => {
    const action = fs.existsSync(path.join(worldRoot, change.relativePath)) ? 'update' : 'create';
    return `${action} ${change.relativePath}`;
  }).join('\n');
}

export function applyChanges(worldRoot: string, payload: RevisePayload, changes: WorldFileChange[], now: Date = new Date(), artifacts: RevisionArtifacts = {}): string {
  const revisionId = `revision_${formatRevisionTimestamp(now)}`;
  const revisionRoot = path.join(worldRoot, '.loom', 'revisions', revisionId);
  const beforeRoot = path.join(revisionRoot, 'before');
  const createdFiles: string[] = [];
  fs.mkdirSync(beforeRoot, { recursive: true });

  for (const change of changes) {
    const filePath = path.join(worldRoot, change.relativePath);
    if (fs.existsSync(filePath)) {
      const beforePath = path.join(beforeRoot, change.relativePath);
      fs.mkdirSync(path.dirname(beforePath), { recursive: true });
      fs.copyFileSync(filePath, beforePath);
    } else createdFiles.push(change.relativePath);
  }

  fs.writeFileSync(path.join(revisionRoot, 'payload.json'), `${JSON.stringify({ ...payload, created_files: createdFiles }, null, 2)}\n`, 'utf8');
  fs.writeFileSync(path.join(revisionRoot, 'changes.txt'), `${describeChanges(worldRoot, changes)}\n`, 'utf8');
  if (artifacts.diff !== undefined) fs.writeFileSync(path.join(revisionRoot, 'diff.patch'), artifacts.diff, 'utf8');
  if (artifacts.draft !== undefined) fs.writeFileSync(path.join(revisionRoot, 'draft.json'), `${JSON.stringify(artifacts.draft, null, 2)}\n`, 'utf8');
  if (artifacts.transcript !== undefined) {
    const transcriptDir = path.join(revisionRoot, 'transcript');
    fs.mkdirSync(transcriptDir, { recursive: true });
    fs.writeFileSync(path.join(transcriptDir, 'dialogue.md'), artifacts.transcript, 'utf8');
  }

  for (const change of changes) {
    const filePath = path.join(worldRoot, change.relativePath);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, change.content, 'utf8');
  }

  appendStateChange(worldRoot, { type: 'world_revision', revision: revisionId, summary: payload.summary, changed_files: changes.map(change => change.relativePath) });
  return revisionId;
}

function appendStateChange(worldRoot: string, entry: object): void {
  const logPath = path.join(worldRoot, 'logs', 'state_changes.jsonl');
  fs.mkdirSync(path.dirname(logPath), { recursive: true });
  fs.appendFileSync(logPath, `${JSON.stringify(entry)}\n`, 'utf8');
}

function formatRevisionTimestamp(date: Date): string {
  return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}
