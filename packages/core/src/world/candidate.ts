import { lstat, readFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  buildCandidateTreeV1, compareWorldDocumentPathsV1, createRootTreeV1, formatBlobObjectPathV1,
  hashBlobV1, hashRootTreeV1, parseArchiveCommitV2, parseArchiveManifestV2, parseStagingManifestV1,
  parseWorldDocumentPathV1, validateContentV1, type StagedChangeV1,
} from '@dayloom/archive-protocol';
import { SESSION_FILE_LIMITS } from '../session/file-limits';
import { sortDiagnosticsV1, type ValidationIssueV1 } from '../session/diagnostics';
import { createDocumentReaderV1, type VerifiedDocumentReaderV1 } from './profile/document-reader';
import { expectedMediaTypeV1 } from './profile/policy';
import { validatePublishedProfileFromReaderV1, type PublishedWorld } from './read';
import type { WorldChange } from './publish';

export type SessionCandidateKindV1 = 'init' | 'planning' | 'play' | 'revise';
export type CandidateControlV1 = { phase: 'idle' | 'planned' | 'awaiting-settle'; day: string | null; lastSettledDay: string | null };
export interface CandidateAssemblyV1 {
  readonly operationType: SessionCandidateKindV1;
  readonly tree: PublishedWorld['tree'];
  readonly reader: VerifiedDocumentReaderV1;
  readonly changes: readonly Extract<WorldChange, { op: 'put' }>[];
  readonly manifest: PublishedWorld['manifest'];
  readonly commit: PublishedWorld['commit'];
}
export type CandidateValidationResultV1 =
  | { readonly ok: true; readonly world: PublishedWorld }
  | { readonly ok: false; readonly diagnostics: readonly ValidationIssueV1[] };

const encoder = new TextEncoder();
const profileDescriptor = encoder.encode(`${JSON.stringify({ schemaVersion: 1, profile: 'dayloom', profileVersion: 1 }, null, 2)}\n`);

