import { realpath } from 'node:fs/promises';
import {
  assertWorldAuthorityDisjointV1,
  resolveDraftInputsAuthorityV1,
  type ResolvedDraftInputsAuthorityV1,
} from '@dayloom/draft';

export interface ResolvedAssistantAuthorityV1 extends ResolvedDraftInputsAuthorityV1 {
  archiveRoot: string | null;
}

export async function resolveAssistantAuthorityV1(input: {
  cwd?: string;
  worldRoot: string | null;
  drafts: readonly string[];
  draftDir: string | null;
  conversation: string;
  llmConfig: string;
}): Promise<Readonly<ResolvedAssistantAuthorityV1>> {
  const authority = await resolveDraftInputsAuthorityV1(input);
  if (input.worldRoot === null) return Object.freeze({ ...authority, archiveRoot: null });
  const archiveRoot = await realpath(input.worldRoot);
  assertWorldAuthorityDisjointV1(archiveRoot, authority);
  return Object.freeze({ ...authority, archiveRoot });
}
