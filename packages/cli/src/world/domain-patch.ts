import { parseStableEntityIdV1 } from './entity-id.js';
import { parseWorldVariableKeyV1 } from './variable-key.js';

export type ScalarV1 = string | number | boolean | null;

export type DomainPatchV1 =
  | { op: 'set-world-variable'; key: string; expected: ScalarV1; value: ScalarV1 }
  | { op: 'set-character-status'; characterId: string; expected: string; value: string }
  | { op: 'move-character'; characterId: string; expectedLocationId: string | null; locationId: string | null }
  | { op: 'set-location-status'; locationId: string; expected: string; value: string }
  | { op: 'set-arc-stage'; arcId: string; expected: string; value: string };

export function parseDomainPatchV1(value: unknown): DomainPatchV1 {
  if (!record(value) || typeof value.op !== 'string') throw new Error('DomainPatchV1 is invalid.');
  if (value.op === 'set-world-variable' && exact(value, ['op', 'key', 'expected', 'value']) && scalar(value.expected) && scalar(value.value)) {
    return { op: value.op, key: parseWorldVariableKeyV1(value.key, 'DomainPatchV1.key'), expected: value.expected, value: value.value };
  }
  if (value.op === 'set-character-status' && exact(value, ['op', 'characterId', 'expected', 'value']) && nonempty(value.expected) && nonempty(value.value)) {
    return { op: value.op, characterId: parseStableEntityIdV1(value.characterId, 'DomainPatchV1.characterId'), expected: value.expected, value: value.value };
  }
  if (value.op === 'move-character' && exact(value, ['op', 'characterId', 'expectedLocationId', 'locationId'])) {
    return {
      op: value.op,
      characterId: parseStableEntityIdV1(value.characterId, 'DomainPatchV1.characterId'),
      expectedLocationId: nullableStableEntityIdV1(value.expectedLocationId, 'DomainPatchV1.expectedLocationId'),
      locationId: nullableStableEntityIdV1(value.locationId, 'DomainPatchV1.locationId'),
    };
  }
  if (value.op === 'set-location-status' && exact(value, ['op', 'locationId', 'expected', 'value']) && nonempty(value.expected) && nonempty(value.value)) {
    return { op: value.op, locationId: parseStableEntityIdV1(value.locationId, 'DomainPatchV1.locationId'), expected: value.expected, value: value.value };
  }
  if (value.op === 'set-arc-stage' && exact(value, ['op', 'arcId', 'expected', 'value']) && nonempty(value.expected) && nonempty(value.value)) {
    return { op: value.op, arcId: parseStableEntityIdV1(value.arcId, 'DomainPatchV1.arcId'), expected: value.expected, value: value.value };
  }
  throw new Error('DomainPatchV1 is invalid.');
}

const record = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const exact = (value: Record<string, unknown>, keys: readonly string[]): boolean => Object.keys(value).length === keys.length && keys.every((key) => key in value);
const nonempty = (value: unknown): value is string => typeof value === 'string' && value.trim() !== '';
const nullableStableEntityIdV1 = (value: unknown, label: string): string | null => value === null ? null : parseStableEntityIdV1(value, label);
const scalar = (value: unknown): value is ScalarV1 => value === null || (['string', 'number', 'boolean'].includes(typeof value) && !(typeof value === 'number' && !Number.isFinite(value)));
