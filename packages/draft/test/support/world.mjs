import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  createDayloomPatchV1,
  createRootTreeV1,
  encodeArchiveCommitV1,
  encodeArchiveManifestV1,
  encodeArchiveOperationV1,
  encodeCurrentPointerV1,
  encodeDayloomPatchCanonicalV1,
  encodeDraftSnapshotCanonicalV1,
  encodeRootTreeCanonicalV1,
  expectedMediaTypeV1,
  formatBlobPathV1,
  formatCommitPathV1,
  formatDraftRootV1,
  formatDraftSnapshotPathV1,
  formatOperationPathV1,
  formatPatchPathV1,
  formatTreePathV1,
  hashBytesV1,
  hashDayloomPatchV1,
  hashDraftSnapshotV1,
  hashRootTreeV1,
  parseDraftSnapshotV1,
} from '@dayloom/archive-protocol';

const encoder = new TextEncoder();
const timestamp = '2026-08-28T00:00:00.000Z';

export function validWorldFiles(title, overrides = {}) {
  const text = {
    'profile/dayloom.json': '{"schemaVersion":1,"profile":"dayloom","profileVersion":1}\n',
    'canon/premise.md': '# Premise\n',
    'canon/rules.md': '# Rules\n',
    'canon/style.md': '# Style\n',
    'canon/user-role.md': '# User role\n',
    'characters/index.yaml': 'schemaVersion: 1\nids: []\n',
    'locations/index.yaml': 'schemaVersion: 1\nids: []\n',
    'arcs/index.yaml': 'schemaVersion: 1\nids: []\n',
    'state/world.yaml': `schemaVersion: 1\ntitle: ${title}\nstatus: active\n`,
    'state/calendar.yaml': 'schemaVersion: 1\ncurrentDay: null\nelapsed: null\n',
    'state/progress.yaml': 'schemaVersion: 1\nactiveArcIds: []\n',
    'state/variables.yaml': 'schemaVersion: 1\nvariables: {}\n',
    'memory/short-term.md': '# Short-term memory\n',
    'memory/long-term.md': '# Long-term memory\n',
    'memory/facts.yaml': 'schemaVersion: 1\nfacts: []\n',
    'memory/unresolved-threads.yaml': 'schemaVersion: 1\nthreads: []\n',
    'memory/important-events.yaml': 'schemaVersion: 1\nevents: []\n',
    'story-seeds/active.yaml': 'schemaVersion: 1\nseeds: []\n',
    ...overrides,
  };
  return new Map(Object.entries(text).map(([documentPath, value]) => [documentPath, encoder.encode(value)]));
}

export async function makePublishedWorld(root, control = { phase: 'idle', day: null, lastSettledDay: null }) {
  const files = validWorldFiles('Test World');
  const draftBytes = encoder.encode('# Init Draft\n');
  const tree = createRootTreeV1([...files].map(([documentPath, bytes]) => ({
    path: documentPath,
    blobHash: hashBytesV1(bytes),
    mediaType: expectedMediaTypeV1(documentPath),
    bytes: bytes.byteLength,
  })));
  const snapshot = parseDraftSnapshotV1({
    schemaVersion: 1,
    mode: 'files',
    entries: [{ order: 1, path: 'files/0001/init.md', bytes: draftBytes.byteLength, sha256: hashBytesV1(draftBytes) }],
  });
  const patch = createDayloomPatchV1({
    baseCommitId: null,
    command: 'init',
    draftSnapshotHash: hashDraftSnapshotV1(snapshot),
    control: { before: null, after: { phase: 'idle', day: null, lastSettledDay: null } },
    changes: tree.entries.map((entry) => ({ path: entry.path, beforeBlobHash: null, afterBlobHash: entry.blobHash })),
  });
  const operation = {
    schemaVersion: 1,
    id: 'op_11111111111111111111111111111111',
    command: 'init',
    patchHash: hashDayloomPatchV1(patch),
    createdAt: timestamp,
  };
  const commit = {
    schemaVersion: 1,
    id: 'commit_11111111111111111111111111111111',
    revision: 1,
    parentCommitId: null,
    operationId: operation.id,
    createdAt: timestamp,
    rootTreeHash: hashRootTreeV1(tree),
    control: patch.control.after,
  };
  const manifest = {
    schemaVersion: 1,
    worldId: 'world_11111111111111111111111111111111',
    title: 'Test World',
    createdAt: timestamp,
  };
  const current = {
    schemaVersion: 1,
    revision: 1,
    commitId: commit.id,
    updatedAt: timestamp,
  };

  await writeArchiveFile(root, 'manifest.json', encodeArchiveManifestV1(manifest));
  await writeArchiveFile(root, 'current.json', encodeCurrentPointerV1(current));
  for (const bytes of files.values()) await writeArchiveFile(root, formatBlobPathV1(hashBytesV1(bytes)), bytes);
  await writeArchiveFile(root, formatTreePathV1(commit.rootTreeHash), encodeRootTreeCanonicalV1(tree));
  await writeArchiveFile(root, formatCommitPathV1(commit.id), encodeArchiveCommitV1(commit));
  await writeArchiveFile(root, formatOperationPathV1(operation.id), encodeArchiveOperationV1(operation));
  await writeArchiveFile(root, formatPatchPathV1(operation.id), encodeDayloomPatchCanonicalV1(patch));
  await writeArchiveFile(root, formatDraftSnapshotPathV1(operation.id), encodeDraftSnapshotCanonicalV1(snapshot));
  await writeArchiveFile(root, `${formatDraftRootV1(operation.id)}/files/0001/init.md`, draftBytes);
  if (control.phase !== 'idle' || control.day !== null || control.lastSettledDay !== null) {
    await writeArchiveFile(root, formatCommitPathV1(commit.id), encodeArchiveCommitV1({ ...commit, control }));
  }
  return root;
}

async function writeArchiveFile(root, relative, bytes) {
  const target = path.join(root, ...relative.split('/'));
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, bytes);
}
