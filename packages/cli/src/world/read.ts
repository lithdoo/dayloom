import { lstat, readFile } from 'node:fs/promises';
import path from 'node:path';
import {
  ARCHIVE_LAYOUT_V1,
  decodeJsonV1,
  encodeArchiveCommitV1,
  encodeArchiveManifestV1,
  encodeCurrentPointerV1,
  encodeRootTreeCanonicalV1,
  formatCommitPathV1,
  formatTreePathV1,
  parseArchiveCommitV1,
  parseArchiveManifestV1,
  parseCurrentPointerV1,
  parseRootTreeV1,
  verifyCurrentPointerRelationV1,
  type ArchiveCommitV1,
  type ArchiveManifestV1,
  type CurrentPointerV1,
  type RootTreeV1,
} from '@dayloom/archive-protocol';
import { CliErrorV1, cliErrorV1 } from '../cli/errors.js';

export interface PublishedHeadV1 {
  manifest: Readonly<ArchiveManifestV1>;
  current: Readonly<CurrentPointerV1>;
  commit: Readonly<ArchiveCommitV1>;
  tree: Readonly<RootTreeV1>;
}

export type ClassifiedWorldV1 =
  | { status: 'uninitialized' }
  | { status: 'published'; head: PublishedHeadV1 }
  | { status: 'invalid'; reason: string };

export function resolveArchivePathV1(worldRoot: string, archiveRelativePath: string): string {
  return path.join(worldRoot, ...archiveRelativePath.split('/'));
}

async function kindV1(target: string): Promise<'missing' | 'file' | 'directory' | 'other'> {
  try {
    const stat = await lstat(target);
    if (stat.isFile()) return 'file';
    if (stat.isDirectory()) return 'directory';
    return 'other';
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return 'missing';
    throw error;
  }
}

export async function pathExistsV1(target: string): Promise<boolean> {
  return (await kindV1(target)) !== 'missing';
}

export async function readCanonicalJsonFileV1<T>(input: {
  target: string;
  schema: string;
  parse(value: unknown): T;
  encode(value: T): Uint8Array;
}): Promise<{ value: T; bytes: Uint8Array }> {
  let bytes: Uint8Array;
  try {
    bytes = await readFile(input.target);
  } catch (error) {
    throw cliErrorV1('WORLD_INVALID', `Missing or unreadable ${input.schema}.`, { path: input.target });
  }
  const value = input.parse(decodeJsonV1(bytes, input.schema));
  const canonical = input.encode(value);
  if (!Buffer.from(bytes).equals(Buffer.from(canonical))) {
    throw cliErrorV1('WORLD_INVALID', `${input.schema} is not canonically encoded.`, { path: input.target });
  }
  return { value, bytes };
}

export async function readPublishedHeadV1(worldRoot: string): Promise<PublishedHeadV1> {
  const rootKind = await kindV1(worldRoot);
  if (rootKind !== 'directory') throw cliErrorV1('WORLD_INVALID', 'World root is not a directory.');

  const manifest = (await readCanonicalJsonFileV1({
    target: resolveArchivePathV1(worldRoot, ARCHIVE_LAYOUT_V1.manifest),
    schema: 'manifest.json',
    parse: parseArchiveManifestV1,
    encode: encodeArchiveManifestV1,
  })).value;
  const current = (await readCanonicalJsonFileV1({
    target: resolveArchivePathV1(worldRoot, ARCHIVE_LAYOUT_V1.current),
    schema: 'current.json',
    parse: parseCurrentPointerV1,
    encode: encodeCurrentPointerV1,
  })).value;
  const commit = (await readCanonicalJsonFileV1({
    target: resolveArchivePathV1(worldRoot, formatCommitPathV1(current.commitId)),
    schema: `commit ${current.commitId}`,
    parse: parseArchiveCommitV1,
    encode: encodeArchiveCommitV1,
  })).value;
  const tree = (await readCanonicalJsonFileV1({
    target: resolveArchivePathV1(worldRoot, formatTreePathV1(commit.rootTreeHash)),
    schema: `tree ${commit.rootTreeHash}`,
    parse: parseRootTreeV1,
    encode: encodeRootTreeCanonicalV1,
  })).value;
  verifyCurrentPointerRelationV1({ current, commit });
  return Object.freeze({ manifest, current, commit, tree });
}

export async function classifyWorldV1(worldRoot: string): Promise<ClassifiedWorldV1> {
  const rootKind = await kindV1(worldRoot);
  if (rootKind === 'missing') return { status: 'uninitialized' };
  if (rootKind !== 'directory') return { status: 'invalid', reason: 'World root is not a directory.' };

  const manifestKind = await kindV1(resolveArchivePathV1(worldRoot, ARCHIVE_LAYOUT_V1.manifest));
  const currentKind = await kindV1(resolveArchivePathV1(worldRoot, ARCHIVE_LAYOUT_V1.current));
  if (manifestKind === 'missing' && currentKind === 'missing') return { status: 'uninitialized' };
  if (manifestKind !== 'file' || currentKind !== 'file') return { status: 'invalid', reason: 'World has an incomplete manifest/current pair.' };

  try {
    return { status: 'published', head: await readPublishedHeadV1(worldRoot) };
  } catch (error) {
    const normalized = error instanceof CliErrorV1 ? error : cliErrorV1('WORLD_INVALID', error instanceof Error ? error.message : 'World is invalid.');
    return { status: 'invalid', reason: normalized.message };
  }
}
