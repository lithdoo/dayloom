import { mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { hashBlobV1 } from '@dayloom/archive-protocol';
import type { CoreSession } from './common';
import type { DraftHandleV1 } from './draft-store';
import { allocateSessionAssignmentV1, readHistoricalAssignmentIdsV1, type SessionAssignmentV1 } from './assignment';
import { SESSION_FILE_LIMITS } from './file-limits';
import { sortDiagnosticsV1, type ValidationIssueV1 } from './diagnostics';
import { assembleCandidateV1, validateCandidateV1, type CandidateControlV1 } from '../world/candidate';
import { readCandidateWorkspaceV1 } from '../world/candidate-workspace';
import type { PublishedWorld } from '../world/read';
import type { WorldChange } from '../world/publish';
import { buildSubmissionAuditV1, type SubmissionAuditInputV1 } from '../world/builders/audit';

export type SubmissionStageV1 = 'lint' | 'allocate' | 'convert' | 'validate' | 'repair' | 'review' | 'diff' | 'publish';
export interface SubmissionConversionInputV1 {
  readonly phase: 'convert' | 'repair'; readonly session: CoreSession; readonly draft: DraftHandleV1;
  readonly assignment: SessionAssignmentV1; readonly candidateRoot: string; readonly attempt: number;
  readonly diagnostics: readonly ValidationIssueV1[];
}
export interface SubmissionConverterV1 { run(input: SubmissionConversionInputV1): Promise<void> }
export interface SubmissionReviewV1 { readonly advisory: readonly ValidationIssueV1[]; readonly raw: unknown }
export interface SubmissionReviewerV1 { review(input: Omit<SubmissionConversionInputV1, 'phase' | 'attempt' | 'diagnostics'>): Promise<SubmissionReviewV1> }
export interface SubmissionPipelineResultV1 { readonly published: PublishedWorld; readonly diagnostics: readonly ValidationIssueV1[] }

export class SubmissionPipelineErrorV1 extends Error {
  constructor(readonly code: 'DRAFT_INVALID' | 'CONVERSION_FAILED' | 'CANDIDATE_INVALID', message: string, readonly diagnostics: readonly ValidationIssueV1[] = [], options?: ErrorOptions) { super(message, options); this.name = 'SubmissionPipelineErrorV1'; }
}

export async function runSubmissionPipelineV1(input: {
  worldRoot: string; transientRoot: string; session: CoreSession; draft: DraftHandleV1;
  converter: SubmissionConverterV1; reviewer: SubmissionReviewerV1;
  publish(operation: { operationType: CoreSession['kind']; base: PublishedWorld | null; initialManifest?: { worldId: string; title: string }; changes: readonly WorldChange[]; control: CandidateControlV1 }): Promise<PublishedWorld>;
  stage(stage: SubmissionStageV1, attempt: number): void;
}): Promise<SubmissionPipelineResultV1> {
  const candidateRoot = path.join(input.transientRoot, 'candidate', 'files');
  await rm(path.dirname(candidateRoot), { recursive: true, force: true }); await mkdir(candidateRoot, { recursive: true });
  try {
    input.stage('lint', 1); const lint = await input.draft.lint();
    if (!lint.ok) { await failDraft(input.draft, lint.diagnostics); throw new SubmissionPipelineErrorV1('DRAFT_INVALID', 'Draft 未通过提交前校验。', lint.diagnostics); }
    const unconfirmed = requiredConfirmationIssues(lint.draft);
    if (unconfirmed.length > 0) { await failDraft(input.draft, unconfirmed); throw new SubmissionPipelineErrorV1('DRAFT_INVALID', 'Draft 仍包含不能提交的未确认内容。', unconfirmed); }
    await input.draft.setStatus('submitting'); input.stage('allocate', 1);
    const reservedIds = await readHistoricalAssignmentIdsV1(input.worldRoot, input.session.pinned);
    const assignment = allocateSessionAssignmentV1(lint.draft, lint.contentHashes, input.session.pinned, reservedIds);
    input.stage('convert', 1);
    try { await input.converter.run({ phase: 'convert', session: input.session, draft: input.draft, assignment, candidateRoot, attempt: 1, diagnostics: [] }); }
    catch (error) { throw new SubmissionPipelineErrorV1('CONVERSION_FAILED', 'Draft 转换失败。', [], { cause: error }); }
    const control = targetControl(input.session), initialManifest = initialManifestOf(lint.draft, input.session);
    let validated: PublishedWorld | null = null, validatedChanges: readonly Extract<WorldChange, { op: 'put' }>[] | null = null, diagnostics: readonly ValidationIssueV1[] = [], previousSignature: string | null = null;
    for (let attempt = 0; attempt <= SESSION_FILE_LIMITS.repairRounds; attempt += 1) {
      input.stage('validate', attempt + 1);
      try {
        const changes = await readCandidateWorkspaceV1(candidateRoot);
        const candidate = await assembleCandidateV1({ worldRoot: input.worldRoot, operationType: input.session.kind, base: input.session.pinned, changes, control, initialManifest, allowedRevisePaths: allowedRevisePaths(lint.draft, assignment) });
        const result = await validateCandidateV1(candidate);
        if (result.ok) { validated = result.world; validatedChanges = candidate.changes; diagnostics = []; break; }
        diagnostics = result.diagnostics;
      } catch (error) { diagnostics = sortDiagnosticsV1([candidateIssue(error)]); }
      await input.draft.writeDiagnostics(diagnostics);
      const signature = diagnostics.map((item) => `${item.code}\0${item.path ?? ''}\0${item.constraint}`).join('\n');
      if (attempt >= SESSION_FILE_LIMITS.repairRounds || signature === previousSignature) break;
      previousSignature = signature; input.stage('repair', attempt + 1);
      try { await input.converter.run({ phase: 'repair', session: input.session, draft: input.draft, assignment, candidateRoot, attempt: attempt + 1, diagnostics }); }
      catch (error) { throw new SubmissionPipelineErrorV1('CONVERSION_FAILED', 'Candidate 修复失败。', diagnostics, { cause: error }); }
    }
    if (!validated) { await failDraft(input.draft, diagnostics); throw new SubmissionPipelineErrorV1('CANDIDATE_INVALID', 'Candidate 未通过程序校验。', diagnostics); }
    input.stage('review', 1); let review: SubmissionReviewV1;
    try { review = await input.reviewer.review({ session: input.session, draft: input.draft, assignment, candidateRoot }); }
    catch (error) { review = { advisory: [reviewIssue(error)], raw: null }; }
    const advisory = sortDiagnosticsV1(review.advisory);
    input.stage('diff', 1); const diff = actualDiff(validatedChanges!, input.session.pinned);
    if (diff.length === 0) { const issue = candidateIssue(new Error('Candidate produces no World document changes.')); await failDraft(input.draft, [issue]); throw new SubmissionPipelineErrorV1('CANDIDATE_INVALID', issue.constraint, [issue]); }
    const auditInput: SubmissionAuditInputV1 = { session: input.session, draft: input.draft, assignment, validation: [], review: review.raw, advisories: advisory, candidateChanges: diff };
    const audit = await buildSubmissionAuditV1(auditInput); await input.draft.writeDiagnostics(advisory); const archive = await input.draft.prepareArchive();
    let published: PublishedWorld;
    try { input.stage('publish', 1); published = await input.publish({ operationType: input.session.kind, base: input.session.pinned, initialManifest, changes: [...diff, ...audit], control }); }
    catch (error) { await archive.rollback(); throw error; }
    await archive.commit();
    return Object.freeze({ published, diagnostics: advisory });
  } catch (error) {
    if (!(error instanceof SubmissionPipelineErrorV1)) await input.draft.setStatus('submit-failed').catch(() => undefined);
    throw error;
  } finally { await rm(path.dirname(candidateRoot), { recursive: true, force: true }).catch(() => undefined); }
}

async function failDraft(draft: DraftHandleV1, diagnostics: readonly ValidationIssueV1[]): Promise<void> { await draft.writeDiagnostics(diagnostics); await draft.setStatus('submit-failed'); }
function targetControl(session: CoreSession): CandidateControlV1 {
  const previous = session.pinned?.commit.control.lastSettledDay ?? null;
  if (session.kind === 'planning') return { phase: 'planned', day: session.day, lastSettledDay: previous };
  if (session.kind === 'play') return { phase: 'awaiting-settle', day: session.day, lastSettledDay: previous };
  if (session.kind === 'revise') return { ...session.pinned!.commit.control };
  return { phase: 'idle', day: null, lastSettledDay: null };
}
function initialManifestOf(draft: Record<string, unknown>, session: CoreSession): { worldId: string; title: string } | undefined {
  if (session.kind !== 'init') return undefined; const title = draft.title as { value?: unknown };
  return { worldId: `world_${randomUUID().replaceAll('-', '')}`, title: String(title.value).trim() };
}
function requiredConfirmationIssues(draft: Record<string, unknown>): readonly ValidationIssueV1[] {
  const issues: ValidationIssueV1[] = [];
  const required: unknown[] = draft.kind === 'init' ? [draft.title, ...(Object.values(draft.canon as Record<string, unknown>)), draft.worldState]
    : draft.kind === 'planning' ? [draft.intent, draft.knownContext, draft.constraints, draft.openQuestions, draft.maxEvents]
      : [];
  for (const [index, value] of required.entries()) if ((value as { decision?: unknown })?.decision !== 'confirmed') issues.push({ schemaVersion: 1, stage: 'draft', severity: 'error', code: 'DRAFT_UNCONFIRMED_REQUIRED', path: 'draft.yaml', constraint: `Required Draft value ${index + 1} must be confirmed before submit.` });
  return sortDiagnosticsV1(issues);
}
function candidateIssue(error: unknown): ValidationIssueV1 { return { schemaVersion: 1, stage: 'candidate', severity: 'error', code: 'CANDIDATE_ASSEMBLY_FAILED', path: null, constraint: error instanceof Error ? error.message : 'Candidate assembly failed.' }; }
function reviewIssue(error: unknown): ValidationIssueV1 { return { schemaVersion: 1, stage: 'review', severity: 'advisory', code: 'REVIEW_UNAVAILABLE', path: null, constraint: error instanceof Error ? error.message : 'AI review failed.' }; }
function actualDiff(changes: readonly Extract<WorldChange, { op: 'put' }>[], base: PublishedWorld | null): readonly Extract<WorldChange, { op: 'put' }>[] { const hashes = new Map(base?.tree.entries.map((entry) => [entry.path, entry.blobHash]) ?? []); return changes.filter((change) => hashes.get(change.path) !== hashBlobV1(change.bytes)); }
function allowedRevisePaths(draft: Record<string, unknown>, assignment: SessionAssignmentV1): ReadonlySet<string> | undefined {
  if (draft.kind !== 'revise') return undefined; const paths = new Set<string>();
  for (const [index, raw] of (draft.operations as Array<Record<string, unknown>>).entries()) {
    if (raw.decision !== 'confirmed') continue; const id = assignment.ids[`operation:${index + 1}`];
    if (raw.op === 'replace-canon') paths.add(`canon/${String(raw.field).replace('userRole', 'user-role')}.md`);
    if (raw.op === 'replace-character-profile') paths.add(`characters/${raw.characterId}/profile.md`);
    if (raw.op === 'replace-location-profile') paths.add(`locations/${raw.locationId}/profile.md`);
    if (raw.op === 'replace-arc-profile') paths.add(`arcs/${raw.arcId}/profile.md`);
    if (raw.op === 'set-world-variable') paths.add('state/variables.yaml');
    if (raw.op === 'set-character-status' || raw.op === 'move-character') paths.add(`characters/${raw.characterId}/state.yaml`);
    if (raw.op === 'set-location-status') paths.add(`locations/${raw.locationId}/state.yaml`);
    if (raw.op === 'set-arc-stage') paths.add(`arcs/${raw.arcId}/state.yaml`);
    if (raw.op === 'add-story-seed' || raw.op === 'remove-story-seed') paths.add('story-seeds/active.yaml');
    if (raw.op === 'create-character') { paths.add('characters/index.yaml'); for (const name of ['profile.md', 'relationships.yaml', 'state.yaml', 'memory.md', 'timeline.md']) paths.add(`characters/${id}/${name}`); }
    if (raw.op === 'create-location') { paths.add('locations/index.yaml'); for (const name of ['profile.md', 'state.yaml', 'memory.md', 'triggers.yaml', 'timeline.md']) paths.add(`locations/${id}/${name}`); }
    if (raw.op === 'create-arc') { paths.add('arcs/index.yaml'); for (const name of ['profile.md', 'state.yaml', 'timeline.md']) paths.add(`arcs/${id}/${name}`); }
  }
  return paths;
}
