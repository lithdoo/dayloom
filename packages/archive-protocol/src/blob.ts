import { createHash } from 'node:crypto';
import { protocolError } from './errors';
export function hashBlobV1(bytes: Uint8Array): string { return createHash('sha256').update(bytes).digest('hex'); }
export function isBlobHashV1(value: unknown): value is string { return typeof value === 'string' && /^[0-9a-f]{64}$/.test(value); }
export function parseBlobHashV1(value: unknown, field='hash'): string { if(!isBlobHashV1(value)) protocolError('ARCHIVE_PROTOCOL_HASH_INVALID',`${field} must be a lowercase SHA-256 hash.`,{field}); return value; }
export function verifyBlobV1(bytes: Uint8Array, expectedHash: string, expectedBytes: number): void {
  parseBlobHashV1(expectedHash,'expectedHash');
  if(!Number.isSafeInteger(expectedBytes)||expectedBytes<0||bytes.byteLength!==expectedBytes||hashBlobV1(bytes)!==expectedHash) protocolError('ARCHIVE_PROTOCOL_HASH_INVALID','Blob bytes do not match the declared identity.',{expectedBytes,actualBytes:bytes.byteLength});
}
