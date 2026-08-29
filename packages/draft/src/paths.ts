import { lstatSync, realpathSync } from 'node:fs';
import path from 'node:path';

export function isPathInsideV1(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === ''
    || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

export function commonDirectoryAncestorV1(directories: readonly string[]): string {
  if (directories.length === 0) throw new Error('At least one directory is required.');
  let prefix = directories[0]!;
  for (const directory of directories.slice(1)) {
    while (prefix !== directory && !isPathInsideV1(prefix, directory)) {
      const parent = path.dirname(prefix);
      if (parent === prefix) throw new Error('Draft files do not share a common directory ancestor.');
      prefix = parent;
    }
  }
  return prefix;
}

export function normalizeRelativeRequestV1(requested: string): string {
  const normalized = requested.replaceAll('\\', '/');
  if (normalized === '.') return '.';
  if (
    normalized === '' ||
    path.isAbsolute(requested) ||
    path.isAbsolute(normalized) ||
    /^[A-Za-z]:/.test(normalized)
  ) {
    throw new Error('Path must be a relative path.');
  }
  const parts = normalized.split('/');
  if (parts.some((part) => part === '' || part === '.' || part === '..')) {
    throw new Error('Path must be a normalized relative path.');
  }
  return parts.join('/');
}

export function resolveRelativeInsideV1(root: string, requested: string): string {
  const relative = normalizeRelativeRequestV1(requested);
  if (relative === '.') return root;
  const absolute = path.resolve(root, ...relative.split('/'));
  if (!isPathInsideV1(root, absolute)) throw new Error('Path is outside the authority root.');
  return absolute;
}

export function canonicalizeExistingPrefixV1(absolute: string): string {
  try {
    return realpathSync(absolute);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }

  const missing: string[] = [];
  let current = absolute;
  for (;;) {
    const parent = path.dirname(current);
    if (parent === current) throw new Error(`Unable to canonicalize ${absolute}.`);
    missing.unshift(path.basename(current));
    current = parent;
    try {
      const existing = realpathSync(current);
      const kind = lstatSync(existing);
      if (!kind.isDirectory() || kind.isSymbolicLink()) throw new Error(`Unable to canonicalize ${absolute}.`);
      return missing.reduce((prefix, part) => path.join(prefix, part), existing);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }
}
