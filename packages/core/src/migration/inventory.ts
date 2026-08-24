import { lstat, readFile, readdir, realpath } from 'node:fs/promises';
import path from 'node:path';
import { hashBlobV1 } from '@dayloom/archive-protocol';

export interface LegacyFileV1 { path: string; bytes: Uint8Array; text: string; sha256: string }

export async function inventoryLegacyWorldV1(source: string): Promise<readonly LegacyFileV1[]> {
  const root = await realpath(source), stat = await lstat(root);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('Legacy source must be a regular directory.');
  const files: LegacyFileV1[] = [];
  async function visit(directory: string, prefix: string): Promise<void> {
    const entries = await readdir(directory, { withFileTypes: true }); entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      const relative = prefix === '' ? entry.name : `${prefix}/${entry.name}`, target = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) throw new Error(`Legacy source contains a symbolic link: ${relative}`);
      if (entry.isDirectory()) { await visit(target, relative); continue; }
      if (!entry.isFile()) throw new Error(`Legacy source contains a non-regular file: ${relative}`);
      const bytes = await readFile(target); let text: string; try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch { throw new Error(`Legacy source file is not portable UTF-8 text: ${relative}`); }
      files.push(Object.freeze({ path: relative.replaceAll('\\', '/'), bytes, text, sha256: hashBlobV1(bytes) }));
    }
  }
  await visit(root, '');
  if (files.length === 0) throw new Error('Legacy source contains no regular files.');
  return Object.freeze(files);
}
