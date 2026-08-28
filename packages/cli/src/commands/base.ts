import type { PublishedHeadV1 } from '../world/read.js';
import { cliErrorV1 } from '../cli/errors.js';

export function assertRequestedBaseV1(baseCommitId: string | null, head: PublishedHeadV1): void {
  if (baseCommitId !== null && baseCommitId !== head.commit.id) {
    throw cliErrorV1('WORLD_CONFLICT', 'Requested --base does not match the current published commit.', {
      requestedBaseCommitId: baseCommitId,
      currentCommitId: head.commit.id,
    });
  }
}
