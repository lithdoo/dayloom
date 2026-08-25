import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { ArchiveRetrievalError } from '../errors';
import { expectedMediaTypeV1 } from './profile/policy';
import { createVerifiedDocumentReaderV1 } from './profile/document-reader';
import type { PublishedWorld } from './read';

export const AI_VISIBLE_WORLD_NAMESPACES_V1 = Object.freeze([
  'canon/', 'state/', 'characters/', 'locations/', 'arcs/', 'memory/', 'story-seeds/', 'days/',
] as const);

export function isAiVisibleWorldPath(documentPath: string): boolean {
  return AI_VISIBLE_WORLD_NAMESPACES_V1.some((namespace) => documentPath.startsWith(namespace));
}

export interface ArchiveView {
  readonly root: string;
  readonly documentPaths: readonly string[];
}

export async function materializeArchiveView(input: {
  worldRoot: string;
  sessionRoot: string;
  world: PublishedWorld;
}): Promise<ArchiveView> {
  const root = path.join(input.sessionRoot, 'archive-view');
  await rm(root, { recursive: true, force: true });
  try {
    const reader = createVerifiedDocumentReaderV1(input.worldRoot, input.world.tree);
    const documentPaths = input.world.tree.entries
      .map((entry) => entry.path)
      .filter(isAiVisibleWorldPath)
      .sort((left, right) => left.localeCompare(right, 'en'));
    for (const documentPath of documentPaths) {
      const mediaType = expectedMediaTypeV1(documentPath);
      const bytes = await reader.bytes(documentPath, mediaType);
      new TextDecoder('utf-8', { fatal: true }).decode(bytes);
      const target = path.join(root, ...documentPath.split('/'));
      const relative = path.relative(root, target);
      if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error(`Archive view path escapes its root: ${documentPath}`);
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, bytes, { flag: 'wx' });
    }
    return Object.freeze({ root, documentPaths: Object.freeze(documentPaths) });
  } catch (error) {
    await rm(root, { recursive: true, force: true }).catch(() => undefined);
    throw new ArchiveRetrievalError('projection', 'Could not materialize the pinned Archive view.', { cause: error });
  }
}
