import type { CanonDraft } from '../../archive';
import type { CanonDocuments } from '../../schemas/submissions';

export function canonRevisionDraft(
  documents: CanonDocuments,
  parentRevision: string | null,
): CanonDraft {
  return { documents, parentRevision };
}
