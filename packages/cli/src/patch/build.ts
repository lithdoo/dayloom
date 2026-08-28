import {
  createDayloomPatchV1,
  type ArchiveMediaTypeV1,
  type DayloomCommandV1,
  type DayloomPatchChangeV1,
  type DayloomPatchV1,
  type RootTreeV1,
  type WorldControlV1,
} from '@dayloom/archive-protocol';
import type { ScannedWorkspaceV1 } from '../workspace/files.js';
import { assertPatchWritePolicyV1 } from '../world/write-policy.js';
import { cliErrorV1 } from '../cli/errors.js';

export function diffTreesV1(base: RootTreeV1 | null, target: RootTreeV1): readonly DayloomPatchChangeV1[] {
  const before = new Map((base?.entries ?? []).map((entry) => [entry.path, entry.blobHash] as const));
  const after = new Map(target.entries.map((entry) => [entry.path, entry.blobHash] as const));
  const paths = [...new Set([...before.keys(), ...after.keys()])].sort();
  return Object.freeze(paths.flatMap((path) => {
    const beforeBlobHash = before.get(path) ?? null;
    const afterBlobHash = after.get(path) ?? null;
    if (beforeBlobHash === afterBlobHash) return [];
    return [{ path, beforeBlobHash, afterBlobHash }];
  }));
}

export function buildPatchFromTargetTreeV1(input: {
  command: DayloomCommandV1;
  baseCommitId: string | null;
  baseTree: RootTreeV1 | null;
  targetTree: RootTreeV1;
  draftSnapshotHash: string | null;
  beforeControl: WorldControlV1 | null;
  afterControl: WorldControlV1;
}): Readonly<DayloomPatchV1> {
  try {
    const patch = createDayloomPatchV1({
      baseCommitId: input.baseCommitId,
      command: input.command,
      draftSnapshotHash: input.draftSnapshotHash,
      control: { before: input.beforeControl, after: input.afterControl },
      changes: diffTreesV1(input.baseTree, input.targetTree),
    });
    assertPatchWritePolicyV1(patch);
    return patch;
  } catch (error) {
    throw cliErrorV1('PATCH_INVALID', error instanceof Error ? error.message : 'Patch is invalid.');
  }
}

export function changedAfterFilesV1(
  patch: DayloomPatchV1,
  workspace: ScannedWorkspaceV1,
): ReadonlyMap<string, { mediaType: ArchiveMediaTypeV1; bytes: Uint8Array }> {
  const result = new Map<string, { mediaType: ArchiveMediaTypeV1; bytes: Uint8Array }>();
  for (const change of patch.changes) {
    if (change.afterBlobHash === null) continue;
    const file = workspace.files.get(change.path);
    if (!file || file.blobHash !== change.afterBlobHash) {
      throw cliErrorV1('PATCH_INVALID', `Workspace bytes do not match Patch after hash: ${change.path}.`);
    }
    result.set(change.path, { mediaType: file.mediaType, bytes: file.bytes });
  }
  return result;
}
