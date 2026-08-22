export const DAYLOOM_PROFILE_DESCRIPTOR_PATH = 'profile/dayloom.json';

export interface DayloomProfileDescriptorV1 {
  schemaVersion: 1;
  profile: 'dayloom';
  profileVersion: 1;
}

export function parseDayloomProfileDescriptorV1(value: unknown): Readonly<DayloomProfileDescriptorV1> {
  if (!isRecord(value) || !exactKeys(value, ['schemaVersion', 'profile', 'profileVersion'])) {
    throw new Error('DayloomProfileDescriptorV1 is invalid.');
  }
  if (value.schemaVersion !== 1 || value.profile !== 'dayloom' || value.profileVersion !== 1) {
    throw new Error('Dayloom Profile version is unsupported.');
  }
  return Object.freeze({ schemaVersion: 1, profile: 'dayloom', profileVersion: 1 });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).length === keys.length && keys.every((key) => key in value);
}
