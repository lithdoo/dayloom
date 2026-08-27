import { lstat, readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { hashBlobV1 } from '@dayloom/archive-protocol';
import type { ChangePlanAssignmentV2, ChangePlanV2 } from '../../session/change-plan-v2';
import type { CoreSession } from '../../session/common';
import type { ValidationIssueV1 } from '../../session/diagnostics';
import type { MarkdownDraftSnapshotV2 } from '../../session/markdown-draft-snapshot';
import type { TurnAuditV1 } from '../../session/turn-record';
import type { WorldChange } from '../publish';
import { jsonDocument } from './encode';

export interface VisibleTranscriptV1 { schemaVersion: 1; turns: Array<{ index: number; role: 'user' | 'assistant'; content: string }> }
export interface SubmissionAuditInputV2 {
  sessionId: string; kind: CoreSession['kind']; snapshot: Readonly<MarkdownDraftSnapshotV2>;
  transcript: VisibleTranscriptV1; turns: readonly Readonly<TurnAuditV1>[];
  changePlan: Readonly<ChangePlanV2>; assignment: Readonly<ChangePlanAssignmentV2>;
  conversionRounds: readonly { phase: 'convert' | 'repair'; attempt: number; transcript: VisibleTranscriptV1 }[];
  validation: readonly ValidationIssueV1[]; review: unknown; reviewDiagnostics: readonly ValidationIssueV1[];
  candidateChanges: readonly Extract<WorldChange, { op: 'put' }>[];
}

export async function buildSubmissionAuditV2(input: SubmissionAuditInputV2): Promise<WorldChange[]> {
  const root = `audit/sessions/${input.sessionId}`, brief = await readFile(path.join(input.snapshot.root, 'brief.md')), evidence = await readFile(path.join(input.snapshot.root, 'evidence.md'));
  const assignmentBytes = jsonBytes(input.assignment), turnRows = input.turns.map((turn) => ({ turnId: turn.turnId, sha256: hashBlobV1(jsonBytes(turn)) }));
  const turnIndex = { schemaVersion: 1, turns: turnRows }, turnIndexHash = hashBlobV1(jsonBytes(turnIndex));
  const draftIndex = { schemaVersion: 2, files: [{ path: 'brief.md', bytes: brief.byteLength, sha256: hashBlobV1(brief) }, { path: 'evidence.md', bytes: evidence.byteLength, sha256: hashBlobV1(evidence) }] };
  const diff = input.candidateChanges.map((change) => ({ path: change.path, mediaType: change.mediaType, bytes: change.bytes.byteLength, sha256: hashBlobV1(change.bytes) }));
  return [
    jsonDocument(`${root}/meta.json`, { schemaVersion: 2, sessionId: input.sessionId, kind: input.kind, sourceFormat: input.snapshot.meta.sourceFormat, draftId: input.snapshot.draftId, draftHash: input.snapshot.hash, briefHash: hashBlobV1(brief), evidenceHash: hashBlobV1(evidence), baseWorldCommitId: input.snapshot.meta.baseCommitId, baseRootTreeHash: input.snapshot.meta.baseRootTreeHash, changePlanHash: input.assignment.planHash, assignmentHash: hashBlobV1(assignmentBytes), turnIndexHash }),
    jsonDocument(`${root}/transcript.json`, input.transcript), jsonDocument(`${root}/draft-index.json`, draftIndex),
    { op: 'put', path: `${root}/draft/brief.md`, mediaType: 'text/markdown', bytes: new Uint8Array(brief) },
    { op: 'put', path: `${root}/draft/evidence.md`, mediaType: 'text/markdown', bytes: new Uint8Array(evidence) },
    jsonDocument(`${root}/turns/index.json`, turnIndex), ...input.turns.map((turn) => jsonDocument(`${root}/turns/${turn.turnId}.json`, turn)),
    jsonDocument(`${root}/change-plan.json`, input.changePlan), jsonDocument(`${root}/assignment.json`, input.assignment),
    jsonDocument(`${root}/conversion-transcript.json`, { schemaVersion: 2, changePlanHash: input.assignment.planHash, rounds: input.conversionRounds }),
    jsonDocument(`${root}/validation.json`, { schemaVersion: 2, changePlanHash: input.assignment.planHash, diagnostics: input.validation }),
    jsonDocument(`${root}/review.json`, { schemaVersion: 2, changePlanHash: input.assignment.planHash, result: input.review, diagnostics: input.reviewDiagnostics }),
    jsonDocument(`${root}/candidate-diff.json`, { schemaVersion: 2, changePlanHash: input.assignment.planHash, changes: diff }),
  ];
}

function jsonBytes(value: unknown): Uint8Array { return new TextEncoder().encode(`${JSON.stringify(value, null, 2)}\n`); }

export async function exportVisibleTranscriptV1(directory: string, hiddenFinal: string): Promise<VisibleTranscriptV1> {
  const discovered: Array<{ sourceIndex: number; role: 'user' | 'assistant'; content: string }> = [];
  await collect(directory, discovered); discovered.sort((a, b) => a.sourceIndex - b.sourceIndex);
  const seen = new Set<number>();
  const visible = discovered.filter((turn) => { if (seen.has(turn.sourceIndex)) throw new Error('Promptpile Conversation contains a duplicate visible turn index.'); seen.add(turn.sourceIndex); return !(turn.role === 'assistant' && turn.content === hiddenFinal); });
  for (let index = 0; index < visible.length; index += 1) if (visible[index].role !== (index % 2 === 0 ? 'user' : 'assistant')) throw new Error('Promptpile Conversation visible turns do not alternate user and assistant roles.');
  return Object.freeze({ schemaVersion: 1, turns: visible.map((turn, index) => Object.freeze({ index, role: turn.role, content: turn.content })) });
}

async function collect(directory: string, output: Array<{ sourceIndex: number; role: 'user' | 'assistant'; content: string }>): Promise<void> {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const target = path.join(directory, entry.name);
    if (entry.isSymbolicLink()) throw new Error('Promptpile Conversation audit cannot read symbolic links.');
    if (entry.isDirectory()) { if (/^\[\d+\]system\.md\.archive$/.test(entry.name)) await collect(target, output); continue; }
    const match = /^\[(\d+)\](user|assistant)\.md$/.exec(entry.name); if (!match) continue;
    const stat = await lstat(target); if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('Promptpile Conversation turn must be a regular file.');
    output.push({ sourceIndex: Number(match[1]), role: match[2] as 'user' | 'assistant', content: await readFile(target, 'utf8') });
  }
}
