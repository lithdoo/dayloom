import { lstat, readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import {
  hashBytesV1,
  hashDraftSnapshotV1,
  parseDraftSnapshotV1,
  type DraftSnapshotV1,
} from '@dayloom/archive-protocol';
import { cliErrorV1 } from '../cli/errors.js';

export interface CapturedDraftSnapshotV1 {
  snapshot: Readonly<DraftSnapshotV1>;
  files: ReadonlyMap<string, Uint8Array>;
  hash: string;
  totalBytes: number;
}

export async function captureDraftFilesV1(inputs: readonly string[]): Promise<CapturedDraftSnapshotV1> {
  if (inputs.length === 0) throw cliErrorV1('DRAFT_INVALID', 'At least one Draft file is required.');
  const files = new Map<string, Uint8Array>();
  const entries = [];
  for (let index = 0; index < inputs.length; index += 1) {
    const source = path.resolve(inputs[index]!);
    const stat = await safeLstatV1(source, `Draft file ${inputs[index]}`);
    if (!stat.isFile() || stat.isSymbolicLink()) throw cliErrorV1('DRAFT_INVALID', `Draft input must be a regular file: ${inputs[index]}.`);
    const bytes = await safeReadV1(source, `Draft file ${inputs[index]}`);
    const after = await safeLstatV1(source, `Draft file ${inputs[index]}`);
    if (!after.isFile() || after.isSymbolicLink() || after.size !== bytes.byteLength) throw cliErrorV1('DRAFT_INVALID', `Draft file changed while being snapshotted: ${inputs[index]}.`);
    const archivePath = `files/${String(index + 1).padStart(4, '0')}/${path.basename(source)}`;
    files.set(archivePath, bytes);
    entries.push({ order: index + 1, path: archivePath, bytes: bytes.byteLength, sha256: hashBytesV1(bytes) });
  }
  return finishV1('files', entries, files);
}

export async function captureDraftDirectoryV1(input: string): Promise<CapturedDraftSnapshotV1> {
  const root = path.resolve(input);
  const rootStat = await safeLstatV1(root, `Draft directory ${input}`);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) throw cliErrorV1('DRAFT_INVALID', `Draft directory must be a real directory: ${input}.`);

  const discovered: Array<{ relative: string; bytes: Uint8Array }> = [];
  const visit = async (directory: string, prefix: string): Promise<void> => {
    let entries;
    try { entries = await readdir(directory, { withFileTypes: true }); }
    catch (error) { throw cliErrorV1('DRAFT_INVALID', `Draft directory is unreadable: ${input}.`, undefined); }
    for (const entry of entries) {
      const relative = prefix === '' ? entry.name : `${prefix}/${entry.name}`;
      const target = path.join(directory, entry.name);
      const stat = await safeLstatV1(target, `Draft entry ${relative}`);
      if (stat.isSymbolicLink()) throw cliErrorV1('DRAFT_INVALID', `Draft directory contains a symbolic link: ${relative}.`);
      if (stat.isDirectory()) {
        await visit(target, relative);
        continue;
      }
      if (!stat.isFile()) throw cliErrorV1('DRAFT_INVALID', `Draft directory contains a special file: ${relative}.`);
      const bytes = await safeReadV1(target, `Draft entry ${relative}`);
      const after = await safeLstatV1(target, `Draft entry ${relative}`);
      if (!after.isFile() || after.isSymbolicLink() || after.size !== bytes.byteLength) throw cliErrorV1('DRAFT_INVALID', `Draft file changed while being snapshotted: ${relative}.`);
      discovered.push({ relative: relative.replaceAll('\\', '/'), bytes });
    }
  };
  await visit(root, '');
  discovered.sort((a, b) => a.relative.localeCompare(b.relative, 'en'));
  if (discovered.length === 0) throw cliErrorV1('DRAFT_INVALID', 'Draft directory must contain at least one regular file.');

  const files = new Map<string, Uint8Array>();
  const entries = discovered.map((file, index) => {
    const archivePath = `root/${file.relative}`;
    files.set(archivePath, file.bytes);
    return { order: index + 1, path: archivePath, bytes: file.bytes.byteLength, sha256: hashBytesV1(file.bytes) };
  });
  return finishV1('directory', entries, files);
}

export async function captureDraftInputV1(input: {
  drafts: readonly string[];
  draftDir: string | null;
}): Promise<CapturedDraftSnapshotV1> {
  if (input.draftDir !== null) return captureDraftDirectoryV1(input.draftDir);
  return captureDraftFilesV1(input.drafts);
}

function finishV1(
  mode: DraftSnapshotV1['mode'],
  entries: Array<{ order: number; path: string; bytes: number; sha256: string }>,
  files: Map<string, Uint8Array>,
): CapturedDraftSnapshotV1 {
  try {
    const snapshot = parseDraftSnapshotV1({ schemaVersion: 1, mode, entries });
    return Object.freeze({
      snapshot,
      files,
      hash: hashDraftSnapshotV1(snapshot),
      totalBytes: snapshot.entries.reduce((sum, entry) => sum + entry.bytes, 0),
    });
  } catch (error) {
    throw cliErrorV1('DRAFT_INVALID', error instanceof Error ? error.message : 'Draft snapshot is invalid.');
  }
}

async function safeLstatV1(target: string, label: string) {
  try { return await lstat(target); }
  catch { throw cliErrorV1('DRAFT_INVALID', `${label} does not exist or is unreadable.`); }
}

async function safeReadV1(target: string, label: string): Promise<Uint8Array> {
  try { return await readFile(target); }
  catch { throw cliErrorV1('DRAFT_INVALID', `${label} is unreadable.`); }
}
