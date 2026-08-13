import path from 'node:path';
import {
  ARCHIVE_LAYOUT_V2,
  formatBlobObjectPathV1,
  formatCommitObjectPathV2,
  formatOperationPathV2,
  formatTreeObjectPathV1,
  parseWorldDocumentPathV1,
} from '@dayloom/archive-protocol';

export class ArchiveV2Paths {
  readonly root: string;
  constructor(root: string) { this.root = path.resolve(root); }
  resolve(relative: string): string {
    const target = path.resolve(this.root, ...relative.split('/'));
    if (target !== this.root && !target.startsWith(`${this.root}${path.sep}`)) throw new Error('Archive path escaped world root.');
    return target;
  }
  manifest(): string { return this.resolve(ARCHIVE_LAYOUT_V2.manifest); }
  current(): string { return this.resolve(ARCHIVE_LAYOUT_V2.current); }
  commits(): string { return this.resolve(ARCHIVE_LAYOUT_V2.commits); }
  trees(): string { return this.resolve(ARCHIVE_LAYOUT_V2.trees); }
  blobs(): string { return this.resolve(ARCHIVE_LAYOUT_V2.blobs); }
  operations(): string { return this.resolve(ARCHIVE_LAYOUT_V2.operations); }
  commit(id: string): string { return this.resolve(formatCommitObjectPathV2(id)); }
  tree(hash: string): string { return this.resolve(formatTreeObjectPathV1(hash)); }
  blob(hash: string): string { return this.resolve(formatBlobObjectPathV1(hash)); }
  operation(id: string): string { return path.dirname(this.resolve(formatOperationPathV2(id))); }
  operationMeta(id: string): string { return this.resolve(formatOperationPathV2(id)); }
  workspace(id: string): string { return path.join(this.operation(id), 'workspace'); }
  staging(id: string): string { return path.join(this.workspace(id), 'staging'); }
  stagingIndex(id: string): string { return path.join(this.staging(id), 'index.json'); }
  stagingFiles(id: string): string { return path.join(this.staging(id), 'files'); }
  stagingFile(id: string, fileId: string): string { return path.join(this.stagingFiles(id), safeId(fileId)); }
  stagedManifest(id: string): string { return path.join(this.workspace(id), 'manifest.json'); }
  session(id: string): string { return path.join(this.workspace(id), 'session.json'); }
  publishLock(): string { return this.resolve('.locks/publish.lock'); }
  sessionLock(): string { return this.resolve('.locks/session-claim.lock'); }
  operationLock(id: string): string { return path.join(this.operation(id), 'operation.lock'); }
  document(pathValue: string): string { return this.resolve(parseWorldDocumentPathV1(pathValue)); }
}
function safeId(value: string): string { if (!/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(value)) throw new Error('Unsafe opaque id.'); return value; }
