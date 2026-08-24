import { parseWorldDocumentPathV1, type ArchiveMediaTypeV1 } from '@dayloom/archive-protocol';

export type DayloomMutationType = 'init' | 'planning' | 'play' | 'revise' | 'settle' | 'abandon-day';

const BUSINESS_NAMESPACE = /^(?:profile|canon|state|characters|locations|arcs|memory|story-seeds|days|audit|custom)\//;
const CONTROL_PLANE = /^(?:manifest\.json|current\.json|commits(?:\/|$)|objects(?:\/|$)|operations(?:\/|$)|\.locks(?:\/|$)|logs(?:\/|$))/;

export function assertDayloomDocumentPathV1(rawPath: string): string {
  const documentPath = parseWorldDocumentPathV1(rawPath);
  if (CONTROL_PLANE.test(documentPath) || !BUSINESS_NAMESPACE.test(documentPath)) {
    throw new Error(`Path is outside the Dayloom World Profile: ${documentPath}`);
  }
  return documentPath;
}

export function expectedMediaTypeV1(documentPath: string): ArchiveMediaTypeV1 {
  const path = assertDayloomDocumentPathV1(documentPath);
  if (path.endsWith('.md')) return 'text/markdown';
  if (path.endsWith('.txt')) return 'text/plain';
  if (path.endsWith('.json')) return 'application/json';
  if (path.endsWith('.yaml')) return 'application/yaml';
  throw new Error(`Dayloom World document extension is unsupported: ${path}`);
}

export function assertMutationPathAllowedV1(operation: DayloomMutationType, rawPath: string): string {
  const documentPath = assertDayloomDocumentPathV1(rawPath);
  if (operation !== 'init' && documentPath.startsWith('profile/')) throw denied(operation, documentPath);
  if (operation === 'planning' && !/^days\/day[1-9][0-9]*\/(?:plan\.json|timeline\.md|dialogue\/planning\.md|events\/index\.yaml)$/.test(documentPath) && !documentPath.startsWith('audit/')) throw denied(operation, documentPath);
  if (operation === 'play' && !/^days\/day[1-9][0-9]*\/(?:play(?:-index)?\.json|summary\.md|timeline\.md|events\/)/.test(documentPath) && !documentPath.startsWith('audit/')) throw denied(operation, documentPath);
  if (operation === 'abandon-day' && !/^days\/day[1-9][0-9]*\//.test(documentPath)) throw denied(operation, documentPath);
  if (operation === 'settle' && (documentPath.startsWith('profile/') || documentPath.startsWith('canon/') || documentPath.startsWith('audit/'))) throw denied(operation, documentPath);
  if (operation === 'revise' && /^days\//.test(documentPath)) throw denied(operation, documentPath);
  return documentPath;
}

function denied(operation: DayloomMutationType, documentPath: string): Error {
  return new Error(`${operation} cannot mutate Dayloom World document: ${documentPath}`);
}
