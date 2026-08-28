import { failV1 } from './common.js';

const WORLD_ROOTS = new Set([
  'profile',
  'canon',
  'state',
  'characters',
  'locations',
  'arcs',
  'memory',
  'story-seeds',
  'days',
  'custom',
]);

export type ArchiveMediaTypeV1 =
  | 'text/markdown'
  | 'text/plain'
  | 'application/json'
  | 'application/yaml';

export function parseWorldDocumentPathV1(value: unknown): string {
  if (typeof value !== 'string' || value === '' || value.includes('\0') || value.includes('\\')) {
    failV1('ARCHIVE_PROTOCOL_PATH_INVALID', 'World document path is invalid.');
  }
  if (value.startsWith('/') || value.endsWith('/')) {
    failV1('ARCHIVE_PROTOCOL_PATH_INVALID', 'World document path must be relative and identify a file.');
  }
  const segments = value.split('/');
  if (segments.some((segment) => segment === '' || segment === '.' || segment === '..' || /[\u0000-\u001f]/.test(segment))) {
    failV1('ARCHIVE_PROTOCOL_PATH_INVALID', 'World document path contains an invalid segment.');
  }
  if (!WORLD_ROOTS.has(segments[0]!)) {
    failV1('ARCHIVE_PROTOCOL_PATH_INVALID', `World document path has unsupported root: ${segments[0]}.`);
  }
  return value;
}

export function compareWorldDocumentPathsV1(left: string, right: string): number {
  const a = parseWorldDocumentPathV1(left);
  const b = parseWorldDocumentPathV1(right);
  return a < b ? -1 : a > b ? 1 : 0;
}

export function portableCollisionKeyV1(value: string): string {
  return parseWorldDocumentPathV1(value).normalize('NFC').toLowerCase();
}

export function expectedMediaTypeV1(value: string): ArchiveMediaTypeV1 {
  const path = parseWorldDocumentPathV1(value);
  if (path.endsWith('.md')) return 'text/markdown';
  if (path.endsWith('.txt')) return 'text/plain';
  if (path.endsWith('.json')) return 'application/json';
  if (path.endsWith('.yaml')) return 'application/yaml';
  failV1('ARCHIVE_PROTOCOL_PATH_INVALID', `World document extension is unsupported: ${path}.`);
}

export function parseArchiveMediaTypeV1(value: unknown, path?: string): ArchiveMediaTypeV1 {
  if (value !== 'text/markdown' && value !== 'text/plain' && value !== 'application/json' && value !== 'application/yaml') {
    failV1('ARCHIVE_PROTOCOL_INVALID', 'Archive media type is invalid.');
  }
  if (path !== undefined && value !== expectedMediaTypeV1(path)) {
    failV1('ARCHIVE_PROTOCOL_INVALID', `Archive media type does not match path: ${path}.`);
  }
  return value;
}
