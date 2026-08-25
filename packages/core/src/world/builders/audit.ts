import { lstat, readFile, readdir } from 'node:fs/promises';
import { hashBlobV1 } from '@dayloom/archive-protocol';
import path from 'node:path';
import type { CoreSession } from '../../session/common';
import type { DraftHandleV1 } from '../../session/draft-store';
import type { SessionAssignmentV1 } from '../../session/assignment';
import type { ValidationIssueV1 } from '../../session/diagnostics';
import type { WorldChange } from '../publish';
import { jsonDocument } from './encode';

export interface VisibleTranscriptV1 { schemaVersion: 1; turns: Array<{ index: number; role: 'user' | 'assistant'; content: string }> }

export async function buildSessionAuditV1(session: CoreSession, acceptedSubmission: unknown, hiddenFinal: string): Promise<WorldChange[]> {
  const transcript = await exportVisibleTranscriptV1(session.conversationDir, hiddenFinal), root = `audit/sessions/${session.id}`;
  return [jsonDocument(`${root}/meta.json`, { schemaVersion: 1, sessionId: session.id, kind: session.kind }), jsonDocument(`${root}/transcript.json`, transcript), jsonDocument(`${root}/submission.json`, acceptedSubmission)];
}

export interface SubmissionAuditInputV1 {
  session: CoreSession; draft: DraftHandleV1; assignment: SessionAssignmentV1;
  validation: readonly ValidationIssueV1[]; review: unknown; advisories: readonly ValidationIssueV1[];
  candidateChanges: readonly Extract<WorldChange, { op: 'put' }>[];
}

export async function buildSubmissionAuditV1(input: SubmissionAuditInputV1): Promise<WorldChange[]> {
  const root = `audit/sessions/${input.session.id}`, transcript = await exportVisibleTranscriptV1(input.session.conversationDir, '');
  const conversionRounds = await collectConversionRounds(path.join(input.session.root, 'submission'));
  const draftFiles: Array<{ path: string; content: string }> = [];
  await collectDraft(input.draft.root, input.draft.root, draftFiles);
  const index = draftFiles.map((file) => ({ path: file.path, sha256: hashBlobV1(new TextEncoder().encode(file.content)) }));
  const diff = input.candidateChanges.map((change) => ({ path: change.path, mediaType: change.mediaType, bytes: change.bytes.byteLength, sha256: hashBlobV1(change.bytes) }));
  return [
    jsonDocument(`${root}/meta.json`, { schemaVersion: 1, sessionId: input.session.id, draftId: input.draft.id, kind: input.session.kind }),
    jsonDocument(`${root}/transcript.json`, transcript),
    jsonDocument(`${root}/draft-index.json`, { schemaVersion: 1, files: index }),
    ...draftFiles.map((file): WorldChange => ({ op: 'put', path: `${root}/draft/${file.path}`, mediaType: file.path.endsWith('.json') ? 'application/json' : file.path.endsWith('.yaml') ? 'application/yaml' : 'text/markdown', bytes: new TextEncoder().encode(file.content) })),
    jsonDocument(`${root}/assignment.json`, input.assignment),
    jsonDocument(`${root}/conversion-transcript.json`, { schemaVersion: 1, rounds: conversionRounds }),
    jsonDocument(`${root}/validation.json`, { schemaVersion: 1, diagnostics: input.validation }),
    jsonDocument(`${root}/review.json`, { schemaVersion: 1, result: input.review, diagnostics: input.advisories }),
    jsonDocument(`${root}/candidate-diff.json`, { schemaVersion: 1, changes: diff }),
  ];
}

async function collectConversionRounds(root: string): Promise<Array<{ phase: 'convert' | 'repair'; attempt: number; transcript: VisibleTranscriptV1 }>> {
  const rounds: Array<{ phase: 'convert' | 'repair'; attempt: number; transcript: VisibleTranscriptV1 }> = [];
  let entries; try { entries = await readdir(root, { withFileTypes: true }); } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return rounds; throw error; }
  for (const entry of entries) {
    const match = /^(convert|repair)-([1-9][0-9]*)$/.exec(entry.name); if (!entry.isDirectory() || !match) continue;
    rounds.push({ phase: match[1] as 'convert' | 'repair', attempt: Number(match[2]), transcript: await exportVisibleTranscriptV1(path.join(root, entry.name, 'conversation'), '') });
  }
  rounds.sort((left, right) => left.phase === right.phase ? left.attempt - right.attempt : left.phase === 'convert' ? -1 : 1); return rounds;
}

export async function exportVisibleTranscriptV1(directory: string, hiddenFinal: string): Promise<VisibleTranscriptV1> {
  const discovered: Array<{ sourceIndex: number; role: 'user' | 'assistant'; content: string }> = [];
  await collect(directory, discovered); discovered.sort((a, b) => a.sourceIndex - b.sourceIndex);
  const seen = new Set<number>();
  const visible = discovered.filter((turn) => {
    if (seen.has(turn.sourceIndex)) throw new Error('Promptpile Conversation contains a duplicate visible turn index.'); seen.add(turn.sourceIndex);
    return !(turn.role === 'assistant' && turn.content === hiddenFinal);
  });
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

async function collectDraft(root: string, directory: string, output: Array<{ path: string; content: string }>): Promise<void> {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const target = path.join(directory, entry.name), relative = path.relative(root, target).split(path.sep).join('/');
    if (entry.isSymbolicLink()) throw new Error('Draft audit cannot read symbolic links.');
    if (entry.isDirectory()) { await collectDraft(root, target, output); continue; }
    const stat = await lstat(target); if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('Draft audit entry must be a regular file.');
    output.push({ path: relative, content: await readFile(target, 'utf8') });
  }
  output.sort((left, right) => left.path.localeCompare(right.path, 'en'));
}