export async function assembleCandidateV1(input: {
  worldRoot: string;
  operationType: SessionCandidateKindV1;
  base: PublishedWorld | null;
  changes: readonly WorldChange[];
  control: CandidateControlV1;
  initialManifest?: { worldId: string; title: string };
  allowedRevisePaths?: ReadonlySet<string>;
}): Promise<CandidateAssemblyV1> {
  if ((input.operationType === 'init') !== (input.base === null) || (input.base === null) !== (input.initialManifest !== undefined)) throw new Error('Candidate base and initial manifest are inconsistent.');
  const supplied = input.operationType === 'init'
    ? [{ op: 'put' as const, path: 'profile/dayloom.json', mediaType: 'application/json' as const, bytes: profileDescriptor }, ...input.changes]
    : [...input.changes];
  if (supplied.length > SESSION_FILE_LIMITS.candidateMaxFiles) throw new Error('Candidate exceeds the file-count limit.');
  const paths = new Set<string>(), files = new Map<string, Extract<WorldChange, { op: 'put' }>>();
  let totalBytes = 0;
  for (const change of supplied) {
    if (change.op !== 'put') throw new Error('Session Candidate V1 does not allow delete changes.');
    const documentPath = assertSessionCandidatePathAllowedV1(input.operationType, change.path, input.control.day, input.allowedRevisePaths);
    if (paths.has(documentPath)) throw new Error(`Candidate path is duplicated: ${documentPath}`);
    paths.add(documentPath);
    if (change.mediaType !== expectedMediaTypeV1(documentPath)) throw new Error(`Candidate mediaType is invalid: ${documentPath}`);
    if (change.bytes.byteLength > SESSION_FILE_LIMITS.candidateMaxFileBytes) throw new Error(`Candidate file exceeds the byte limit: ${documentPath}`);
    totalBytes += change.bytes.byteLength;
    validateContentV1(change.bytes, change.mediaType);
    files.set(documentPath, { ...change, path: documentPath });
  }
  if (totalBytes > SESSION_FILE_LIMITS.candidateMaxTotalBytes) throw new Error('Candidate exceeds the total-byte limit.');
  assertRequiredOutputs(input.operationType, paths, input.control.day);

  const baseRevision = input.base?.commit.revision ?? 0, baseCommitId = input.base?.commit.id ?? null, baseRootTreeHash = input.base?.commit.rootTreeHash ?? null;
  const staged = [...files.values()].map((change, index): StagedChangeV1 => ({
    op: 'put', path: change.path, mediaType: change.mediaType, bytes: change.bytes.byteLength,
    sha256: hashBlobV1(change.bytes), fileId: `file_${String(index + 1).padStart(8, '0')}_${randomUUID().replaceAll('-', '')}`,
  })).sort((left, right) => compareWorldDocumentPathsV1(left.path, right.path));
  const staging = parseStagingManifestV1({ schemaVersion: 1, baseRevision, baseCommitId, baseRootTreeHash, changes: staged });
  const tree = buildCandidateTreeV1({ baseTree: input.base?.tree ?? createRootTreeV1([]), staging });
  const reader = createDocumentReaderV1(tree, async (entry) => {
    const overlay = files.get(entry.path);
    if (overlay && hashBlobV1(overlay.bytes) === entry.blobHash) return overlay.bytes;
    const relative = formatBlobObjectPathV1(entry.blobHash), target = path.join(input.worldRoot, ...relative.split('/'));
    const stat = await lstat(target);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`${relative} must be a regular file.`);
    return readFile(target);
  });
  const now = new Date().toISOString(), suffix = randomUUID().replaceAll('-', '');
  const manifest = input.base?.manifest ?? parseArchiveManifestV2({ schemaVersion: 2, worldId: input.initialManifest!.worldId, title: input.initialManifest!.title, createdAt: now });
  const commit = parseArchiveCommitV2({
    schemaVersion: 2, id: `commit_${suffix}`, revision: baseRevision + 1, parentCommitId: baseCommitId,
    operationId: `op_${suffix}`, createdAt: now, rootTreeHash: hashRootTreeV1(tree), control: input.control,
  });
  return Object.freeze({ operationType: input.operationType, tree, reader, changes: Object.freeze([...files.values()].sort((left, right) => compareWorldDocumentPathsV1(left.path, right.path))), manifest, commit });
}

export async function validateCandidateV1(candidate: CandidateAssemblyV1): Promise<CandidateValidationResultV1> {
  try {
    const world = await validatePublishedProfileFromReaderV1(candidate.manifest, candidate.commit, candidate.tree, candidate.reader);
    if (candidate.operationType === 'init' && world.profileV1.state.world.title.trim() !== candidate.manifest.title.trim()) throw new Error('Initial manifest title does not match state/world.yaml.');
    return Object.freeze({ ok: true, world });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Candidate validation failed.';
    return Object.freeze({ ok: false, diagnostics: sortDiagnosticsV1([Object.freeze({
      schemaVersion: 1 as const, stage: 'candidate' as const, severity: 'error' as const,
      code: candidateCode(message), path: pathFromMessage(message), constraint: message,
    })]) });
  }
}

