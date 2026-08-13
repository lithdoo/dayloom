import { normalizeWorldDocumentPathV1 } from '@dayloom/archive-protocol';
import type { CoreSessionKindV1 } from './types';

export const DAYLOOM_CANON_PATHS = Object.freeze({
  premise: 'canon/premise.md', rules: 'canon/rules.md', style: 'canon/style.md', userRole: 'canon/user-role.md',
});
export function dayDocumentPath(day: string, name: 'plan' | 'play' | 'summary'): string {
  if (!/^day_[0-9]{4,}$/.test(day)) throw new Error('Invalid Dayloom day id.');
  return normalizeWorldDocumentPathV1(`days/${day}/${name}.md`);
}
export function requiredDocumentsFor(kind: CoreSessionKindV1, day: string | null): readonly string[] {
  if (kind === 'init') return Object.values(DAYLOOM_CANON_PATHS);
  if (!day) throw new Error(`${kind} requires a day.`);
  if (kind === 'planning') return [dayDocumentPath(day, 'plan')];
  if (kind === 'play') return [dayDocumentPath(day, 'play'), dayDocumentPath(day, 'summary')];
  return [];
}
export function assertDayloomMutationAllowed(path: string, publishedPaths: ReadonlySet<string>, operationType: string): string {
  const canonical = normalizeWorldDocumentPathV1(path);
  if (!/^(canon|characters|scenes|arcs|memory|custom|days)\//.test(canonical)) throw new Error('Path is outside the Dayloom World Profile.');
  if (/^days\/[^/]+\/(play|summary)\.md$/.test(canonical) && publishedPaths.has(canonical) && operationType !== 'revise') {
    throw new Error('Published historical play documents require an explicit revise operation.');
  }
  return canonical;
}
