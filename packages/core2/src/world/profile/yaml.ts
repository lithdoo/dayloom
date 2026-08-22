import { parseDocument } from 'yaml';

export function parseYamlObjectV1(text: string, schema: string): Record<string, unknown> {
  const document = parseDocument(text, { prettyErrors: false, strict: true, uniqueKeys: true });
  if (document.errors.length !== 0) throw new Error(`${schema} contains invalid YAML.`);
  let value: unknown;
  try { value = document.toJS({ maxAliasCount: 0 }); }
  catch { throw new Error(`${schema} contains invalid YAML.`); }
  if (!isRecord(value)) throw new Error(`${schema} must be a YAML object.`);
  return value;
}

export function exactObjectV1(value: Record<string, unknown>, keys: readonly string[], schema: string): void {
  const actual = Object.keys(value);
  if (actual.length !== keys.length || !keys.every((key) => key in value)) throw new Error(`${schema} has an invalid shape.`);
}

export function stringV1(value: unknown, schema: string, allowEmpty = false): string {
  if (typeof value !== 'string' || (!allowEmpty && value.trim() === '')) throw new Error(`${schema} must be ${allowEmpty ? 'a string' : 'a non-empty string'}.`);
  return value;
}

export function nullableStringV1(value: unknown, schema: string): string | null {
  return value === null ? null : stringV1(value, schema);
}

export function stringArrayV1(value: unknown, schema: string, unique = true): string[] {
  if (!Array.isArray(value)) throw new Error(`${schema} must be an array.`);
  const result = value.map((item, index) => stringV1(item, `${schema}[${index}]`));
  if (unique && new Set(result).size !== result.length) throw new Error(`${schema} must contain unique strings.`);
  return result;
}

export function schemaVersionV1(value: unknown, schema: string): void {
  if (value !== 1) throw new Error(`${schema}.schemaVersion must equal 1.`);
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