export function assertSessionCandidatePathAllowedV1(operation: SessionCandidateKindV1, rawPath: string, day: string | null, allowedRevisePaths?: ReadonlySet<string>): string {
  const documentPath = parseWorldDocumentPathV1(rawPath);
  if (operation === 'init') {
    if (/^(?:profile\/dayloom\.json|canon\/(?:premise|rules|style|user-role)\.md|state\/(?:world|calendar|progress|variables)\.yaml|(?:characters|locations|arcs)\/index\.yaml|memory\/(?:short-term|long-term)\.md|memory\/(?:facts|unresolved-threads|important-events)\.yaml|story-seeds\/active\.yaml)$/.test(documentPath)) return documentPath;
    if (/^characters\/[a-z][a-z0-9-]*\/(?:profile|memory|timeline)\.md$/.test(documentPath) || /^characters\/[a-z][a-z0-9-]*\/(?:relationships|state)\.yaml$/.test(documentPath)) return documentPath;
    if (/^locations\/[a-z][a-z0-9-]*\/(?:profile|memory|timeline)\.md$/.test(documentPath) || /^locations\/[a-z][a-z0-9-]*\/(?:state|triggers)\.yaml$/.test(documentPath)) return documentPath;
    if (/^arcs\/[a-z][a-z0-9-]*\/(?:profile|timeline)\.md$/.test(documentPath) || /^arcs\/[a-z][a-z0-9-]*\/state\.yaml$/.test(documentPath)) return documentPath;
  }
  if (day !== null && operation === 'planning' && new RegExp(`^days/${escapeRegExp(day)}/(?:plan\\.json|timeline\\.md|dialogue/planning\\.md|events/index\\.yaml)$`).test(documentPath)) return documentPath;
  if (day !== null && operation === 'play' && (new RegExp(`^days/${escapeRegExp(day)}/(?:timeline\\.md|play-index\\.json|events/index\\.yaml)$`).test(documentPath) || new RegExp(`^days/${escapeRegExp(day)}/events/event[1-9][0-9]*/(?:event|result|state-patch)\\.yaml$`).test(documentPath) || new RegExp(`^days/${escapeRegExp(day)}/events/event[1-9][0-9]*/(?:scene|dialogue|user-action)\\.md$`).test(documentPath))) return documentPath;
  if (operation === 'revise' && allowedRevisePaths?.has(documentPath) && /^(?:canon\/(?:premise|rules|style|user-role)\.md|state\/(?:progress|variables)\.yaml|(?:characters|locations|arcs)\/(?:index\.yaml|[a-z][a-z0-9-]*\/(?:profile|memory|timeline)\.md)|(?:characters|locations|arcs)\/[a-z][a-z0-9-]*\/(?:relationships|state|triggers)\.yaml|story-seeds\/active\.yaml)$/.test(documentPath)) return documentPath;
  throw new Error(`${operation} Candidate cannot put World document: ${documentPath}`);
}

function assertRequiredOutputs(operation: SessionCandidateKindV1, paths: ReadonlySet<string>, day: string | null): void {
  let required: string[] = [];
  if (operation === 'init') required = ['profile/dayloom.json', 'canon/premise.md', 'canon/rules.md', 'canon/style.md', 'canon/user-role.md', 'state/world.yaml', 'state/calendar.yaml', 'state/progress.yaml', 'state/variables.yaml', 'characters/index.yaml', 'locations/index.yaml', 'arcs/index.yaml', 'memory/short-term.md', 'memory/long-term.md', 'memory/facts.yaml', 'memory/unresolved-threads.yaml', 'memory/important-events.yaml', 'story-seeds/active.yaml'];
  if (operation === 'planning' && day !== null) required = [`days/${day}/plan.json`, `days/${day}/timeline.md`, `days/${day}/dialogue/planning.md`, `days/${day}/events/index.yaml`];
  if (operation === 'play' && day !== null) required = [`days/${day}/events/index.yaml`, `days/${day}/timeline.md`, `days/${day}/play-index.json`];
  const missing = required.filter((item) => !paths.has(item));
  if (missing.length > 0) throw new Error(`Candidate is missing required outputs: ${missing.join(', ')}`);
}

function candidateCode(message: string): string {
  if (/missing/i.test(message)) return 'CANDIDATE_MISSING_DOCUMENT';
  if (/reference|unknown/i.test(message)) return 'CANDIDATE_REFERENCE_INVALID';
  if (/mediaType/i.test(message)) return 'CANDIDATE_MEDIA_TYPE_INVALID';
  if (/yaml/i.test(message)) return 'CANDIDATE_YAML_INVALID';
  if (/json/i.test(message)) return 'CANDIDATE_JSON_INVALID';
  return 'CANDIDATE_PROFILE_INVALID';
}
function pathFromMessage(message: string): string | null { return /(?:missing|invalid): ([A-Za-z0-9._/-]+)/.exec(message)?.[1] ?? null; }
function escapeRegExp(value: string): string { return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
