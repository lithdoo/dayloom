import { lstat, readFile } from 'node:fs/promises';
import path from 'node:path';
import {
  formatBlobObjectPathV1, parseWorldDocumentPathV1, verifyBlobV1,
  type ArchiveMediaTypeV1, type DocumentTreeEntryV1, type RootTreeV1,
} from '@dayloom/archive-protocol';

export interface VerifiedDocumentReaderV1 {
  has(rawPath: string): boolean;
  entry(rawPath: string, expectedMediaType?: ArchiveMediaTypeV1): Readonly<DocumentTreeEntryV1>;
  bytes(rawPath: string, expectedMediaType?: ArchiveMediaTypeV1): Promise<Uint8Array>;
  text(rawPath: string, expectedMediaType?: ArchiveMediaTypeV1): Promise<string>;
  json(rawPath: string): Promise<unknown>;
}

export function createVerifiedDocumentReaderV1(root: string, tree: Readonly<RootTreeV1>): VerifiedDocumentReaderV1 {
  const entries = new Map(tree.entries.map((entry) => [entry.path, entry]));
  const entry = (rawPath: string, expectedMediaType?: ArchiveMediaTypeV1): Readonly<DocumentTreeEntryV1> => {
    const documentPath = parseWorldDocumentPathV1(rawPath);
    const value = entries.get(documentPath);
    if (!value) throw new Error(`Required World document is missing: ${documentPath}`);
    if (expectedMediaType !== undefined && value.mediaType !== expectedMediaType) throw new Error(`World document mediaType is invalid: ${documentPath}`);
    return value;
  };
  const bytes = async (rawPath: string, expectedMediaType?: ArchiveMediaTypeV1): Promise<Uint8Array> => {
    const value = entry(rawPath, expectedMediaType);
    const relative = formatBlobObjectPathV1(value.blobHash);
    const target = path.join(root, ...relative.split('/'));
    const stat = await lstat(target);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`${relative} must be a regular file.`);
    const content = await readFile(target);
    verifyBlobV1(content, value.blobHash, value.bytes);
    return content;
  };
  const text = async (rawPath: string, expectedMediaType?: ArchiveMediaTypeV1): Promise<string> => new TextDecoder('utf-8', { fatal: true }).decode(await bytes(rawPath, expectedMediaType));
  return Object.freeze({
    has: (rawPath: string) => entries.has(parseWorldDocumentPathV1(rawPath)),
    entry,
    bytes,
    text,
    json: async (rawPath: string) => JSON.parse(await text(rawPath, 'application/json')),
  });
}
