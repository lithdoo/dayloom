import { lstat, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  createRootTreeV1,
  expectedMediaTypeV1,
  formatBlobPathV1,
  hashBytesV1,
  parseWorldDocumentPathV1,
  type ArchiveMediaTypeV1,
  type RootTreeV1,
} from '@dayloom/archive-protocol';
import { cliErrorV1 } from '../cli/errors.js';
import { resolveArchivePathV1 } from '../world/read.js';
import { validateWorldDocumentSyntaxV1 } from '../world/profile.js';

export interface WorkspaceFileV1 {
  path: string;
  mediaType: ArchiveMediaTypeV1;
  bytes: Uint8Array;
  blobHash: string;
}

export interface ScannedWorkspaceV1 {
  files: ReadonlyMap<string, WorkspaceFileV1>;
  tree: Readonly<RootTreeV1>;
}

export async function materializeWorkspaceV1(input: {
  worldRoot: string;
  tree: RootTreeV1;
  workspaceRoot: string;
}): Promise<void> {
  await rm(input.workspaceRoot, { recursive: true, force: true });
  await mkdir(input.workspaceRoot, { recursive: true });
  for (const entry of input.tree.entries) {
    const source = resolveArchivePathV1(input.worldRoot, formatBlobPathV1(entry.blobHash));
    const stat = await lstat(source).catch(() => null);
    if (!stat?.isFile() || stat.isSymbolicLink()) throw cliErrorV1('WORLD_INVALID', `Archive blob is not a regular file: ${entry.path}.`);
    const bytes = await readFile(source);
    if (bytes.byteLength !== entry.bytes || hashBytesV1(bytes) !== entry.blobHash) throw cliErrorV1('WORLD_INVALID', `Archive blob does not match tree entry: ${entry.path}.`);
    const target = path.join(input.workspaceRoot, ...entry.path.split('/'));
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, bytes, { flag: 'wx' });
  }
  const scanned = await scanWorkspaceV1(input.workspaceRoot);
  if (JSON.stringify(scanned.tree) !== JSON.stringify(createRootTreeV1(input.tree.entries))) {
    throw cliErrorV1('WORLD_INVALID', 'Materialized Workspace does not equal pinned tree.');
  }
}

export async function scanWorkspaceV1(workspaceRoot: string): Promise<ScannedWorkspaceV1> {
  const rootStat = await lstat(workspaceRoot).catch(() => null);
  if (!rootStat?.isDirectory() || rootStat.isSymbolicLink()) throw cliErrorV1('VALIDATION_FAILED', 'Workspace root must be a real directory.');
  const files = new Map<string, WorkspaceFileV1>();

  const visit = async (directory: string, prefix: string): Promise<void> => {
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      const relative = prefix === '' ? entry.name : `${prefix}/${entry.name}`;
      const target = path.join(directory, entry.name);
      const stat = await lstat(target);
      if (stat.isSymbolicLink()) throw cliErrorV1('VALIDATION_FAILED', `Workspace contains a symbolic link: ${relative}.`);
      if (stat.isDirectory()) {
        await visit(target, relative);
        continue;
      }
      if (!stat.isFile()) throw cliErrorV1('VALIDATION_FAILED', `Workspace contains a special file: ${relative}.`);
      let documentPath: string;
      try { documentPath = parseWorldDocumentPathV1(relative); }
      catch (error) { throw cliErrorV1('VALIDATION_FAILED', error instanceof Error ? error.message : `Invalid Workspace path: ${relative}.`); }
      const mediaType = expectedMediaTypeV1(documentPath);
      const bytes = await readFile(target);
      try { validateWorldDocumentSyntaxV1(documentPath, mediaType, bytes); }
      catch (error) { throw cliErrorV1('VALIDATION_FAILED', error instanceof Error ? error.message : `Invalid World document: ${documentPath}.`); }
      files.set(documentPath, { path: documentPath, mediaType, bytes, blobHash: hashBytesV1(bytes) });
    }
  };
  await visit(workspaceRoot, '');
  const tree = createRootTreeV1([...files.values()].map((file) => ({
    path: file.path,
    blobHash: file.blobHash,
    mediaType: file.mediaType,
    bytes: file.bytes.byteLength,
  })));
  return Object.freeze({ files, tree });
}
