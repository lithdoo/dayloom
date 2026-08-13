import { protocolError } from './errors';

export type WorldDocumentPathV1 = string & { readonly __worldDocumentPathV1: unique symbol };
const WINDOWS_RESERVED = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i;
const INVALID_PORTABLE = /[<>:"|?*]/;

export function normalizeWorldDocumentPathV1(raw: string): WorldDocumentPathV1 {
  if (typeof raw !== 'string') protocolError('ARCHIVE_PROTOCOL_PATH_INVALID','World document path must be a string.');
  return validateCanonical(raw.normalize('NFC'));
}

export function parseWorldDocumentPathV1(raw: unknown): WorldDocumentPathV1 {
  if (typeof raw !== 'string' || raw !== raw.normalize('NFC')) protocolError('ARCHIVE_PROTOCOL_PATH_INVALID','Stored world document path must be an NFC string.');
  return validateCanonical(raw);
}

function validateCanonical(path: string): WorldDocumentPathV1 {
  if (!path || path.startsWith('/') || path.endsWith('/') || path.includes('\\') || path.includes('\0') || /[\x00-\x1f\x7f]/.test(path) || /^[A-Za-z]:/.test(path) || path.startsWith('//')) {
    protocolError('ARCHIVE_PROTOCOL_PATH_INVALID','World document path is not a portable relative path.',{path});
  }
  const segments=path.split('/');
  if (segments.some((s)=>!s || s==='.' || s==='..' || s.endsWith('.') || s.endsWith(' ') || INVALID_PORTABLE.test(s) || WINDOWS_RESERVED.test(s)) || segments[0].toLowerCase()==='.dayloom') {
    protocolError('ARCHIVE_PROTOCOL_PATH_INVALID','World document path contains an invalid segment.',{path});
  }
  return path as WorldDocumentPathV1;
}

export function compareWorldDocumentPathsV1(a: string,b: string): number {
  const left=Buffer.from(parseWorldDocumentPathV1(a),'utf8'); const right=Buffer.from(parseWorldDocumentPathV1(b),'utf8'); return Buffer.compare(left,right);
}
export function portableCollisionKeyV1(path: string): string { return parseWorldDocumentPathV1(path).normalize('NFC').toLowerCase(); }
