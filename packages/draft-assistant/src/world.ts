import { lstat, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  ARCHIVE_LAYOUT_V1, decodeJsonV1, encodeArchiveCommitV1, encodeArchiveManifestV1,
  encodeCurrentPointerV1, encodeRootTreeCanonicalV1, formatBlobPathV1, formatCommitPathV1,
  formatTreePathV1, hashBytesV1, parseArchiveCommitV1, parseArchiveManifestV1,
  parseCurrentPointerV1, parseRootTreeV1, verifyCurrentPointerRelationV1,
  type ArchiveCommitV1, type ArchiveManifestV1, type CurrentPointerV1, type RootTreeV1,
} from '@dayloom/archive-protocol';
import { assistantErrorV1 } from './errors.js';
import type { AssistantCommandV1 } from './argv.js';

export interface PublishedHeadV1 {
  manifest: Readonly<ArchiveManifestV1>; current: Readonly<CurrentPointerV1>;
  commit: Readonly<ArchiveCommitV1>; tree: Readonly<RootTreeV1>;
}
export type ClassifiedWorldV1 = { status: 'uninitialized' } | { status: 'published'; head: PublishedHeadV1 } | { status: 'invalid'; reason: string };

const archivePathV1 = (root: string, relative: string) => path.join(root, ...relative.split('/'));
async function kindV1(target: string): Promise<'missing' | 'file' | 'directory' | 'other'> {
  try { const stat = await lstat(target); return stat.isFile() ? 'file' : stat.isDirectory() ? 'directory' : 'other'; }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return 'missing'; throw error; }
}
async function readCanonicalV1<T>(target: string, schema: string, parse: (value: unknown) => T, encode: (value: T) => Uint8Array): Promise<T> {
  let bytes: Uint8Array;
  try { bytes = await readFile(target); }
  catch { throw assistantErrorV1('WORLD_INVALID', `Missing or unreadable ${schema}.`); }
  const value = parse(decodeJsonV1(bytes, schema));
  if (!Buffer.from(bytes).equals(Buffer.from(encode(value)))) throw assistantErrorV1('WORLD_INVALID', `${schema} is not canonically encoded.`);
  return value;
}
export async function readPublishedHeadV1(worldRoot: string): Promise<PublishedHeadV1> {
  if (await kindV1(worldRoot) !== 'directory') throw assistantErrorV1('WORLD_INVALID', 'World root is not a directory.');
  const manifest = await readCanonicalV1(archivePathV1(worldRoot, ARCHIVE_LAYOUT_V1.manifest), 'manifest.json', parseArchiveManifestV1, encodeArchiveManifestV1);
  const current = await readCanonicalV1(archivePathV1(worldRoot, ARCHIVE_LAYOUT_V1.current), 'current.json', parseCurrentPointerV1, encodeCurrentPointerV1);
  const commit = await readCanonicalV1(archivePathV1(worldRoot, formatCommitPathV1(current.commitId)), `commit ${current.commitId}`, parseArchiveCommitV1, encodeArchiveCommitV1);
  const tree = await readCanonicalV1(archivePathV1(worldRoot, formatTreePathV1(commit.rootTreeHash)), `tree ${commit.rootTreeHash}`, parseRootTreeV1, encodeRootTreeCanonicalV1);
  verifyCurrentPointerRelationV1({ current, commit });
  return Object.freeze({ manifest, current, commit, tree });
}
export async function classifyWorldV1(worldRoot: string): Promise<ClassifiedWorldV1> {
  const rootKind = await kindV1(worldRoot);
  if (rootKind === 'missing') return { status: 'uninitialized' };
  if (rootKind !== 'directory') return { status: 'invalid', reason: 'World root is not a directory.' };
  const manifest = await kindV1(archivePathV1(worldRoot, ARCHIVE_LAYOUT_V1.manifest));
  const current = await kindV1(archivePathV1(worldRoot, ARCHIVE_LAYOUT_V1.current));
  if (manifest === 'missing' && current === 'missing') return { status: 'uninitialized' };
  if (manifest !== 'file' || current !== 'file') return { status: 'invalid', reason: 'World has an incomplete manifest/current pair.' };
  try { return { status: 'published', head: await readPublishedHeadV1(worldRoot) }; }
  catch (error) { return { status: 'invalid', reason: error instanceof Error ? error.message : 'World is invalid.' }; }
}
export function availableAssistantCommandsV1(head: PublishedHeadV1): readonly AssistantCommandV1[] {
  const phase = head.commit.control.phase;
  if (phase === 'idle') return Object.freeze(['plan', 'revise']);
  if (phase === 'planned') return Object.freeze(['play']);
  return Object.freeze([]);
}
export async function materializePublishedTreeV1(input: { worldRoot: string; tree: RootTreeV1; targetRoot: string }): Promise<void> {
  await rm(input.targetRoot, { recursive: true, force: true });
  await mkdir(input.targetRoot, { recursive: true });
  for (const entry of input.tree.entries) {
    const source = archivePathV1(input.worldRoot, formatBlobPathV1(entry.blobHash));
    const stat = await lstat(source).catch(() => null);
    if (!stat?.isFile() || stat.isSymbolicLink()) throw assistantErrorV1('WORLD_INVALID', `Archive blob is not a regular file: ${entry.path}.`);
    const bytes = await readFile(source);
    if (bytes.byteLength !== entry.bytes || hashBytesV1(bytes) !== entry.blobHash) throw assistantErrorV1('WORLD_INVALID', `Archive blob does not match tree entry: ${entry.path}.`);
    const target = path.join(input.targetRoot, ...entry.path.split('/'));
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, bytes, { flag: 'wx' });
  }
}
