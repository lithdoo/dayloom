import { lstat, readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { compareWorldDocumentPathsV1, parseWorldDocumentPathV1 } from '@dayloom/archive-protocol';
import { SESSION_FILE_LIMITS } from '../session/file-limits';
import { expectedMediaTypeV1 } from './profile/policy';
import type { WorldChange } from './publish';

export async function readCandidateWorkspaceV1(root: string): Promise<readonly Extract<WorldChange, { op: 'put' }>[]> {
  const resolvedRoot = path.resolve(root), changes: Extract<WorldChange, { op: 'put' }>[] = [];
  let total = 0;
  async function visit(directory: string): Promise<void> {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const target = path.join(directory, entry.name), relative = path.relative(resolvedRoot, target).split(path.sep).join('/');
      if (entry.isSymbolicLink() || relative.startsWith('../') || path.isAbsolute(relative)) throw new Error('Candidate contains an unsafe entry.');
      if (entry.isDirectory()) { await visit(target); continue; }
      const stat = await lstat(target);
      if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`Candidate entry must be a regular file: ${relative}`);
      const bytes = await readFile(target); total += bytes.byteLength;
      if (bytes.byteLength > SESSION_FILE_LIMITS.candidateMaxFileBytes) throw new Error(`Candidate file exceeds the byte limit: ${relative}`);
      changes.push({ op: 'put', path: parseWorldDocumentPathV1(relative), mediaType: expectedMediaTypeV1(relative), bytes });
    }
  }
  await visit(resolvedRoot);
  if (changes.length > SESSION_FILE_LIMITS.candidateMaxFiles || total > SESSION_FILE_LIMITS.candidateMaxTotalBytes) throw new Error('Candidate workspace exceeds its resource limits.');
  return Object.freeze(changes.sort((left, right) => compareWorldDocumentPathsV1(left.path, right.path)));
}
