import type { ParsedSessionCommand, SessionCommandSpec } from './types';

export function parseSessionCommand<T extends string>(
  input: string,
  specs: Array<SessionCommandSpec<T>>
): ParsedSessionCommand<T> {
  const trimmed = input.trim();
  if (!trimmed.startsWith('/')) return { kind: 'text', text: input };

  const raw = trimmed.split(/\s+/, 1)[0];
  const normalized = raw.toLowerCase();
  for (const spec of specs) {
    const names = [spec.name, ...(spec.aliases ?? [])].map(name => `/${name.toLowerCase()}`);
    if (names.includes(normalized)) return { kind: 'command', name: spec.name, raw };
  }
  return { kind: 'unknown', raw };
}
