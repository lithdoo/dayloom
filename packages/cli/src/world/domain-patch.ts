export type ScalarV1 = string | number | boolean | null;

export type DomainPatchV1 =
  | { op: 'set-world-variable'; key: string; expected: ScalarV1; value: ScalarV1 }
  | { op: 'set-character-status'; characterId: string; expected: string; value: string }
  | { op: 'move-character'; characterId: string; expectedLocationId: string | null; locationId: string | null }
  | { op: 'set-location-status'; locationId: string; expected: string; value: string }
  | { op: 'set-arc-stage'; arcId: string; expected: string; value: string };

export function parseDomainPatchV1(value: unknown): DomainPatchV1 {
  if (!record(value) || typeof value.op !== 'string') throw new Error('DomainPatchV1 is invalid.');
  if (value.op === 'set-world-variable' && exact(value, ['op', 'key', 'expected', 'value']) && nonempty(value.key) && scalar(value.expected) && scalar(value.value)) {
    return { op: value.op, key: value.key, expected: value.expected, value: value.value };
  }
  if (value.op === 'set-character-status' && exact(value, ['op', 'characterId', 'expected', 'value']) && nonempty(value.characterId) && nonempty(value.expected) && nonempty(value.value)) {
    return { op: value.op, characterId: value.characterId, expected: value.expected, value: value.value };
  }
  if (value.op === 'move-character' && exact(value, ['op', 'characterId', 'expectedLocationId', 'locationId']) && nonempty(value.characterId) && nullable(value.expectedLocationId) && nullable(value.locationId)) {
    return { op: value.op, characterId: value.characterId, expectedLocationId: value.expectedLocationId, locationId: value.locationId };
  }
  if (value.op === 'set-location-status' && exact(value, ['op', 'locationId', 'expected', 'value']) && nonempty(value.locationId) && nonempty(value.expected) && nonempty(value.value)) {
    return { op: value.op, locationId: value.locationId, expected: value.expected, value: value.value };
  }
  if (value.op === 'set-arc-stage' && exact(value, ['op', 'arcId', 'expected', 'value']) && nonempty(value.arcId) && nonempty(value.expected) && nonempty(value.value)) {
    return { op: value.op, arcId: value.arcId, expected: value.expected, value: value.value };
  }
  throw new Error('DomainPatchV1 is invalid.');
}

const record = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const exact = (value: Record<string, unknown>, keys: readonly string[]): boolean => Object.keys(value).length === keys.length && keys.every((key) => key in value);
const nonempty = (value: unknown): value is string => typeof value === 'string' && value.trim() !== '';
const nullable = (value: unknown): value is string | null => value === null || nonempty(value);
const scalar = (value: unknown): value is ScalarV1 => value === null || (['string', 'number', 'boolean'].includes(typeof value) && !(typeof value === 'number' && !Number.isFinite(value)));
