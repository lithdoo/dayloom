import { lstat, readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import type { CoreSession } from '../../session/common';
import type { WorldChange } from '../publish';
import { jsonDocument } from './encode';

export interface VisibleTranscriptV1 { schemaVersion: 1; turns: Array<{ index: number; role: 'user' | 'assistant'; content: string }> }

export async function buildSessionAuditV1(session: CoreSession, acceptedSubmission: unknown, hiddenFinal: string): Promise<WorldChange[]> {
  const transcript = await exportVisibleTranscriptV1(session.conversationDir, hiddenFinal), root = `audit/sessions/${session.id}`;
  return [jsonDocument(`${root}/meta.json`, { schemaVersion: 1, sessionId: session.id, kind: session.kind }), jsonDocument(`${root}/transcript.json`, transcript), jsonDocument(`${root}/submission.json`, acceptedSubmission)];
}

export async function exportVisibleTranscriptV1(directory: string, hiddenFinal: string): Promise<VisibleTranscriptV1> {
  const discovered: Array<{ sourceIndex: number; role: 'user' | 'assistant'; content: string }> = [];
  await collect(directory, discovered); discovered.sort((a, b) => a.sourceIndex - b.sourceIndex);
  const seen = new Set<number>();
  const visible = discovered.filter((turn) => {
    if (seen.has(turn.sourceIndex)) throw new Error('Promptpile Conversation contains a duplicate visible turn index.'); seen.add(turn.sourceIndex);
    if (turn.role === 'user' && /^\[DAYLOOM_[A-Z_]+_SUBMIT_V\d+\]/.test(turn.content)) return false;
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
