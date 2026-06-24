import type { CanonSection, EntityMeta, RevisePayload } from './types';

const CANON_SECTIONS = new Set<CanonSection>(['premise', 'rules', 'style', 'user_role']);
const SNAKE_CASE = /^[a-z][a-z0-9_]*$/;

export function validateRevisePayload(payload: RevisePayload): void {
  if (!payload || typeof payload !== 'object') throw new Error('Revise payload must be an object');
  if (typeof payload.summary !== 'string' || !payload.summary.trim()) throw new Error('Revise payload summary must be a non-empty string');
  if (!Array.isArray(payload.operations) || payload.operations.length === 0) throw new Error('Revise payload operations must be a non-empty array');
  payload.operations.forEach((operation, index) => {
    if (!operation || typeof operation !== 'object') throw new Error(`Revise operation ${index} must be an object`);
    if (operation.op === 'replace_canon') {
      if (!CANON_SECTIONS.has(operation.section)) throw new Error(`Unsupported canon section in operation ${index}: ${String(operation.section)}`);
      assertNonEmpty(operation.content, `Revise operation ${index} content`);
      return;
    }
    if (operation.op === 'upsert_character' || operation.op === 'upsert_scene') {
      if (!SNAKE_CASE.test(operation.id)) throw new Error(`Invalid entity id in operation ${index}: ${String(operation.id)}`);
      assertNonEmpty(operation.profileMd, `Revise operation ${index} profileMd`);
      if (operation.op === 'upsert_character' && operation.relationshipsMd !== undefined) assertNonEmpty(operation.relationshipsMd, `Revise operation ${index} relationshipsMd`);
      validateMeta(operation.meta, index);
      return;
    }
    throw new Error(`Unsupported revise operation ${index}: ${String((operation as { op?: unknown }).op)}`);
  });
}

function assertNonEmpty(value: unknown, label: string): void {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} must be non-empty`);
}

function validateMeta(meta: EntityMeta | undefined, index: number): void {
  if (meta === undefined) return;
  if (!meta || typeof meta !== 'object' || Array.isArray(meta)) throw new Error(`Revise operation ${index} meta must be an object`);
  if (meta.status !== undefined) assertNonEmpty(meta.status, `Revise operation ${index} meta.status`);
  if (meta.tags !== undefined && (!Array.isArray(meta.tags) || meta.tags.some(tag => typeof tag !== 'string'))) throw new Error(`Revise operation ${index} meta.tags must be strings`);
}
