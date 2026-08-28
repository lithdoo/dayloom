import { hashDigestV1, parseObjectIdV1 } from './common.js';

export const ARCHIVE_LAYOUT_V1 = Object.freeze({
  manifest: 'manifest.json',
  current: 'current.json',
  commits: 'commits/',
  blobs: 'objects/blobs/sha256/',
  trees: 'objects/trees/sha256/',
  operations: 'operations/',
  locks: '.locks/',
});

export function formatCommitPathV1(commitId: string): string {
  return `commits/${parseObjectIdV1(commitId, 'commit', 'commitId')}.json`;
}

export function formatBlobPathV1(hash: string): string {
  return `objects/blobs/sha256/${hashDigestV1(hash)}`;
}

export function formatTreePathV1(hash: string): string {
  return `objects/trees/sha256/${hashDigestV1(hash)}.json`;
}

export function formatOperationRootV1(operationId: string): string {
  return `operations/${parseObjectIdV1(operationId, 'op', 'operationId')}`;
}

export function formatOperationPathV1(operationId: string): string {
  return `${formatOperationRootV1(operationId)}/operation.json`;
}

export function formatPatchPathV1(operationId: string): string {
  return `${formatOperationRootV1(operationId)}/patch.json`;
}

export function formatDraftSnapshotPathV1(operationId: string): string {
  return `${formatOperationRootV1(operationId)}/draft-snapshot.json`;
}

export function formatDraftRootV1(operationId: string): string {
  return `${formatOperationRootV1(operationId)}/draft`;
}
