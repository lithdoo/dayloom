import { parseDocument } from 'yaml';
import { protocolError } from './errors';
export const ARCHIVE_MEDIA_TYPES_V1 = ['text/markdown','text/plain','application/json','application/yaml'] as const;
export type ArchiveMediaTypeV1 = typeof ARCHIVE_MEDIA_TYPES_V1[number];
export function isArchiveMediaTypeV1(value: unknown): value is ArchiveMediaTypeV1 { return typeof value==='string' && (ARCHIVE_MEDIA_TYPES_V1 as readonly string[]).includes(value); }
export function parseArchiveMediaTypeV1(value: unknown): ArchiveMediaTypeV1 { if(!isArchiveMediaTypeV1(value)) protocolError('ARCHIVE_PROTOCOL_MEDIA_INVALID','Unsupported archive media type.'); return value; }
export function validateContentV1(bytes: Uint8Array, mediaType: unknown, expectedBytes=bytes.byteLength): void {
  const media=parseArchiveMediaTypeV1(mediaType);
  if(!Number.isSafeInteger(expectedBytes)||expectedBytes<0||bytes.byteLength!==expectedBytes) protocolError('ARCHIVE_PROTOCOL_MEDIA_INVALID','Content byte count does not match.',{expectedBytes,actualBytes:bytes.byteLength});
  let text: string; try { text=new TextDecoder('utf-8',{fatal:true}).decode(bytes); } catch { protocolError('ARCHIVE_PROTOCOL_MEDIA_INVALID','Content must be valid UTF-8.'); }
  try {
    if(media==='application/json') JSON.parse(text);
    if(media==='application/yaml') { const doc=parseDocument(text,{prettyErrors:false,strict:true,uniqueKeys:true}); if(doc.errors.length) throw doc.errors[0]; }
  } catch { protocolError('ARCHIVE_PROTOCOL_MEDIA_INVALID',`${media} content has invalid syntax.`); }
}
