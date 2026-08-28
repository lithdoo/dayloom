import YAML from 'yaml';
import type { ArchiveManifestV1, ArchiveMediaTypeV1 } from '@dayloom/archive-protocol';

export function decodeWorldTextV1(bytes: Uint8Array, path: string): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw new Error(`World document is not valid UTF-8: ${path}.`);
  }
}

export function validateWorldDocumentSyntaxV1(path: string, mediaType: ArchiveMediaTypeV1, bytes: Uint8Array): void {
  const text = decodeWorldTextV1(bytes, path);
  if (mediaType === 'application/json') {
    try { JSON.parse(text); } catch { throw new Error(`World JSON document is invalid: ${path}.`); }
  }
  if (mediaType === 'application/yaml') {
    try { YAML.parse(text); } catch { throw new Error(`World YAML document is invalid: ${path}.`); }
  }
}

export async function validateHeadIdentityDocumentsV1(input: {
  manifest: ArchiveManifestV1;
  readDocument(path: string): Promise<{ mediaType: ArchiveMediaTypeV1; bytes: Uint8Array }>;
}): Promise<{ title: string }> {
  const descriptorDocument = await input.readDocument('profile/dayloom.json');
  if (descriptorDocument.mediaType !== 'application/json') throw new Error('profile/dayloom.json has invalid media type.');
  let descriptor: unknown;
  try { descriptor = JSON.parse(decodeWorldTextV1(descriptorDocument.bytes, 'profile/dayloom.json')); } catch { throw new Error('profile/dayloom.json is invalid JSON.'); }
  if (
    typeof descriptor !== 'object' || descriptor === null || Array.isArray(descriptor) ||
    Object.keys(descriptor).length !== 3 ||
    (descriptor as any).schemaVersion !== 1 ||
    (descriptor as any).profile !== 'dayloom' ||
    (descriptor as any).profileVersion !== 1
  ) throw new Error('profile/dayloom.json is not the Dayloom profile descriptor.');

  const worldDocument = await input.readDocument('state/world.yaml');
  if (worldDocument.mediaType !== 'application/yaml') throw new Error('state/world.yaml has invalid media type.');
  const world = YAML.parse(decodeWorldTextV1(worldDocument.bytes, 'state/world.yaml')) as unknown;
  if (typeof world !== 'object' || world === null || Array.isArray(world)) throw new Error('state/world.yaml must be an object.');
  const keys = Object.keys(world as Record<string, unknown>);
  if (keys.length !== 3 || !keys.includes('schemaVersion') || !keys.includes('title') || !keys.includes('status')) {
    throw new Error('state/world.yaml has invalid fields.');
  }
  const value = world as Record<string, unknown>;
  if (value.schemaVersion !== 1 || typeof value.title !== 'string' || value.title.trim() === '' || typeof value.status !== 'string' || value.status.trim() === '') {
    throw new Error('state/world.yaml is invalid.');
  }
  const title = value.title.trim();
  if (title !== input.manifest.title) throw new Error('manifest.title does not match state/world.yaml.title.');
  return { title };
}
