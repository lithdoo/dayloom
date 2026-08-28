const WORLD_VARIABLE_KEY = /^[A-Za-z][A-Za-z0-9_-]*$/;

export function parseWorldVariableKeyV1(value: unknown, label: string): string {
  if (typeof value !== 'string' || !WORLD_VARIABLE_KEY.test(value)) throw new Error(`${label} must be a valid World variable key.`);
  return value;
}
