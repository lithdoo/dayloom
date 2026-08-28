const STABLE_ENTITY_ID = /^[a-z][a-z0-9-]*$/;

export function parseStableEntityIdV1(value: unknown, label: string): string {
  if (typeof value !== 'string' || !STABLE_ENTITY_ID.test(value)) throw new Error(`${label} must be a stable entity identifier.`);
  return value;
}

export function isStableEntityIdV1(value: string): boolean {
  return STABLE_ENTITY_ID.test(value);
}
