import type { ParsedInvocationV1 } from '../cli/argv.js';
import { captureDraftInputV1 } from '../draft/snapshot.js';
import { lintCapturedDraftV1 } from '../draft/lint.js';
import type { PublishedHeadV1 } from '../world/read.js';
import { assertRequestedBaseV1 } from './base.js';

export async function runDraftCheckV1(
  invocation: Readonly<ParsedInvocationV1>,
  head: PublishedHeadV1 | null,
): Promise<unknown> {
  if (head !== null) assertRequestedBaseV1(invocation.baseCommitId, head);
  const captured = await captureDraftInputV1(invocation);
  lintCapturedDraftV1(captured);
  return {
    mode: 'checked',
    baseCommitId: head?.commit.id ?? null,
    draftSnapshotHash: captured.hash,
    draftMode: captured.snapshot.mode,
    draftFiles: captured.snapshot.entries.length,
    draftBytes: captured.totalBytes,
  };
}
