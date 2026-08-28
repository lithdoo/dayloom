import {
  buildTargetControlV1,
  createRootTreeV1,
  hashDayloomPatchV1,
} from '@dayloom/archive-protocol';
import type { ParsedInvocationV1 } from '../cli/argv.js';
import { buildPatchFromTargetTreeV1 } from '../patch/build.js';
import {
  assertPinnedWorldUnchangedV1,
  publishV1,
  validateArchivedTargetWorldV1,
  validatePreparedPublicationV1,
} from '../world/publish.js';
import type { PublishedHeadV1 } from '../world/read.js';
import { assertRequestedBaseV1 } from './base.js';

export async function runAbandonV1(
  worldRoot: string,
  invocation: Readonly<ParsedInvocationV1>,
  head: PublishedHeadV1,
): Promise<unknown> {
  assertRequestedBaseV1(invocation.baseCommitId, head);
  const day = head.commit.control.day;
  if (day === null) throw new Error('abandon requires a current day.');

  const targetTree = createRootTreeV1(
    head.tree.entries.filter((entry) => !entry.path.startsWith(`days/${day}/`)),
  );
  const patch = buildPatchFromTargetTreeV1({
    command: 'abandon',
    baseCommitId: head.commit.id,
    baseTree: head.tree,
    targetTree,
    draftSnapshotHash: null,
    beforeControl: head.commit.control,
    afterControl: buildTargetControlV1('abandon', head.commit.control),
  });
  const publication = {
    worldRoot,
    base: head,
    patch,
    targetTree,
    afterFiles: new Map(),
  };
  validatePreparedPublicationV1(publication);

  if (invocation.dryRun) {
    await validateArchivedTargetWorldV1(worldRoot, targetTree);
    await assertPinnedWorldUnchangedV1(worldRoot, head);
    return {
      mode: 'dry-run',
      baseCommitId: head.commit.id,
      patchHash: hashDayloomPatchV1(patch),
      patch,
      changedPaths: patch.changes.length,
      controlChanged: true,
    };
  }

  return publishV1(publication);
}
